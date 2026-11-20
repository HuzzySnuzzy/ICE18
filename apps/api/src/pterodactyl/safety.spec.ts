import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RULES,
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
      ['POST', '/api/client/servers/1a2b3c4d/files/delete'],
      ['POST', '/api/client/servers/1a2b3c4d/backups/abc-123/restore'],
      ['DELETE', '/api/client/servers/1a2b3c4d/backups/abc-123'],
      ['DELETE', '/api/client/servers/1a2b3c4d/databases/xyz'],
      ['DELETE', '/api/client/servers/1a2b3c4d/schedules/4'],
      ['DELETE', '/api/client/servers/1a2b3c4d/users/uuid-1'],
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

  it('has no DELETE rule in the allowlist at all', () => {
    expect(ALLOWED_RULES.filter((rule) => rule.method === 'DELETE')).toEqual([]);
  });
});
