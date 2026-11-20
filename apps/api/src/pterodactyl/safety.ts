/**
 * PTERODACTYL SAFETY RULES — READ BEFORE CHANGING
 *
 * ICE18 runs on top of an existing Pterodactyl panel that hosts servers which must
 * never be wiped. Every HTTP request ICE18 makes to Pterodactyl goes through
 * `checkPterodactylRequest()` below, and is refused unless:
 *
 *   1. the path is a plain, well-formed API path (no "..", no encoded characters), and
 *   2. it does NOT match any FORBIDDEN rule (these win over everything), and
 *   3. it DOES match an ALLOWED rule (anything not listed is refused by default).
 *
 * To support a new Pterodactyl feature, add the exact endpoint to ALLOWED_RULES.
 * Never remove or weaken a FORBIDDEN rule: they are the guarantee that ICE18 cannot
 * delete, reinstall or wipe a Pterodactyl server, its files, backups or databases.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ForbiddenRule {
  method: HttpMethod;
  pattern: RegExp;
  reason: string;
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
    reason: 'Deleting server data (backups, databases, schedules, subusers, allocations) is never allowed.',
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
    pattern: /^\/api\/client\/servers\/[^/]+\/files\/delete$/,
    reason: 'Deleting server files is never allowed.',
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
];

/** Everything ICE18 is currently allowed to do. Anything else is refused. */
export const ALLOWED_RULES: readonly AllowedRule[] = [
  // Application API (admin key): read-only.
  route('GET', '/api/application/servers'),
  route('GET', '/api/application/servers/:id'),
  route('GET', '/api/application/users'),
  route('GET', '/api/application/users/:id'),
  route('GET', '/api/application/nodes'),
  route('GET', '/api/application/nodes/:id'),
  route('GET', '/api/application/locations'),

  // Client API.
  route('GET', '/api/client'),
  route('GET', '/api/client/account'),
  route('GET', '/api/client/servers/:id'),
  route('GET', '/api/client/servers/:id/resources'),
  route('GET', '/api/client/servers/:id/websocket'),
  route('POST', '/api/client/servers/:id/power'),
];

/** Plain API paths only: no query string, no "..", no "%", no double slashes. */
const SAFE_PATH = /^\/api\/(application|client)(\/[A-Za-z0-9_-]+)*$/;

export type SafetyVerdict = { allowed: true } | { allowed: false; reason: string };

export function checkPterodactylRequest(
  method: string,
  path: string,
  allowed: readonly AllowedRule[] = ALLOWED_RULES,
): SafetyVerdict {
  const upperMethod = method.toUpperCase();

  if (!SAFE_PATH.test(path)) {
    return { allowed: false, reason: `Refused malformed Pterodactyl API path: ${JSON.stringify(path)}` };
  }

  for (const rule of FORBIDDEN_RULES) {
    if (rule.method === upperMethod && rule.pattern.test(path)) {
      return { allowed: false, reason: `${rule.reason} (${upperMethod} ${path})` };
    }
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

export function assertPterodactylRequestAllowed(method: string, path: string): void {
  const verdict = checkPterodactylRequest(method, path);
  if (!verdict.allowed) {
    throw new BlockedPterodactylRequestError(verdict.reason);
  }
}
