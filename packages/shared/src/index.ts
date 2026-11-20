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
