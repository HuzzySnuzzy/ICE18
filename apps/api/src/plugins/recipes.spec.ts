import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  COREPROTECT_CONFIG,
  ESSENTIALS_CONFIG,
  LUCKPERMS_CONFIG,
  PLAN_CONFIG,
  UNKNOWN_SQL_PLUGIN_CONFIG,
} from './fixtures';
import { ConfigError, RECIPES, applyRecipe, detectIndent, findDatabaseSettings, findRecipe, readRecipeState } from './recipes';

const target = {
  host: '172.18.0.1',
  port: 3306,
  database: 's12_luckperms',
  username: 'u12_AbCdEf',
  password: 'p@ss:w/rd#!%? x',
};

const recipe = (id: string) => RECIPES.find((entry) => entry.id === id)!;

/** Lines that differ between two texts. */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  return b.filter((line, index) => line !== a[index]);
}

describe('findRecipe', () => {
  it('matches plugin folders and jars', () => {
    expect(findRecipe('LuckPerms')?.id).toBe('luckperms');
    expect(findRecipe('LuckPerms-Bukkit-5.4.141.jar')?.id).toBe('luckperms');
    expect(findRecipe('QuickShop-Hikari')?.id).toBe('quickshop');
    expect(findRecipe('Plan-5.6-build-2965.jar')?.id).toBe('plan');
    expect(findRecipe('PlaceholderAPI-2.11.6.jar')).toBeUndefined();
    expect(findRecipe('Essentials')).toBeUndefined();
  });
});

describe('LuckPerms', () => {
  it('reads local storage', () => {
    expect(readRecipeState(recipe('luckperms'), LUCKPERMS_CONFIG)).toEqual({
      storage: 'local',
      summary: 'Local storage (h2)',
      database: null,
      host: null,
    });
  });

  it('switches to MySQL, changing only those lines and keeping every comment', () => {
    const { text, changed } = applyRecipe(recipe('luckperms'), LUCKPERMS_CONFIG, target);
    const doc = parseDocument(text);
    expect(doc.getIn(['storage-method'])).toBe('mysql');
    expect(doc.getIn(['data', 'address'])).toBe('172.18.0.1:3306');
    expect(doc.getIn(['data', 'database'])).toBe('s12_luckperms');
    expect(doc.getIn(['data', 'username'])).toBe('u12_AbCdEf');
    expect(doc.getIn(['data', 'password'])).toBe(target.password);
    expect(doc.getIn(['data', 'table-prefix'])).toBe('luckperms_');
    expect(changed).toHaveLength(5);

    expect(changedLines(LUCKPERMS_CONFIG, text)).toHaveLength(5);
    const comments = (value: string) => value.split('\n').filter((line) => line.trim().startsWith('#'));
    expect(comments(text)).toEqual(comments(LUCKPERMS_CONFIG));

    expect(readRecipeState(recipe('luckperms'), text)).toEqual({
      storage: 'mysql',
      summary: 'MySQL: s12_luckperms on 172.18.0.1:3306',
      database: 's12_luckperms',
      host: '172.18.0.1:3306',
    });
  });
});

describe('CoreProtect', () => {
  it('switches to MySQL with separate host and port, even when the password is empty', () => {
    const { text } = applyRecipe(recipe('coreprotect'), COREPROTECT_CONFIG, target);
    const doc = parseDocument(text);
    expect(doc.getIn(['use-mysql'])).toBe(true);
    expect(doc.getIn(['mysql-host'])).toBe('172.18.0.1');
    expect(doc.getIn(['mysql-port'])).toBe(3306);
    expect(doc.getIn(['mysql-password'])).toBe(target.password);
    expect(doc.getIn(['block-place'])).toBe(true);
    // The port was already 3306, so 5 of the 6 settings change.
    expect(changedLines(COREPROTECT_CONFIG, text)).toHaveLength(5);
  });
});

describe('Plan', () => {
  it('keeps 4-space indentation and the quoted port', () => {
    expect(detectIndent(PLAN_CONFIG)).toBe(4);
    const { text } = applyRecipe(recipe('plan'), PLAN_CONFIG, target);
    const doc = parseDocument(text);
    expect(doc.getIn(['Database', 'Type'])).toBe('MySQL');
    expect(doc.getIn(['Database', 'MySQL', 'Port'])).toBe('3306');
    expect(text).toContain('\n    MySQL:\n        Host: 172.18.0.1\n');
    expect(changedLines(PLAN_CONFIG, text)).toHaveLength(5);
  });
});

describe('safety', () => {
  it('refuses to touch a config that lacks the expected settings', () => {
    expect(() => applyRecipe(recipe('luckperms'), ESSENTIALS_CONFIG, target)).toThrow(ConfigError);
    expect(() => applyRecipe(recipe('luckperms'), ESSENTIALS_CONFIG, target)).toThrow(/storage-method/);
  });

  it('refuses invalid YAML', () => {
    expect(() => applyRecipe(recipe('luckperms'), 'storage-method: [unclosed\n', target)).toThrow(ConfigError);
  });

  it('safely writes passwords that would break YAML if written naively', () => {
    for (const password of ['#notacomment', "it's", 'a: b', '- dash', '@start', '"quoted"', 'yes', '123', 'null', '']) {
      const { text } = applyRecipe(recipe('luckperms'), LUCKPERMS_CONFIG, { ...target, password });
      expect(parseDocument(text).getIn(['data', 'password']), password).toBe(password);
    }
  });
});

describe('findDatabaseSettings', () => {
  it('spots database settings in plugins ICE18 does not know', () => {
    expect(findDatabaseSettings(UNKNOWN_SQL_PLUGIN_CONFIG)).toBe('storage.mysql');
    expect(findDatabaseSettings(COREPROTECT_CONFIG)).toBe('');
    expect(findDatabaseSettings(PLAN_CONFIG)).toBe('Database.MySQL');
  });

  it('ignores plugins without them', () => {
    expect(findDatabaseSettings(ESSENTIALS_CONFIG)).toBeNull();
    expect(findDatabaseSettings('not: [valid')).toBeNull();
  });
});
