// Types shared by the API and the web app.

export interface PublicUser {
  id: number;
  email: string;
  username: string;
  isAdmin: boolean;
  /** The Pterodactyl user this account is linked to, if any. */
  pteroUserId: number | null;
  createdAt: string;
}

export interface MetaInfo {
  /** True when no account exists yet: the first sign-up becomes the admin. */
  needsSetup: boolean;
  registrationOpen: boolean;
  pterodactylConfigured: boolean;
}

export const POWER_SIGNALS = ['start', 'stop', 'restart', 'kill'] as const;
export type PowerSignal = (typeof POWER_SIGNALS)[number];

/** Subset of Pterodactyl's subuser permission names that ICE18 uses. */
export const SERVER_PERMISSIONS = [
  'websocket.connect',
  'control.console',
  'control.start',
  'control.stop',
  'control.restart',
  'file.read',
  'file.read-content',
  'file.update',
  'database.read',
  'database.create',
  'database.view_password',
] as const;
export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

/** Where a server lives. Only Pterodactyl for now; native Wings nodes later. */
export type ServerSource = 'pterodactyl';

export interface ServerSummary {
  /** Short identifier used in URLs (Pterodactyl's 8-character identifier). */
  identifier: string;
  uuid: string;
  name: string;
  description: string;
  source: ServerSource;
  node: string | null;
  egg: string | null;
  /** "installing", "install_failed", "suspended", "restoring_backup" or null when normal. */
  status: string | null;
  suspended: boolean;
  limits: {
    /** MiB, 0 = unlimited */
    memory: number;
    /** MiB, 0 = unlimited */
    disk: number;
    /** percent of one core, 0 = unlimited */
    cpu: number;
  };
  ownerPteroUserId: number;
  /** What the current viewer may do on this server. */
  permissions: ServerPermission[];
}

export interface ServerResources {
  state: string;
  isSuspended: boolean;
  memoryBytes: number;
  cpuPercent: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
}

/** Messages on the console websocket, in both directions. Same shape Wings uses. */
export interface ConsoleMessage {
  event: string;
  args?: unknown[];
}

export interface PterodactylUserSummary {
  id: number;
  username: string;
  email: string;
  rootAdmin: boolean;
}

export interface AuditEntry {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
}

