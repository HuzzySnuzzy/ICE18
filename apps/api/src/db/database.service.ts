import path from 'node:path';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { CONFIG, type AppConfig, type DatabaseConnection } from '../config/config';
import * as schema from './schema';

export type Database = MySql2Database<typeof schema>;

export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: mysql.Pool;
  readonly db: Database;

  constructor(@Inject(CONFIG) config: AppConfig) {
    if (!config.database) throw new Error('Database settings are missing.');
    this.pool = mysql.createPool({ ...config.database, connectionLimit: 10 });
    this.db = drizzle(this.pool, { schema, mode: 'default' });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** Applies pending migrations from apps/api/drizzle. Runs once at startup. */
export async function runMigrations(database: DatabaseConnection): Promise<void> {
  const connection = await mysql.createConnection({ ...database, connectTimeout: 10_000 });
  try {
    await migrate(drizzle(connection), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await connection.end();
  }
}

/** Turns a MySQL connection error into advice someone running Pterodactyl can act on. */
export function explainDatabaseError(error: unknown, database: DatabaseConnection): string {
  const code = (error as { code?: string }).code ?? '';
  const message = (error as Error).message ?? String(error);
  const host = 'host' in database ? database.host : new URL(database.uri).hostname;
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);

  switch (code) {
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENOTFOUND':
      return [
        `Can't reach the database at ${host} (${code}).`,
        local
          ? 'Inside a Pterodactyl server, 127.0.0.1/localhost is the container itself, not the node. Use the Pterodactyl network gateway instead (usually 172.18.0.1), or the node\'s IP.'
          : 'Check the host and port, and that a firewall allows it.',
        'MySQL/MariaDB must also listen on that address: set bind-address = 0.0.0.0 (or 172.18.0.1) in its config and restart it.',
      ].join('\n');
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_HOST_NOT_PRIVILEGED':
      return [
        `The database refused the login (${code}).`,
        'Check the username and password on the server\'s Databases tab (click the eye icon to see the password).',
        'If the database was created with "Connections from" set to a specific IP, recreate it with % so the container can connect.',
      ].join('\n');
    case 'ER_BAD_DB_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
      return `The database name is wrong or this user can't use it (${code}). Copy the name exactly from the Databases tab, e.g. s12_ice18.`;
    default:
      return `Could not set up the database: ${message}`;
  }
}

/** MySQL duplicate-key errors, whether or not the ORM wrapped them. */
export function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: string }).code === 'ER_DUP_ENTRY') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
