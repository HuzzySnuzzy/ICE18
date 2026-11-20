import { describe, expect, it } from 'vitest';
import { isPlainName, knownPermissions, ungrantable } from './grants';

describe('ungrantable', () => {
  it('lets owners and admins grant anything', () => {
    expect(ungrantable(['file.delete', 'user.create'], '*')).toEqual([]);
  });
  it("stops subusers handing out permissions they don't have", () => {
    expect(ungrantable(['control.console', 'file.delete'], ['control.console', 'user.create'])).toEqual(['file.delete']);
  });
});

describe('knownPermissions', () => {
  const catalogue = { control: { keys: { console: '', start: '' } }, file: { keys: { read: '' } } };
  it('splits known from unknown and drops duplicates', () => {
    expect(knownPermissions(['control.start', 'control.start', 'file.read', 'admin.everything'], catalogue)).toEqual({
      known: ['control.start', 'file.read'],
      unknown: ['admin.everything'],
    });
  });
});

describe('isPlainName', () => {
  it('accepts single names only', () => {
    expect(isPlainName('LuckPerms.jar')).toBe(true);
    expect(isPlainName('my world')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x\u0000', 5]) expect(isPlainName(bad), String(bad)).toBe(false);
  });
});
