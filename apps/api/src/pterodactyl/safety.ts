/**
 * PTERODACTYL SAFETY RULES — READ BEFORE CHANGING
 *
 * ICE18 runs on top of an existing Pterodactyl panel that hosts servers which must
 * never be wiped. Every HTTP request ICE18 makes to Pterodactyl goes through
 * `checkPterodactylRequest()` below, and is refused unless:
 *
 *   1. the path is a plain, well-formed API path (no "..", no encoded characters), and
 *   2. it does NOT match any FORBIDDEN rule (these win over everything), and
 *   3. it DOES match an ALLOWED rule (anything not listed is refused by default), and
 *   4. file paths in the query or body are plain paths inside the server (no "..", see
 *      checkFileRequest), and file deletes stay within the limits below.
 *
 * To support a new Pterodactyl feature, add the exact endpoint to ALLOWED_RULES.
 * Never remove or weaken a FORBIDDEN rule: they are the guarantee that ICE18 cannot
 * delete or reinstall a server, wipe it, or delete/restore its backups or databases.
 *
 * Owner-approved exceptions (Nov 2026, for the file manager and user management):
 *   - deleting individual files/folders (POST files/delete), at most MAX_DELETE_ITEMS per
 *     request, never the server root, only after the user confirms in the UI;
 *   - removing a subuser (DELETE /api/client/servers/:id/users/:uuid).
 * Every other DELETE stays forbidden.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ForbiddenRule {
  method: HttpMethod;
  pattern: RegExp;
  reason: string;
  /** Owner-approved exceptions, matched against the full path. */
  except?: RegExp;
}

export interface AllowedRule {
  method: HttpMethod;
  pattern: RegExp;
}

const SEGMENT = '[A-Za-z0-9-]+';

