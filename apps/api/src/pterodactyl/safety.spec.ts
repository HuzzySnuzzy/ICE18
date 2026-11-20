import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RULES,
  MAX_DELETE_ITEMS,
  SAFE_DB_DOWNLOAD,
  BlockedPterodactylRequestError,
  assertPterodactylRequestAllowed,
  checkPterodactylRequest,
  type AllowedRule,
} from './safety';

const everything: AllowedRule[] = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => ({
  method,
  pattern: /.*/,
}));

describe('Pterodactyl safety rules', () => {
  describe('never allows anything that can wipe a server', () => {
    const wipes: Array<[string, string]> = [
      ['DELETE', '/api/application/servers/12'],
      ['DELETE', '/api/application/servers/12/force'],
      ['DELETE', '/api/application/servers/12/databases/3'],
      ['DELETE', '/api/application/users/5'],
      ['DELETE', '/api/application/nodes/1'],
      ['DELETE', '/api/application/nests/1/eggs/2'],
      ['POST', '/api/application/servers/12/reinstall'],
      ['PATCH', '/api/application/servers/12/startup'],
      ['POST', '/api/client/servers/1a2b3c4d/settings/reinstall'],
      ['POST', '/api/client/servers/1a2b3c4d/backups/abc-123/restore'],
      ['DELETE', '/api/client/servers/1a2b3c4d/backups/abc-123'],
      ['DELETE', '/api/client/servers/1a2b3c4d/databases/xyz'],
      ['DELETE', '/api/client/servers/1a2b3c4d/schedules/4'],
      ['DELETE', '/api/client/servers/1a2b3c4d/network/allocations/9'],
      ['delete', '/api/application/servers/12'],
    ];

    it.each(wipes)('%s %s is refused', (method, path) => {
      expect(checkPterodactylRequest(method, path).allowed).toBe(false);
      expect(() => assertPterodactylRequestAllowed(method, path)).toThrow(BlockedPterodactylRequestError);
    });

    it.each(wipes)('%s %s stays refused even if someone allowlists everything', (method, path) => {
      expect(checkPterodactylRequest(method, path, everything).allowed).toBe(false);
    });
  });

  describe('refuses tricks that could sneak past the rules', () => {
    const tricks: Array<[string, string]> = [
      ['GET', '/api/client/servers/abc/../../application/servers/1'],
      ['GET', '/api/client/servers/abc%2F..%2Freinstall'],
      ['GET', '/api/client//servers/abc'],
      ['GET', '/api/client/servers/abc/'],
      ['GET', '/api/client/servers/abc?x=1'],
      ['GET', 'https://evil.example/api/client'],
      ['GET', '/api/remote/servers'],
      ['GET', ''],
    ];

    it.each(tricks)('%s %s is refused', (method, path) => {
      expect(checkPterodactylRequest(method, path, everything).allowed).toBe(false);
    });
  });

  it('refuses endpoints that are not on the allowlist', () => {
    for (const [method, path] of [
      ['POST', '/api/application/servers'],
      ['PATCH', '/api/application/servers/12/details'],
      ['POST', '/api/application/servers/12/suspend'],
      ['POST', '/api/client/servers/abc/files/write'],
      ['POST', '/api/client/servers/abc/files/rename'],
      ['POST', '/api/client/servers/abc/files/decompress'],
      ['PUT', '/api/client/servers/abc/settings/docker-image'],
      ['GET', '/api/client/servers/abc/files/contents'],
    ] as const) {
      expect(checkPterodactylRequest(method, path).allowed, `${method} ${path}`).toBe(false);
    }
  });

  it('allows what milestone 1 needs', () => {
    for (const [method, path] of [
      ['GET', '/api/application/servers'],
      ['GET', '/api/application/servers/12'],
      ['GET', '/api/application/users'],
      ['GET', '/api/client/account'],
      ['GET', '/api/client/servers/1a2b3c4d/resources'],
      ['GET', '/api/client/servers/1a2b3c4d/websocket'],
      ['POST', '/api/client/servers/1a2b3c4d/power'],
    ] as const) {
      expect(checkPterodactylRequest(method, path).allowed, `${method} ${path}`).toBe(true);
    }
  });

  it('allows exactly one kind of DELETE: removing a subuser', () => {
    const deletes = ALLOWED_RULES.filter((rule) => rule.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(checkPterodactylRequest('DELETE', '/api/client/servers/1a2b3c4d/users/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab').allowed).toBe(true);
    // Anything else under a server stays forbidden, even near the users path.
    for (const path of [
      '/api/client/servers/1a2b3c4d/users',
      '/api/client/servers/1a2b3c4d/users/x/extra',
      '/api/client/servers/1a2b3c4d/backups/x',
      '/api/client/servers/1a2b3c4d/network/allocations/7',
    ]) {
      expect(checkPterodactylRequest('DELETE', path, everything).allowed, path).toBe(false);
    }
  });
});

describe('file manager rules', () => {
  const file = (method: string, op: string, query: Record<string, string> = {}, body?: unknown) =>
    checkPterodactylRequest(method, `/api/client/servers/abcd1234/files/${op}`, ALLOWED_RULES, query, body).allowed;

  it('reads, writes and downloads any file inside the server, but never with path tricks', () => {
    for (const path of ['/server.properties', '/plugins/LuckPerms/config.yml', '/world/level.dat', '/start.sh']) {
      expect(file('GET', 'contents', { file: path }), path).toBe(true);
      expect(file('POST', 'write', { file: path }), path).toBe(true);
      expect(file('GET', 'download', { file: path }), path).toBe(true);
    }
    for (const path of ['/plugins/../../etc/passwd', 'relative.txt', '/a/./b', '/bad\u0000name', '']) {
      expect(file('GET', 'contents', { file: path }), path).toBe(false);
      expect(file('POST', 'write', { file: path }), path).toBe(false);
      expect(file('GET', 'download', { file: path }), path).toBe(false);
    }
    expect(file('GET', 'contents')).toBe(false);
    expect(file('GET', 'list', { directory: '/plugins' })).toBe(true);
    expect(file('GET', 'list', { directory: '/../' })).toBe(false);
  });

  it('allows deleting a few files after the UI confirmed it', () => {
    expect(file('POST', 'delete', {}, { root: '/plugins', files: ['Old.jar', 'OldPlugin'] })).toBe(true);
    expect(file('POST', 'delete', {}, { root: '/', files: ['crash-reports'] })).toBe(true);
  });

  it.each([
    ['no body', undefined],
    ['no files', { root: '/', files: [] }],
    ['the root itself', { root: '/', files: [''] }],
    ['traversal', { root: '/plugins', files: ['../world'] }],
    ['absolute names', { root: '/', files: ['/world'] }],
    ['dot', { root: '/plugins', files: ['.'] }],
    ['an unsafe root', { root: '/plugins/..', files: ['x'] }],
    ['too many at once', { root: '/', files: Array.from({ length: MAX_DELETE_ITEMS + 1 }, (_, i) => `f${i}`) }],
  ])('refuses deleting %s', (_label, body) => {
    expect(file('POST', 'delete', {}, body)).toBe(false);
  });

  it('checks paths for every other file operation', () => {
    expect(file('POST', 'create-folder', {}, { root: '/plugins', name: 'New' })).toBe(true);
    expect(file('POST', 'create-folder', {}, { root: '/plugins', name: '../New' })).toBe(false);
    expect(file('PUT', 'rename', {}, { root: '/', files: [{ from: 'a.txt', to: 'b/a.txt' }] })).toBe(true);
    expect(file('PUT', 'rename', {}, { root: '/', files: [{ from: 'a.txt', to: '../a.txt' }] })).toBe(false);
    expect(file('POST', 'copy', {}, { location: '/server.properties' })).toBe(true);
    expect(file('POST', 'copy', {}, { location: '/' })).toBe(false);
    expect(file('POST', 'compress', {}, { root: '/', files: ['world', 'plugins'] })).toBe(true);
    expect(file('POST', 'compress', {}, { root: '/', files: ['../x'] })).toBe(false);
    expect(file('POST', 'decompress', {}, { root: '/plugins', file: 'pack.zip' })).toBe(true);
    expect(file('POST', 'decompress', {}, { root: '/plugins', file: '../pack.zip' })).toBe(false);
    expect(file('GET', 'upload')).toBe(true);
  });

  it('still refuses file operations ICE18 does not offer', () => {
    for (const op of ['chmod', 'pull']) expect(file('POST', op, {}, {}), op).toBe(false);
  });
});

describe('databases, users, startup and network', () => {
  const allowed = (method: string, path: string) => checkPterodactylRequest(method, path).allowed;

  it('allows listing and creating databases but never deleting them or resetting passwords', () => {
    expect(allowed('GET', '/api/client/servers/abcd1234/databases')).toBe(true);
    expect(allowed('POST', '/api/client/servers/abcd1234/databases')).toBe(true);
    expect(checkPterodactylRequest('DELETE', '/api/client/servers/abcd1234/databases/xyz', everything).allowed).toBe(false);
    expect(checkPterodactylRequest('POST', '/api/client/servers/abcd1234/databases/xyz/rotate-password', everything).allowed).toBe(false);
  });

  it('allows managing subusers', () => {
    expect(allowed('GET', '/api/client/permissions')).toBe(true);
    expect(allowed('GET', '/api/client/servers/abcd1234/users')).toBe(true);
    expect(allowed('POST', '/api/client/servers/abcd1234/users')).toBe(true);
    expect(allowed('POST', '/api/client/servers/abcd1234/users/0b1c2d3e-aaaa')).toBe(true);
  });

  it('allows startup variables and renaming, but not changing the image, egg or reinstalling', () => {
    expect(allowed('GET', '/api/client/servers/abcd1234/startup')).toBe(true);
    expect(allowed('PUT', '/api/client/servers/abcd1234/startup/variable')).toBe(true);
    expect(allowed('POST', '/api/client/servers/abcd1234/settings/rename')).toBe(true);
    expect(allowed('PUT', '/api/client/servers/abcd1234/settings/docker-image')).toBe(false);
    expect(checkPterodactylRequest('POST', '/api/client/servers/abcd1234/settings/reinstall', everything).allowed).toBe(false);
    expect(checkPterodactylRequest('PATCH', '/api/application/servers/12/startup', everything).allowed).toBe(false);
  });

  it('allows adding and editing ports, but never removing them', () => {
    expect(allowed('GET', '/api/client/servers/abcd1234/network/allocations')).toBe(true);
    expect(allowed('POST', '/api/client/servers/abcd1234/network/allocations')).toBe(true);
    expect(allowed('POST', '/api/client/servers/abcd1234/network/allocations/12')).toBe(true);
    expect(allowed('POST', '/api/client/servers/abcd1234/network/allocations/12/primary')).toBe(true);
    expect(checkPterodactylRequest('DELETE', '/api/client/servers/abcd1234/network/allocations/12', everything).allowed).toBe(false);
  });
});

describe('SAFE_DB_DOWNLOAD (what the SQLite viewer may open)', () => {
  it.each([
    ['/plugins/CoreProtect/database.db', true],
    ['/plugins/Plan/database.db-wal', true],
    ['/plugins/Shop/data/shops.sqlite', true],
    ['/plugins/Jobs/jobs.sqlite3', true],
    ['/world/level.dat', false],
    ['/server.properties', false],
    ['/plugins/LuckPerms/config.yml', false],
    ['/database.db', false],
    ['/plugins/A/b/c/data.db', false],
    ['/plugins/LuckPerms/luckperms-h2-v2.mv.db.bak', false],
  ])('%s -> %s', (path, expected) => {
    expect(SAFE_DB_DOWNLOAD.test(path)).toBe(expected);
  });
});
