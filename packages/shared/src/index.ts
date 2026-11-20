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
