import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { DbCell, DbColumn, DbIndex, DbRowsPage, DbTable, DbTableDesign, LocalDatabaseSnapshot, ServerPermission } from '@ice18/shared';
import type { UserRow } from '../db/schema';
import { localDatabaseKind, pathFromKey } from '../plugins/localfiles';
import { PterodactylError } from '../pterodactyl/pterodactyl.http';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { SAFE_DB_DOWNLOAD } from '../pterodactyl/safety';
import { ServersService } from '../servers/servers.service';
import { clampPage, toCell } from './sql';

// Minimal typing for node:sqlite (Node 22.13+), loaded lazily so older Node still starts.
interface StatementSync {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  setReturnArrays?(enabled: boolean): void;
}
interface DatabaseSync {
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
  close(): void;
}

/** Snapshots live in ICE18's own folder: /tmp in a Pterodactyl container is a small tmpfs. */
const CACHE_DIR = path.resolve(__dirname, '../../../../.ice18-cache/sqlite');
const MAX_BYTES = Number(process.env.SQLITE_PREVIEW_MAX_MB || 256) * 1024 * 1024;
const SNAPSHOT_TTL_MS = 10 * 60_000;
const MAX_OPEN = 4;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const VIEW_PERMISSIONS: ServerPermission[] = ['file.read', 'file.read-content'];

interface Snapshot {
  file: string;
  takenAt: number;
  lastUsed: number;
  size: number;
  db: DatabaseSync;
  tables?: DbTable[];
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function openSqlite(file: string): DatabaseSync {
  let sqlite: { DatabaseSync: new (file: string) => DatabaseSync };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sqlite = require('node:sqlite');
  } catch {
    throw new BadRequestException('Viewing SQLite files needs Node.js 22.13 or newer in the ICE18 server.');
  }
  const db = new sqlite.DatabaseSync(file);
  db.exec('PRAGMA query_only = ON');
  return db;
}

/**
 * Read-only viewer for SQLite files found in plugin folders. Downloads a copy (plus its
 * WAL journal, so recent writes are included), opens it with query_only on, and never
 * sends anything back to the server.
 */
@Injectable()
export class SqliteSnapshotsService implements OnModuleDestroy {
  private readonly logger = new Logger('SqliteSnapshots');
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly loading = new Map<string, Promise<Snapshot>>();
  private readonly sweeper = setInterval(() => this.sweep(), 60_000);

  constructor(
    private readonly servers: ServersService,
    private readonly ptero: PterodactylService,
  ) {
    this.sweeper.unref();
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    for (const key of [...this.snapshots.keys()]) this.drop(key);
  }

  private drop(key: string): void {
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return;
    this.snapshots.delete(key);
    try {
      snapshot.db.close();
    } catch {
      /* already closed */
    }
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(snapshot.file + suffix, { force: true });
  }

  private sweep(): void {
    for (const [key, snapshot] of this.snapshots) {
      if (Date.now() - snapshot.lastUsed > SNAPSHOT_TTL_MS) this.drop(key);
    }
  }

  private async requireAccess(user: UserRow, identifier: string): Promise<void> {
    const access = await this.servers.getForUser(user, identifier);
    const missing = VIEW_PERMISSIONS.filter((permission) => !access.permissions.includes(permission));
    if (missing.length > 0) throw new ForbiddenException(`You need these permissions on this server: ${missing.join(', ')}.`);
  }

  private resolvePath(key: string): string {
    let filePath: string;
    try {
      filePath = pathFromKey(key);
    } catch {
      throw new BadRequestException('Invalid file.');
    }
    if (!SAFE_DB_DOWNLOAD.test(filePath) || filePath.split('/').includes('..') || localDatabaseKind(filePath) !== 'sqlite') {
      throw new BadRequestException('Only SQLite files inside plugin folders can be opened.');
    }
    return filePath;
  }