export interface UpdateStatus {
  /** False when ICE18 isn't running from a git checkout (updates are then manual). */
  supported: boolean;
  branch: string;
  currentCommit: string | null;
  latestCommit: string | null;
  updateAvailable: boolean;
  /** Tracked files were edited by hand; auto-update won't overwrite them. */
  localChanges: boolean;
  autoUpdate: boolean;
  /** Started via scripts/start.sh, so the panel can restart itself to apply updates. */
  canRestart: boolean;
  checking: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

/** A database that belongs to a Pterodactyl server (its "Databases" tab). */
export interface ServerDatabase {
  id: string;
  name: string;
  username: string;
  /** Address as configured on the Pterodactyl database host. */
  host: string;
  port: number;
  /** Address plugins inside the server's container should use (127.0.0.1 is swapped for the Docker gateway). */
  pluginHost: string;
  connectionsFrom: string;
}

export interface ServerDatabaseCredentials extends ServerDatabase {
  password: string;
}

/**
 * supported: ICE18 knows this plugin and can set it up in one click.
 * possible:  its config has database settings, but ICE18 doesn't know its layout; set it up by hand.
 * none:      no sign of database support.
 */
export type PluginSqlSupport = 'supported' | 'possible' | 'none';

export interface PluginInfo {
  /** Display name: the plugin's folder name, or its jar name if it has never run. */
  name: string;
  folder: string | null;
  jar: string | null;
  support: PluginSqlSupport;
  /** For supported plugins. */
  recipeId?: string;
  /** "mysql": already uses a MySQL database; "local": file storage (H2/SQLite); "not-generated": no config yet. */
  storage?: 'mysql' | 'local' | 'not-generated';
  /** Human summary, e.g. "MySQL: s12_luckperms on 172.18.0.1:3306". */
  summary: string;
  configFile?: string;
  /** For possible plugins: where the database settings are, e.g. "database.mysql". */
  settingsPath?: string;
  /** Name of the server database this plugin is pointed at, when it matches one. */
  database?: string | null;
}

export interface PluginScan {
  hasPluginsFolder: boolean;
  plugins: PluginInfo[];
  databases: ServerDatabase[];
  scannedAt: string;
}

export interface PluginSetupRequest {
  /** Use an existing server database... */
  databaseId?: string;
  /** ...or create one with this name (Pterodactyl prefixes it, e.g. s12_luckperms). */
  newDatabaseName?: string;
  /** Override the address written into the plugin config. */
  host?: string;
}

export interface PluginSetupResult {
  plugin: string;
  configFile: string;
  backupFile: string;
  database: ServerDatabase;
  changed: string[];
}

// ---- Database browser ----

export interface DbTable {
  name: string;
  type: 'table' | 'view';
  /** Row count estimate from MySQL (null for views). */
  rows: number | null;
  engine: string | null;
  comment: string;
}

export interface DbColumn {
  name: string;
  /** e.g. "varchar" */
  dataType: string;
  /** e.g. "varchar(36)" */
  columnType: string;
  nullable: boolean;
  key: string;
  default: string | null;
  extra: string;
  autoIncrement: boolean;
  /** Binary data is shown as hex and can't be edited. */
  binary: boolean;
  editable: boolean;
}

export interface DbIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface DbTableDesign {
  name: string;
  type: 'table' | 'view';
  columns: DbColumn[];
  primaryKey: string[];
  indexes: DbIndex[];
  /** Whether rows can be changed at all (needs a primary key). Separate from the server lock. */
  editable: boolean;
  readOnlyReason: string | null;
}

/** A cell: text, NULL, or binary data (with hex for short values). */
export type DbCell = string | null | { binary: number; hex?: string };

export interface DbRowsPage {
  columns: string[];
  rows: DbCell[][];
  total: number | null;
  totalIsEstimate: boolean;
  offset: number;
  limit: number;
  sort: string | null;
  dir: 'asc' | 'desc';
}

/** Primary key values that identify one row. */
export type DbRowKey = Record<string, string>;

// ---- Databases page (all servers) ----

/** A Pterodactyl database plus the server it belongs to. */
export interface PanelDatabase extends ServerDatabase {
  serverIdentifier: string;
  serverName: string;
  /** The viewer may open its tables (database.read + database.view_password on the owner server). */
  canBrowse: boolean;
}

/** A plugin whose config points at a database. */
export interface DatabaseUsage {
  databaseName: string;
  /** "host:port" written in the plugin's config. */
  host: string | null;
  /** Null when the viewer can't see that server. */
  serverIdentifier: string | null;
  serverName: string;
  plugin: string;
  configFile: string | null;
}

export interface DatabaseUsageIndex {
  usages: DatabaseUsage[];
  /** Admins only: databases plugins use that Pterodactyl doesn't manage (e.g. an external MySQL). */
  unmanaged: Array<{ databaseName: string; host: string | null }>;
  scannedAt: string;
  /** Servers whose plugins couldn't be scanned. */
  failedServers: number;
}

export interface DatabaseLockServer {
  /** Null when the viewer can't see that server. */
  identifier: string | null;
  name: string;
  state: string;
  role: 'owner' | 'plugin';
  plugins: string[];
  canStop: boolean;
}

export interface DatabaseLockStatus {
  /** Read-only while the owner server or any server whose plugins use the database isn't offline. */
  locked: boolean;
  servers: DatabaseLockServer[];
  checkedAt: string;
}

// ---- Local database files (SQLite / H2 inside plugin folders) ----

/**
 * in-use:       the plugin stores its data in this file.
 * leftover:     the plugin has switched to MySQL; this is an old copy.
 * unreferenced: the plugin's config doesn't mention it (a "loose" database file).
 */
export type LocalDatabaseStatus = 'in-use' | 'leftover' | 'unreferenced';

export interface LocalDatabaseFile {
  /** Opaque id used in URLs for this file. */
  key: string;
  serverIdentifier: string;
  serverName: string;
  /** Plugin folder name. */
  plugin: string;
  path: string;
  name: string;
  size: number;
  modifiedAt: string | null;
  /** sqlite files can be opened; h2 files (Java-only) can only be listed. */
  kind: 'sqlite' | 'h2';
  status: LocalDatabaseStatus;
  note: string;
}

export interface LocalDatabaseSnapshot {
  takenAt: string;
  size: number;
  tables: DbTable[];
}
