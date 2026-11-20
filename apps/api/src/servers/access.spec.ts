import { describe, expect, it } from 'vitest';
import { SERVER_PERMISSIONS } from '@ice18/shared';
import { computePermissions, permissionForSignal } from './access';

const server = {
  ownerId: 10,
  subusers: [{ userId: 20, permissions: ['websocket.connect', 'control.console', 'file.read'] }],
};

describe('computePermissions', () => {
  it('gives admins everything', () => {
    expect(computePermissions({ isAdmin: true, pteroUserId: null }, server)).toEqual([...SERVER_PERMISSIONS]);
  });

  it('gives the owner everything', () => {
    expect(computePermissions({ isAdmin: false, pteroUserId: 10 }, server)).toEqual([...SERVER_PERMISSIONS]);
  });

  it('gives subusers only what Pterodactyl granted them', () => {
    expect(computePermissions({ isAdmin: false, pteroUserId: 20 }, server)).toEqual([
      'websocket.connect',
      'control.console',
      'file.read',
    ]);
  });

  it('hides the server from everyone else', () => {
    expect(computePermissions({ isAdmin: false, pteroUserId: 30 }, server)).toBeNull();
    expect(computePermissions({ isAdmin: false, pteroUserId: null }, server)).toBeNull();
  });
});

describe('permissionForSignal', () => {
  it('maps kill to control.stop like Pterodactyl does', () => {
    expect(permissionForSignal('kill')).toBe('control.stop');
    expect(permissionForSignal('start')).toBe('control.start');
    expect(permissionForSignal('restart')).toBe('control.restart');
  });
});