  private async snapshot(identifier: string, filePath: string, refresh: boolean): Promise<Snapshot> {
    const key = `${identifier}:${filePath}`;
    const existing = this.snapshots.get(key);
    if (existing && !refresh && Date.now() - existing.takenAt < SNAPSHOT_TTL_MS) {
      existing.lastUsed = Date.now();
      return existing;
    }
    let pending = this.loading.get(key);
    if (!pending) {
      pending = this.take(identifier, filePath, key).finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }
    return pending;
  }

  private async take(identifier: string, filePath: string, key: string): Promise<Snapshot> {
    const dir = filePath.slice(0, filePath.lastIndexOf('/'));
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    const listing = await this.ptero.listFiles(identifier, dir);
    const entry = listing.find((file) => file.is_file && file.name === name);
    if (!entry) throw new NotFoundException(`${filePath} no longer exists.`);
    if (entry.size > MAX_BYTES) {
      throw new PayloadTooLargeException(
        `${name} is ${Math.round(entry.size / 1048576)} MB; previews are limited to ${Math.round(MAX_BYTES / 1048576)} MB (SQLITE_PREVIEW_MAX_MB).`,
      );
    }
    const hasWal = listing.some((file) => file.is_file && file.name === `${name}-wal` && file.size > 0);

    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    while (this.snapshots.size >= MAX_OPEN) {
      const oldest = [...this.snapshots.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) break;
      this.drop(oldest[0]);
    }
    const file = path.join(CACHE_DIR, `${createHash('sha256').update(key).digest('hex').slice(0, 16)}-${Date.now()}.db`);

    try {
      const size = await this.ptero.downloadFile(identifier, filePath, file, MAX_BYTES);
      if (hasWal) await this.ptero.downloadFile(identifier, `${filePath}-wal`, `${file}-wal`, MAX_BYTES);

      const header = Buffer.alloc(16);
      const handle = fs.openSync(file, 'r');
      fs.readSync(handle, header, 0, 16, 0);
      fs.closeSync(handle);
      if (!header.equals(SQLITE_HEADER)) throw new BadRequestException(`${name} isn't a SQLite database.`);

      const snapshot: Snapshot = { file, takenAt: Date.now(), lastUsed: Date.now(), size, db: openSqlite(file) };
      this.drop(key);
      this.snapshots.set(key, snapshot);
      return snapshot;
    } catch (error) {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
      if (error instanceof PterodactylError) {
        if (error.status === 413) throw new PayloadTooLargeException(error.message);
        throw new BadRequestException(`Couldn't download ${name}: ${error.message}`);
      }
      throw error;
    }
  }

