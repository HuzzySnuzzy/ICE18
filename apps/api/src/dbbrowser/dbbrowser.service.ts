import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import mysql from 'mysql2/promise';
import type {
  DbColumn,
  DbIndex,
  DatabaseLockStatus,
  DbRowKey,
  DbRowsPage,
  DbTable,
  DbTableDesign,
  ServerPermission,
} from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { explainDatabaseError } from '../db/database.service';
import type { UserRow } from '../db/schema';
import { PluginsService } from '../plugins/plugins.service';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { ServersService } from '../servers/servers.service';
import { DatabasesService } from './databases.service';
import { clampPage, isBinaryType, toCell, validateRowKey } from './sql';

const POOL_IDLE_MS = 5 * 60_000;
const TABLES_CACHE_MS = 30_000;
const QUERY_TIMEOUT_MS = 15_000;
/** Above this many (estimated) rows, show MySQL's estimate instead of running COUNT(*). */
const EXACT_COUNT_LIMIT = 200_000;
const MAX_DELETE = 100;

/** Viewing data needs the same rights Pterodactyl requires to see a database password. */
const VIEW_PERMISSIONS: ServerPermission[] = ['database.read', 'database.view_password'];

interface PoolEntry {
  pool: mysql.Pool;
  name: string;
  host: string;
  lastUsed: number;
  tables?: { at: number; list: DbTable[] };
}

type Cell = string | null;

/**
 * MS Access-style browser for a server's own databases. Connects with the database's
 * own credentials (so it can only ever see that database), reads freely, and only
 * changes rows while the server is offline. Values always go through placeholders,
 * identifiers are checked against the table's real columns, and every change targets
 * one row by its primary key.
 */
@Injectable()
export class DbBrowserService implements OnModuleDestroy {
  private readonly pools = new Map<string, PoolEntry>();
  private readonly sweeper = setInterval(() => void this.sweep(), 60_000);

