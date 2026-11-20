import { describe, expect, it } from 'vitest';
import { classifyLocalFile, fileKey, localDatabaseKind, pathFromKey } from './localfiles';

describe('localDatabaseKind', () => {
  it('recognises SQLite and H2 files', () => {
    expect(localDatabaseKind('database.db')).toBe('sqlite');
    expect(localDatabaseKind('shops.sqlite')).toBe('sqlite');
    expect(localDatabaseKind('jobs.sqlite3')).toBe('sqlite');
    expect(localDatabaseKind('luckperms-h2-v2.mv.db')).toBe('h2');
    expect(localDatabaseKind('old.h2.db')).toBe('h2');
    expect(localDatabaseKind('database.db-wal')).toBeNull();
    expect(localDatabaseKind('config.yml')).toBeNull();
  });
});

describe('fileKey', () => {
  it('round-trips paths', () => {
    const path = '/plugins/My Plugin/data/x.db';
    expect(pathFromKey(fileKey(path))).toBe(path);
    expect(fileKey(path)).not.toMatch(/[/+=]/);
  });
});

describe('classifyLocalFile', () => {
  const mysql = { storage: 'mysql' as const, summary: '', database: 's1_luckperms', host: 'h:3306' };
  const local = { storage: 'local' as const, summary: 'Local storage (h2)', database: null, host: null };

  it('marks files of plugins that switched to MySQL as leftovers', () => {
    expect(classifyLocalFile('luckperms-h2-v2.mv.db', 'LuckPerms', { name: 'LuckPerms', state: mysql }, null).status).toBe('leftover');
  });
  it('marks files of plugins using local storage as in use', () => {
    expect(classifyLocalFile('database.db', 'CoreProtect', { name: 'CoreProtect', state: local }, null)).toEqual({
      status: 'in-use',
      note: 'CoreProtect stores its data in local files (h2).',
    });
  });
  it('uses the config to tell referenced from loose files', () => {
    expect(classifyLocalFile('shops.db', 'Shop', null, 'storage:\n  file: shops.db\n').status).toBe('in-use');
    expect(classifyLocalFile('cache.db', 'Shop', null, 'storage:\n  file: shops.db\n').status).toBe('unreferenced');
    expect(classifyLocalFile('cache.db', 'Shop', null, null).status).toBe('unreferenced');
  });
});