  private run<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof Error && /SQLITE|database|malformed|no such/i.test(error.message)) {
        throw new BadRequestException(`SQLite: ${error.message}`);
      }
      throw error;
    }
  }

  private tableList(snapshot: Snapshot): DbTable[] {
    if (snapshot.tables) return snapshot.tables;
    const rows = snapshot.db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string; type: string }>;
    snapshot.tables = rows.map((row) => {
      let count: number | null = null;
      if (row.type === 'table') {
        try {
          count = Number((snapshot.db.prepare(`SELECT COUNT(*) AS total FROM ${quote(row.name)}`).get() as { total: number }).total);
        } catch {
          count = null;
        }
      }
      return { name: row.name, type: row.type === 'view' ? 'view' : 'table', rows: count, engine: 'SQLite', comment: '' };
    });
    return snapshot.tables;
  }

  private findTable(snapshot: Snapshot, table: string): DbTable {
    const found = this.tableList(snapshot).find((entry) => entry.name === table);
    if (!found) throw new NotFoundException(`Table ${table} doesn't exist in this file.`);
    return found;
  }

  async tables(user: UserRow, identifier: string, key: string, refresh: boolean): Promise<LocalDatabaseSnapshot> {
    await this.requireAccess(user, identifier);
    const snapshot = await this.snapshot(identifier, this.resolvePath(key), refresh);
    return this.run(() => ({ takenAt: new Date(snapshot.takenAt).toISOString(), size: snapshot.size, tables: this.tableList(snapshot) }));
  }

  private loadDesign(snapshot: Snapshot, table: string): DbTableDesign {
    const info = this.findTable(snapshot, table);
    const columnsRaw = snapshot.db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    const primaryKey = columnsRaw
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    const columns: DbColumn[] = columnsRaw.map((column) => {
      const type = column.type || 'ANY';
      return {
        name: column.name,
        dataType: type.split('(')[0]!.toLowerCase(),
        columnType: type,
        nullable: column.notnull === 0,
        key: column.pk > 0 ? 'PRI' : '',
        default: column.dflt_value,
        extra: column.pk > 0 && /^integer$/i.test(type) && primaryKey.length === 1 ? 'rowid alias' : '',
        autoIncrement: false,
        binary: /blob/i.test(type),
        editable: false,
      };
    });
    const indexes: DbIndex[] = (
      snapshot.db.prepare(`PRAGMA index_list(${quote(table)})`).all() as Array<{ name: string; unique: number }>
    ).map((index) => ({
      name: index.name,
      unique: index.unique === 1,
      columns: (snapshot.db.prepare(`PRAGMA index_info(${quote(index.name)})`).all() as Array<{ name: string }>).map((column) => column.name),
    }));
    if (primaryKey.length > 0) indexes.unshift({ name: 'PRIMARY', columns: primaryKey, unique: true });
    return {
      name: table,
      type: info.type,
      columns,
      primaryKey,
      indexes,
      editable: false,
      readOnlyReason: `Read-only snapshot of the file, taken ${new Date(snapshot.takenAt).toLocaleTimeString()}. Local database files can't be edited from ICE18.`,
    };
  }

  async design(user: UserRow, identifier: string, key: string, table: string): Promise<DbTableDesign> {
    await this.requireAccess(user, identifier);
    const snapshot = await this.snapshot(identifier, this.resolvePath(key), false);
    return this.run(() => this.loadDesign(snapshot, table));
  }

  async rows(
    user: UserRow,
    identifier: string,
    key: string,
    table: string,
    query: { offset?: unknown; limit?: unknown; sort?: unknown; dir?: unknown },
  ): Promise<DbRowsPage> {
    await this.requireAccess(user, identifier);
    const snapshot = await this.snapshot(identifier, this.resolvePath(key), false);
    return this.run(() => {
      const design = this.loadDesign(snapshot, table);
      const info = this.findTable(snapshot, table);
      const { offset, limit } = clampPage(query.offset, query.limit);
      const requested = typeof query.sort === 'string' ? query.sort : null;
      const sort = requested && design.columns.some((column) => column.name === requested) ? requested : (design.primaryKey[0] ?? null);
      const dir = query.dir === 'desc' ? 'desc' : 'asc';
      const columns = design.columns.map((column) => column.name);
      const select = `SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)}${sort ? ` ORDER BY ${quote(sort)} ${dir === 'desc' ? 'DESC' : 'ASC'}` : ''} LIMIT ? OFFSET ?`;
      const statement = snapshot.db.prepare(select);
      let raw: unknown[][];
      if (statement.setReturnArrays) {
        statement.setReturnArrays(true);
        raw = statement.all(limit, offset) as unknown[][];
      } else {
        raw = (statement.all(limit, offset) as Array<Record<string, unknown>>).map((row) => columns.map((column) => row[column]));
      }
      const rows: DbCell[][] = raw.map((row) =>
        row.map((value) => (value instanceof Uint8Array ? toCell(Buffer.from(value)) : typeof value === 'bigint' ? value.toString() : toCell(value))),
      );
      return { columns, rows, total: info.rows, totalIsEstimate: false, offset, limit, sort, dir };
    });
  }
}