  constructor(
    private readonly servers: ServersService,
    private readonly ptero: PterodactylService,
    private readonly plugins: PluginsService,
    private readonly audit: AuditService,
    private readonly databases: DatabasesService,
  ) {
    this.sweeper.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.pools.values()].map((entry) => entry.pool.end().catch(() => undefined)));
    this.pools.clear();
  }

  private async sweep(): Promise<void> {
    for (const [key, entry] of this.pools) {
      if (Date.now() - entry.lastUsed > POOL_IDLE_MS) {
        this.pools.delete(key);
        await entry.pool.end().catch(() => undefined);
      }
    }
  }

  private async requireAccess(user: UserRow, identifier: string): Promise<void> {
    const access = await this.servers.getForUser(user, identifier);
    const missing = VIEW_PERMISSIONS.filter((permission) => !access.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`You need these permissions on this server: ${missing.join(', ')}.`);
    }
  }

  /**
   * Data is locked unless the owner server and every server whose plugins use this
   * database are offline. Checked fresh (no cached states) before every write.
   */
  private async assertUnlocked(user: UserRow, identifier: string, databaseId: string): Promise<void> {
    const entry = await this.pool(identifier, databaseId);
    const status = await this.databases.lockStatus(user, identifier, entry.name, { forWrite: true });
    if (status.locked) {
      const online = status.servers.filter((server) => server.state !== 'offline');
      const list = online.map((server) => `${server.name} (${server.state})`).join(', ');
      throw new ConflictException(
        `${entry.name} is read-only while servers that use it are online: ${list}. Stop ${online.length === 1 ? 'it' : 'them'} to edit.`,
      );
    }
  }

  async status(user: UserRow, identifier: string, databaseId: string): Promise<DatabaseLockStatus> {
    await this.requireAccess(user, identifier);
    const entry = await this.pool(identifier, databaseId);
    return this.databases.lockStatus(user, identifier, entry.name);
  }

  private async pool(identifier: string, databaseId: string): Promise<PoolEntry> {
    const key = `${identifier}/${databaseId}`;
    const existing = this.pools.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const database = (await this.ptero.listDatabases(identifier, true)).find((entry) => entry.id === databaseId);
    if (!database) throw new NotFoundException('No such database on this server.');
    const password = database.relationships?.password?.attributes.password;
    if (password === undefined) throw new BadGatewayException('Pterodactyl did not return the database password.');

    const host = this.plugins.pluginHost(database.host.address);
    const pool = mysql.createPool({
      host,
      port: database.host.port,
      user: database.username,
      password,
      database: database.name,
      connectionLimit: 3,
      connectTimeout: 10_000,
      charset: 'utf8mb4',
      // Keep values exactly as stored: no timezone shifts, no lost precision.
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: false,
      jsonStrings: true,
      multipleStatements: false,
    });
    const entry: PoolEntry = { pool, name: database.name, host, lastUsed: Date.now() };
    this.pools.set(key, entry);
    return entry;
  }

  private async run<T>(identifier: string, databaseId: string, work: (entry: PoolEntry) => Promise<T>): Promise<T> {
    const entry = await this.pool(identifier, databaseId);
    try {
      return await work(entry);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'ER_ACCESS_DENIED_ERROR'].includes(code)) {
        // Credentials may have been rotated or the host changed: reconnect next time.
        this.pools.delete(`${identifier}/${databaseId}`);
        await entry.pool.end().catch(() => undefined);
        throw new BadGatewayException(
          explainDatabaseError(error, { host: entry.host, port: 0, database: entry.name, user: '', password: '' }),
        );
      }
      if (code === 'PROTOCOL_SEQUENCE_TIMEOUT') throw new BadGatewayException('The database took too long to answer.');
      if (code.startsWith('ER_')) {
        throw new BadRequestException(`MySQL: ${(error as { sqlMessage?: string }).sqlMessage ?? (error as Error).message}`);
      }
      throw error;
    }
  }

  async tables(user: UserRow, identifier: string, databaseId: string, refresh = false): Promise<DbTable[]> {
    await this.requireAccess(user, identifier);
    return this.run(identifier, databaseId, (entry) => this.loadTables(entry, refresh));
  }

  private async loadTables(entry: PoolEntry, refresh = false): Promise<DbTable[]> {
    if (!refresh && entry.tables && Date.now() - entry.tables.at < TABLES_CACHE_MS) return entry.tables.list;
    const [rows] = await entry.pool.query<mysql.RowDataPacket[]>({
      sql: `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS row_count, ENGINE AS engine, TABLE_COMMENT AS comment
            FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
      timeout: QUERY_TIMEOUT_MS,
    });
    const list: DbTable[] = rows.map((row) => ({
      name: String(row.name),
      type: String(row.type).toUpperCase().includes('VIEW') ? 'view' : 'table',
      rows: row.row_count === null ? null : Number(row.row_count),
      engine: row.engine === null ? null : String(row.engine),
      comment: String(row.comment ?? ''),
    }));
    entry.tables = { at: Date.now(), list };
    return list;
  }

  private async findTable(entry: PoolEntry, table: string): Promise<DbTable> {
    let found = (await this.loadTables(entry)).find((candidate) => candidate.name === table);
    if (!found) found = (await this.loadTables(entry, true)).find((candidate) => candidate.name === table);
    if (!found) throw new NotFoundException(`Table ${table} doesn't exist in this database.`);
    return found;
  }

  private async loadDesign(entry: PoolEntry, table: string): Promise<DbTableDesign> {
    const info = await this.findTable(entry, table);
    const [columnRows] = await entry.pool.query<mysql.RowDataPacket[]>({
      sql: `SELECT COLUMN_NAME AS name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, IS_NULLABLE AS nullable,
                   COLUMN_KEY AS column_key, COLUMN_DEFAULT AS column_default, EXTRA AS extra
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      values: [table],
      timeout: QUERY_TIMEOUT_MS,
    });
    const [indexRows] = await entry.pool.query<mysql.RowDataPacket[]>({
      sql: `SELECT INDEX_NAME AS name, COLUMN_NAME AS column_name, NON_UNIQUE AS non_unique
            FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      values: [table],
      timeout: QUERY_TIMEOUT_MS,
    });

    const indexes = new Map<string, DbIndex>();
    for (const row of indexRows) {
      const name = String(row.name);
      const index = indexes.get(name) ?? { name, columns: [], unique: Number(row.non_unique) === 0 };
      index.columns.push(String(row.column_name));
      indexes.set(name, index);
    }
    const primaryKey = indexes.get('PRIMARY')?.columns ?? [];

    const columns: DbColumn[] = columnRows.map((row) => {
      const extra = String(row.extra ?? '');
      const binary = isBinaryType(String(row.data_type));
      const generated = /GENERATED/i.test(extra);
      return {
        name: String(row.name),
        dataType: String(row.data_type),
        columnType: String(row.column_type),
        nullable: String(row.nullable) === 'YES',
        key: String(row.column_key ?? ''),
        default: row.column_default === null ? null : String(row.column_default),
        extra,
        autoIncrement: /auto_increment/i.test(extra),
        binary,
        editable: info.type === 'table' && !binary && !generated,
      };
    });

    let readOnlyReason: string | null = null;
    if (info.type === 'view') readOnlyReason = 'Views are read-only.';
    else if (primaryKey.length === 0) readOnlyReason = 'This table has no primary key, so rows cannot be changed safely.';
    else if (columns.some((column) => primaryKey.includes(column.name) && column.binary)) {
      readOnlyReason = 'This table uses binary data in its primary key, which ICE18 cannot edit safely.';
    }

    return {
      name: table,
      type: info.type,
      columns,
      primaryKey,
      indexes: [...indexes.values()],
      editable: readOnlyReason === null,
      readOnlyReason,
    };
  }

  async design(user: UserRow, identifier: string, databaseId: string, table: string): Promise<DbTableDesign> {
    await this.requireAccess(user, identifier);
    return this.run(identifier, databaseId, (entry) => this.loadDesign(entry, table));
  }

  async rows(
    user: UserRow,
    identifier: string,
    databaseId: string,
    table: string,
    query: { offset?: unknown; limit?: unknown; sort?: unknown; dir?: unknown },
  ): Promise<DbRowsPage> {
    await this.requireAccess(user, identifier);
    return this.run(identifier, databaseId, async (entry) => {
      const design = await this.loadDesign(entry, table);
      const info = await this.findTable(entry, table);
      const { offset, limit } = clampPage(query.offset, query.limit);
      const requestedSort = typeof query.sort === 'string' ? query.sort : null;
      const sort =
        requestedSort && design.columns.some((column) => column.name === requestedSort)
          ? requestedSort
          : (design.primaryKey[0] ?? null);
      const dir = query.dir === 'desc' ? 'desc' : 'asc';

      const orderBy = sort ? mysql.format(` ORDER BY ?? ${dir === 'desc' ? 'DESC' : 'ASC'}`, [sort]) : '';
      const [result] = await entry.pool.query<mysql.RowDataPacket[]>({
        sql: mysql.format('SELECT * FROM ??', [table]) + orderBy + ' LIMIT ? OFFSET ?',
        values: [limit, offset],
        rowsAsArray: true,
        timeout: QUERY_TIMEOUT_MS,
      } as mysql.QueryOptions);
      const rows = (result as unknown as unknown[][]).map((row) => row.map(toCell));

      let total: number | null = info.rows;
      let totalIsEstimate = true;
      if (info.type === 'view' || info.rows === null || info.rows < EXACT_COUNT_LIMIT) {
        try {
          const [countRows] = await entry.pool.query<mysql.RowDataPacket[]>({
            sql: mysql.format('SELECT COUNT(*) AS total FROM ??', [table]),
            timeout: QUERY_TIMEOUT_MS,
          });
          total = Number(countRows[0]?.total ?? 0);
          totalIsEstimate = false;
        } catch {
          /* keep the estimate */
        }
      }

      return {
        columns: design.columns.map((column) => column.name),
        rows,
        total,
        totalIsEstimate,
        offset,
        limit,
        sort,
        dir,
      };
    });
  }

  private checkWritable(design: DbTableDesign): void {
    if (!design.editable) throw new BadRequestException(design.readOnlyReason ?? 'This table is read-only.');
  }

  private checkValues(design: DbTableDesign, values: Record<string, unknown>, allowKey: boolean): Record<string, Cell> {
    const cleaned: Record<string, Cell> = {};
    for (const [name, value] of Object.entries(values)) {
      const column = design.columns.find((candidate) => candidate.name === name);
      if (!column) throw new BadRequestException(`Unknown column ${name}.`);
      if (!column.editable) throw new BadRequestException(`${name} can't be edited (${column.binary ? 'binary data' : 'generated column'}).`);
      if (!allowKey && design.primaryKey.includes(name)) {
        throw new BadRequestException(`${name} is part of the primary key and can't be changed here.`);
      }
      if (value !== null && typeof value !== 'string') throw new BadRequestException(`${name}: values must be text or NULL.`);
      if (value === null && !column.nullable) throw new BadRequestException(`${name} can't be empty (NULL).`);
      cleaned[name] = value;
    }
    return cleaned;
  }

  /** `pk1` = 'a' AND `pk2` = 'b', fully escaped. */
  private where(primaryKey: readonly string[], key: DbRowKey): string {
    return primaryKey.map((column) => mysql.format('?? = ?', [column, key[column]!])).join(' AND ');
  }

  async updateRow(
    user: UserRow,
    identifier: string,
    databaseId: string,
    table: string,
    key: DbRowKey,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.requireAccess(user, identifier);
    await this.assertUnlocked(user, identifier, databaseId);
    await this.run(identifier, databaseId, async (entry) => {
      const design = await this.loadDesign(entry, table);
      this.checkWritable(design);
      const keyProblem = validateRowKey(design.primaryKey, key);
      if (keyProblem) throw new BadRequestException(keyProblem);
      const changes = this.checkValues(design, values, false);
      if (Object.keys(changes).length === 0) throw new BadRequestException('Nothing to change.');

      const set = Object.entries(changes)
        .map(([column, value]) => mysql.format('?? = ?', [column, value]))
        .join(', ');
      const sql = mysql.format('UPDATE ?? SET ', [table]) + set + ' WHERE ' + this.where(design.primaryKey, key) + ' LIMIT 1';
      const [result] = await entry.pool.query<mysql.ResultSetHeader>({ sql, timeout: QUERY_TIMEOUT_MS });
      if (result.affectedRows !== 1) throw new NotFoundException('That record no longer exists. Refresh to see the latest data.');

      await this.audit.record(
        user.id,
        'db.row.update',
        identifier,
        `${entry.name}.${table} ${JSON.stringify(key)} set ${Object.keys(changes).join(', ')}`,
      );
    });
  }

  async insertRow(
    user: UserRow,
    identifier: string,
    databaseId: string,
    table: string,
    values: Record<string, unknown>,
  ): Promise<{ insertId: string | null }> {
    await this.requireAccess(user, identifier);
    await this.assertUnlocked(user, identifier, databaseId);
    return this.run(identifier, databaseId, async (entry) => {
      const design = await this.loadDesign(entry, table);
      this.checkWritable(design);
      const changes = this.checkValues(design, values, true);
      const columns = Object.keys(changes);
      const sql =
        columns.length === 0
          ? mysql.format('INSERT INTO ?? () VALUES ()', [table])
          : mysql.format(`INSERT INTO ?? (??) VALUES (${columns.map(() => '?').join(', ')})`, [
              table,
              columns,
              ...columns.map((column) => changes[column]),
            ]);
      const [result] = await entry.pool.query<mysql.ResultSetHeader>({ sql, timeout: QUERY_TIMEOUT_MS });
      await this.audit.record(user.id, 'db.row.insert', identifier, `${entry.name}.${table} (${columns.join(', ')})`);
      return { insertId: result.insertId ? String(result.insertId) : null };
    });
  }

  async deleteRows(
    user: UserRow,
    identifier: string,
    databaseId: string,
    table: string,
    keys: DbRowKey[],
  ): Promise<{ deleted: number }> {
    await this.requireAccess(user, identifier);
    if (keys.length === 0) throw new BadRequestException('Select at least one record.');
    if (keys.length > MAX_DELETE) throw new BadRequestException(`Delete at most ${MAX_DELETE} records at a time.`);
    await this.assertUnlocked(user, identifier, databaseId);
    return this.run(identifier, databaseId, async (entry) => {
      const design = await this.loadDesign(entry, table);
      this.checkWritable(design);
      for (const key of keys) {
        const keyProblem = validateRowKey(design.primaryKey, key);
        if (keyProblem) throw new BadRequestException(keyProblem);
      }

      // All or nothing: if any record is missing, nothing is deleted.
      const connection = await entry.pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const key of keys) {
          const sql = mysql.format('DELETE FROM ?? WHERE ', [table]) + this.where(design.primaryKey, key) + ' LIMIT 1';
          const [result] = await connection.query<mysql.ResultSetHeader>({ sql, timeout: QUERY_TIMEOUT_MS });
          if (result.affectedRows !== 1) {
            throw new NotFoundException('One of those records no longer exists. Nothing was deleted; refresh and try again.');
          }
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }

      await this.audit.record(
        user.id,
        'db.row.delete',
        identifier,
        `${entry.name}.${table} ${keys.length} record(s): ${JSON.stringify(keys).slice(0, 500)}`,
      );
      return { deleted: keys.length };
    });
  }
}
