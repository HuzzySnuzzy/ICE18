import { boolean, datetime, index, int, json, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

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
  /** Store balance. Only changed together with a credit_transactions row. */
  credits: int('credits').notNull().default(0),
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

/** Every change to a user's credits, with why. */
export const creditTransactions = mysqlTable(
  'credit_transactions',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id').notNull(),
    /** Positive: added. Negative: spent. */
    amount: int('amount').notNull(),
    balanceAfter: int('balance_after').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    /** Admin who made a manual adjustment. */
    createdBy: int('created_by'),
    subscriptionId: int('subscription_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('credit_tx_user_idx').on(table.userId)],
);

/** Server templates admins define; the store sells the visible ones. */
export const prefabs = mysqlTable('prefabs', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description').notNull(),
  nestId: int('nest_id').notNull(),
  eggId: int('egg_id').notNull(),
  dockerImage: varchar('docker_image', { length: 255 }).notNull(),
  startup: text('startup').notNull(),
  /** Egg variable values, e.g. { "MINECRAFT_VERSION": "1.21.4" }. */
  environment: json('environment').$type<Record<string, string>>().notNull(),
  memory: int('memory').notNull(),
  swap: int('swap').notNull().default(0),
  disk: int('disk').notNull(),
  io: int('io').notNull().default(500),
  cpu: int('cpu').notNull(),
  databases: int('databases').notNull().default(0),
  allocations: int('allocations').notNull().default(1),
  backups: int('backups').notNull().default(0),
  locationIds: json('location_ids').$type<number[]>().notNull(),
  /** Monthly price in credits. */
  price: int('price').notNull().default(0),
  storeVisible: boolean('store_visible').notNull().default(false),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

/** A server bought from the store, renewed every 30 days from the owner's credits. */
export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id').notNull(),
    prefabId: int('prefab_id'),
    pteroServerId: int('ptero_server_id').notNull(),
    serverIdentifier: varchar('server_identifier', { length: 64 }).notNull(),
    name: varchar('name', { length: 191 }).notNull(),
    price: int('price').notNull(),
    /** active: paid up. suspended: unpaid (server suspended, never deleted). cancelled: won't renew. */
    status: varchar('status', { length: 16 }).notNull(),
    /** Set when cancelled: the server stays usable until the paid period ends. */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    // DATETIME, not TIMESTAMP: older MariaDB gives the first TIMESTAMP column "ON UPDATE NOW()".
    paidUntil: datetime('paid_until', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('subscriptions_user_idx').on(table.userId), uniqueIndex('subscriptions_server_idx').on(table.pteroServerId)],
);

export type UserRow = typeof users.$inferSelect;
export type PrefabRow = typeof prefabs.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