/** Turns "/api/client/servers/:id/power" into an exact-match regex. */
function route(method: HttpMethod, template: string): AllowedRule {
  const source = template
    .split('/')
    .map((part) => (part.startsWith(':') ? SEGMENT : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return { method, pattern: new RegExp(`^${source}$`) };
}

export const FORBIDDEN_RULES: readonly ForbiddenRule[] = [
  {
    method: 'DELETE',
    pattern: /^\/api\/application(\/|$)/,
    reason: 'Deleting through the Application API (servers, users, nodes, eggs, databases) is never allowed.',
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/client\/servers(\/|$)/,
    reason: 'Deleting server data (backups, databases, schedules, allocations) is never allowed.',
    // Removing a subuser deletes no data; the owner asked for user management.
    except: /^\/api\/client\/servers\/[A-Za-z0-9-]+\/users\/[A-Za-z0-9-]+$/,
  },
  {
    method: 'POST',
    pattern: /^\/api\/application\/servers\/[^/]+\/reinstall$/,
    reason: 'Reinstalling a server can overwrite or wipe its files.',
  },
  {
    method: 'POST',
    pattern: /^\/api\/client\/servers\/[^/]+\/settings\/reinstall$/,
    reason: 'Reinstalling a server can overwrite or wipe its files.',
  },
  {
    method: 'POST',
    pattern: /^\/api\/client\/servers\/[^/]+\/backups\/[^/]+\/restore$/,
    reason: 'Restoring a backup can wipe the current server files.',
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/application\/servers\/[^/]+\/startup$/,
    reason: "Changing a server's egg or startup settings can trigger a reinstall.",
  },
  {
    method: 'POST',
    pattern: /^\/api\/client\/servers\/[^/]+\/databases\/[^/]+\/rotate-password$/,
    reason: 'Resetting a database password breaks every plugin that uses that database.',
  },
];

/** Everything ICE18 is currently allowed to do. Anything else is refused. */
export const ALLOWED_RULES: readonly AllowedRule[] = [
  // Application API (admin key): reading.
  route('GET', '/api/application/servers'),
  route('GET', '/api/application/servers/:id'),
  route('GET', '/api/application/users'),
  route('GET', '/api/application/users/:id'),
  route('GET', '/api/application/nodes'),
  route('GET', '/api/application/nodes/:id'),
  route('GET', '/api/application/locations'),
  route('GET', '/api/application/nests'),
  route('GET', '/api/application/nests/:id/eggs'),
  route('GET', '/api/application/nests/:id/eggs/:egg'),

  // Prefabs and the store: create Pterodactyl users and servers, suspend unpaid servers and
  // unsuspend them once paid. Servers are never deleted or reinstalled by ICE18.
  route('POST', '/api/application/users'),
  route('POST', '/api/application/servers'),
  route('POST', '/api/application/servers/:id/suspend'),
  route('POST', '/api/application/servers/:id/unsuspend'),

  // Client API.
  route('GET', '/api/client'),
  route('GET', '/api/client/account'),
  route('GET', '/api/client/servers/:id'),
  route('GET', '/api/client/servers/:id/resources'),
  route('GET', '/api/client/servers/:id/websocket'),
  route('POST', '/api/client/servers/:id/power'),

  // Plugin database setup: read files, write plugin config files (see SAFE_CONFIG_WRITE),
  // list and create databases. Never delete, rename, move or decompress anything.
  route('GET', '/api/client/servers/:id/files/list'),
  route('GET', '/api/client/servers/:id/files/contents'),
  route('POST', '/api/client/servers/:id/files/write'),
  route('GET', '/api/client/servers/:id/databases'),
  route('POST', '/api/client/servers/:id/databases'),

  // File manager. Paths are checked by checkFileRequest; deletes are capped.
  route('GET', '/api/client/servers/:id/files/download'),
  route('GET', '/api/client/servers/:id/files/upload'),
  route('POST', '/api/client/servers/:id/files/create-folder'),
  route('PUT', '/api/client/servers/:id/files/rename'),
  route('POST', '/api/client/servers/:id/files/copy'),
  route('POST', '/api/client/servers/:id/files/compress'),
  route('POST', '/api/client/servers/:id/files/decompress'),
  route('POST', '/api/client/servers/:id/files/delete'),

  // Users (subusers) and the permission list.
  route('GET', '/api/client/permissions'),
  route('GET', '/api/client/servers/:id/users'),
  route('POST', '/api/client/servers/:id/users'),
  route('GET', '/api/client/servers/:id/users/:uuid'),
  route('POST', '/api/client/servers/:id/users/:uuid'),
  route('DELETE', '/api/client/servers/:id/users/:uuid'),

  // Startup variables and the server's name. (Changing the docker image or egg is not allowed.)
  route('GET', '/api/client/servers/:id/startup'),
  route('PUT', '/api/client/servers/:id/startup/variable'),
  route('POST', '/api/client/servers/:id/settings/rename'),

  // Network: list, add, annotate and pick the primary port. (Removing ports is not allowed.)
  route('GET', '/api/client/servers/:id/network/allocations'),
  route('POST', '/api/client/servers/:id/network/allocations'),
  route('POST', '/api/client/servers/:id/network/allocations/:allocation'),
  route('POST', '/api/client/servers/:id/network/allocations/:allocation/primary'),
];

/** Most files/folders one delete request may remove. */
export const MAX_DELETE_ITEMS = 50;

const FILE_OPERATION = /^\/api\/client\/servers\/[^/]+\/files\/([a-z-]+)$/;

/**
 * The only files ICE18 may download: SQLite database files (and their WAL journal)
 * inside a plugin's folder, or one folder below it.
 */
export const SAFE_DB_DOWNLOAD =
  /^\/plugins\/[A-Za-z0-9 _.+-]{1,64}(\/[A-Za-z0-9 _.+-]{1,64})?\/[A-Za-z0-9 _.+-]{1,96}\.(db|sqlite|sqlite3|db3)(-wal)?$/;

/** YAML configs inside a plugin's folder, or ICE18's backup copies of them. */
export const SAFE_CONFIG_WRITE =
  /^\/plugins\/[A-Za-z0-9 _.+-]{1,64}\/[A-Za-z0-9 _.+-]{1,64}\.ya?ml(\.ice18-backup-\d{8}-\d{6})?$/;

/** An absolute path inside the server: starts with "/", no "." or ".." parts, no control characters. */
export function safeFilePath(file: unknown): file is string {
  return (
    typeof file === 'string' &&
    file.length <= 4096 &&
    file.startsWith('/') &&
    !/[\x00-\x1f]/.test(file) &&
    !file.split('/').some((part) => part === '..' || part === '.')
  );
}

/** A path relative to some root: non-empty parts, no "." or "..", no leading "/". */
export function safeRelativePath(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 1024 &&
    !name.startsWith('/') &&
    !/[\x00-\x1f]/.test(name) &&
    name.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

type Body = Record<string, unknown> | undefined;

/** Checks the paths in a file-manager request. Returns a reason when it must be refused. */
function checkFileRequest(operation: string, query: Readonly<Record<string, unknown>>, body: Body): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value : null);
  switch (operation) {
    case 'list':
      return safeFilePath(query.directory) ? null : `Refused unsafe directory ${JSON.stringify(query.directory)}.`;
    case 'contents':
    case 'download':
    case 'write':
      return safeFilePath(query.file) ? null : `Refused unsafe file path ${JSON.stringify(query.file)}.`;
    case 'upload':
      return null; // Only returns a signed URL; the target directory is checked where it's used.
    case 'create-folder':
      return safeFilePath(b.root) && safeRelativePath(b.name) ? null : 'Refused unsafe folder path.';
    case 'copy':
      return safeFilePath(b.location) && b.location !== '/' ? null : 'Refused unsafe copy path.';
    case 'decompress':
      return safeFilePath(b.root) && safeRelativePath(b.file) ? null : 'Refused unsafe archive path.';
    case 'compress': {
      const files = list(b.files);
      return safeFilePath(b.root) && files && files.length > 0 && files.length <= 1000 && files.every(safeRelativePath)
        ? null
        : 'Refused unsafe files to compress.';
    }
    case 'rename': {
      const files = list(b.files);
      const ok =
        safeFilePath(b.root) &&
        files &&
        files.length > 0 &&
        files.length <= 100 &&
        files.every((entry) => {
          const { from, to } = (entry ?? {}) as Record<string, unknown>;
          return safeRelativePath(from) && safeRelativePath(to);
        });
      return ok ? null : 'Refused unsafe rename.';
    }
    case 'delete': {
      const files = list(b.files);
      if (!safeFilePath(b.root) || !files || files.length === 0) return 'Refused delete: nothing valid to delete.';
      if (files.length > MAX_DELETE_ITEMS) return `Refused delete of ${files.length} items: at most ${MAX_DELETE_ITEMS} at a time.`;
      if (!files.every(safeRelativePath)) return 'Refused delete: unsafe file name.';
      return null;
    }
    default:
      return null;
  }
}

/** Plain API paths only: no query string, no "..", no "%", no double slashes. */
const SAFE_PATH = /^\/api\/(application|client)(\/[A-Za-z0-9_-]+)*$/;

export type SafetyVerdict = { allowed: true } | { allowed: false; reason: string };

export function checkPterodactylRequest(
  method: string,
  path: string,
  allowed: readonly AllowedRule[] = ALLOWED_RULES,
  query: Readonly<Record<string, string | number | undefined>> = {},
  body?: unknown,
): SafetyVerdict {
  const upperMethod = method.toUpperCase();

  if (!SAFE_PATH.test(path)) {
    return { allowed: false, reason: `Refused malformed Pterodactyl API path: ${JSON.stringify(path)}` };
  }

  for (const rule of FORBIDDEN_RULES) {
    if (rule.method === upperMethod && rule.pattern.test(path) && !rule.except?.test(path)) {
      return { allowed: false, reason: `${rule.reason} (${upperMethod} ${path})` };
    }
  }

  const fileOperation = FILE_OPERATION.exec(path)?.[1];
  if (fileOperation) {
    const problem = checkFileRequest(fileOperation, query, body as Body);
    if (problem) return { allowed: false, reason: problem };
  }

  if (allowed.some((rule) => rule.method === upperMethod && rule.pattern.test(path))) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `${upperMethod} ${path} is not on ICE18's list of allowed Pterodactyl requests.`,
  };
}

export class BlockedPterodactylRequestError extends Error {
  constructor(reason: string) {
    super(`Blocked by ICE18 safety rules: ${reason}`);
    this.name = 'BlockedPterodactylRequestError';
  }
}

export function assertPterodactylRequestAllowed(
  method: string,
  path: string,
  query: Readonly<Record<string, string | number | undefined>> = {},
  body?: unknown,
): void {
  const verdict = checkPterodactylRequest(method, path, ALLOWED_RULES, query, body);
  if (!verdict.allowed) {
    throw new BlockedPterodactylRequestError(verdict.reason);
  }
}
