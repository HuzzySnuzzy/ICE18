import path from 'node:path';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { CONFIG, type AppConfig } from '../config/config';
import * as schema from './schema';

export type Database = MySql2Database<typeof schema>;

export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: mysql.Pool;
  readonly db: Database;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = mysql.createPool({ uri: config.DATABASE_URL, connectionLimit: 10 });
    this.db = drizzle(this.pool, { schema, mode: 'default' });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** Applies pending migrations from apps/api/drizzle. Runs once at startup. */
export async function runMigrations(config: AppConfig): Promise<void> {
  const connection = await mysql.createConnection({ uri: config.DATABASE_URL });
  try {
    await migrate(drizzle(connection), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await connection.end();
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
