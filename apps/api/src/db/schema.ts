import { boolean, index, int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  /** The Pterodactyl user this account controls servers as. One ICE18 account per Pterodactyl user. */
  pteroUserId: int('ptero_user_id').unique(),
  /** Bumped to sign the user out everywhere (e.g. after a password change). */
  sessionVersion: int('session_version').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export const auditLog = mysqlTable(
  'audit_log',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id'),
    action: varchar('action', { length: 64 }).notNull(),
    target: varchar('target', { length: 128 }),
    detail: text('detail'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('audit_log_user_idx').on(table.userId), index('audit_log_created_idx').on(table.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
