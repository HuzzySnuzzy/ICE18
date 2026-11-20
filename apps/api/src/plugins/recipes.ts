import { isScalar, parseDocument, type Document } from 'yaml';

/**
 * Plugin "recipes": where well-known Minecraft plugins keep their database settings.
 *
 * Applying a recipe only changes settings that ALREADY exist in the plugin's config.
 * If a key is missing (a different plugin version, or a wrong guess here), nothing is
 * written and the user is told to set it up by hand. That keeps a bad recipe harmless.
 */

export type ConfigPath = readonly string[];

export interface PluginRecipe {
  id: string;
  name: string;
  /** Plugin folder names, lowercase. */
  folders: readonly string[];
  /** Matches the plugin's jar file name. */
  jar: RegExp;
  /** Config file inside the plugin folder. */
  configFile: string;
  /** The setting that switches the plugin to MySQL, and the value that means MySQL. */
  storage: { path: ConfigPath; mysqlValue: string | boolean };
  fields: {
    /** One "host:port" setting... */
    address?: ConfigPath;
    /** ...or separate host and port settings. */
    host?: ConfigPath;
    port?: ConfigPath;
    database: ConfigPath;
    username: ConfigPath;
    password: ConfigPath;
  };
}

export const RECIPES: readonly PluginRecipe[] = [
  {
    id: 'luckperms',
    name: 'LuckPerms',
    folders: ['luckperms'],
    jar: /^luckperms/i,
    configFile: 'config.yml',
    storage: { path: ['storage-method'], mysqlValue: 'mysql' },
    fields: {
      address: ['data', 'address'],
      database: ['data', 'database'],
      username: ['data', 'username'],
      password: ['data', 'password'],
    },
  },
  {
    id: 'coreprotect',
    name: 'CoreProtect',
    folders: ['coreprotect'],
    jar: /^coreprotect/i,
    configFile: 'config.yml',
    storage: { path: ['use-mysql'], mysqlValue: true },
    fields: {
      host: ['mysql-host'],
      port: ['mysql-port'],
      database: ['mysql-database'],
      username: ['mysql-username'],
      password: ['mysql-password'],
    },
  },
  {
    id: 'litebans',
    name: 'LiteBans',
    folders: ['litebans'],
    jar: /^litebans/i,
    configFile: 'config.yml',
    storage: { path: ['sql', 'driver'], mysqlValue: 'MySQL' },
    fields: {
      address: ['sql', 'address'],
      database: ['sql', 'database'],
      username: ['sql', 'username'],
      password: ['sql', 'password'],
    },
  },
  {
    id: 'plan',
    name: 'Plan (Player Analytics)',
    folders: ['plan'],
    jar: /^plan[-_. ]/i,
    configFile: 'config.yml',
    storage: { path: ['Database', 'Type'], mysqlValue: 'MySQL' },
    fields: {
      host: ['Database', 'MySQL', 'Host'],
      port: ['Database', 'MySQL', 'Port'],
      database: ['Database', 'MySQL', 'Database'],
      username: ['Database', 'MySQL', 'User'],
      password: ['Database', 'MySQL', 'Password'],
    },
  },
  {
    id: 'mcmmo',
    name: 'mcMMO',
    folders: ['mcmmo'],
    jar: /^mcmmo/i,
    configFile: 'config.yml',
    storage: { path: ['MySQL', 'Enabled'], mysqlValue: true },
    fields: {
      host: ['MySQL', 'Server', 'Address'],
      port: ['MySQL', 'Server', 'Port'],
      database: ['MySQL', 'Database', 'Name'],
      username: ['MySQL', 'Database', 'User_Name'],
      password: ['MySQL', 'Database', 'User_Password'],
    },
  },
  {
    id: 'quickshop',
    name: 'QuickShop',
    folders: ['quickshop-hikari', 'quickshop'],
    jar: /^quickshop/i,
    configFile: 'config.yml',
    storage: { path: ['database', 'mysql'], mysqlValue: true },
    fields: {
      host: ['database', 'host'],
      port: ['database', 'port'],
      database: ['database', 'database'],
      username: ['database', 'user'],
      password: ['database', 'password'],
    },
  },
];

export function findRecipe(folderOrJar: string): PluginRecipe | undefined {
  const lower = folderOrJar.toLowerCase();
  return (
    RECIPES.find((recipe) => recipe.folders.includes(lower)) ??
    (lower.endsWith('.jar') ? RECIPES.find((recipe) => recipe.jar.test(folderOrJar)) : undefined)
  );
}

export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export class ConfigError extends Error {}

function parse(text: string): Document {
  const doc = parseDocument(text, { keepSourceTokens: false });
  if (doc.errors.length > 0) {
    throw new ConfigError(`The config file isn't valid YAML: ${doc.errors[0]!.message.split('\n')[0]}`);
  }
  return doc;
}

const dotted = (path: ConfigPath) => path.join('.');

function isMysqlValue(value: unknown, mysqlValue: string | boolean): boolean {
  if (typeof mysqlValue === 'boolean') return value === true || String(value).toLowerCase() === 'true';
  return ['mysql', 'mariadb'].includes(String(value).toLowerCase());
}

export interface RecipeState {
  storage: 'mysql' | 'local';
  summary: string;
  database: string | null;
  /** "host:port" the plugin connects to, when using MySQL. */
  host: string | null;
}

/** Reads what a supported plugin is currently configured to use. */
export function readRecipeState(recipe: PluginRecipe, text: string): RecipeState {
  const doc = parse(text);
  const storageValue = doc.getIn(recipe.storage.path);
  const database = doc.getIn(recipe.fields.database);
  if (isMysqlValue(storageValue, recipe.storage.mysqlValue)) {
    const host = recipe.fields.address
      ? String(doc.getIn(recipe.fields.address) ?? '?')
      : `${String(doc.getIn(recipe.fields.host!) ?? '?')}:${String(doc.getIn(recipe.fields.port!) ?? '?')}`;
    return {
      storage: 'mysql',
      summary: `MySQL: ${String(database ?? '?')} on ${host}`,
      database: database === undefined || database === null ? null : String(database),
      host,
    };
  }
  const label = typeof storageValue === 'boolean' || storageValue === undefined ? 'files' : String(storageValue);
  return { storage: 'local', summary: `Local storage (${label})`, database: null, host: null };
}

/** The indent step the file uses, so a 4-space file stays 4-space. */
export function detectIndent(text: string): number {
  let smallest = Infinity;
  for (const line of text.split('\n')) {
    const match = /^( +)[^ #\n-]/.exec(line);
    if (match) smallest = Math.min(smallest, match[1]!.length);
  }
  return Number.isFinite(smallest) && smallest >= 2 && smallest <= 8 ? smallest : 2;
}

function setExisting(doc: Document, path: ConfigPath, value: string | number | boolean): void {
  const node = doc.getIn(path, true);
  if (!isScalar(node)) throw new ConfigError(`Expected a single value at ${dotted(path)}.`);
  const current = node.value;
  // Keep the type the plugin uses (e.g. port: 3306 vs port: "3306").
  if (typeof value === 'number' && typeof current === 'string') node.value = String(value);
  else if (typeof value === 'boolean' && typeof current === 'string') node.value = String(value);
  else node.value = value;
}

export interface ApplyResult {
  text: string;
  changed: string[];
}

/**
 * Points a supported plugin's config at a MySQL database. Throws ConfigError (and
 * changes nothing) when the config doesn't have the expected settings.
 */
export function applyRecipe(recipe: PluginRecipe, text: string, target: DatabaseTarget): ApplyResult {
  const doc = parse(text);

  const values: Array<[ConfigPath, string | number | boolean]> = [[recipe.storage.path, recipe.storage.mysqlValue]];
  if (recipe.fields.address) values.push([recipe.fields.address, `${target.host}:${target.port}`]);
  if (recipe.fields.host) values.push([recipe.fields.host, target.host]);
  if (recipe.fields.port) values.push([recipe.fields.port, target.port]);
  values.push([recipe.fields.database, target.database]);
  values.push([recipe.fields.username, target.username]);
  values.push([recipe.fields.password, target.password]);

  const missing = values.filter(([path]) => !isScalar(doc.getIn(path, true))).map(([path]) => dotted(path));
  if (missing.length > 0) {
    throw new ConfigError(
      `This ${recipe.name} config doesn't have the expected settings (${missing.join(', ')}). It may be a different version. Set it up by hand with the database details instead.`,
    );
  }

  for (const [path, value] of values) setExisting(doc, path, value);
  const output = doc.toString({ indent: detectIndent(text), lineWidth: 0, minContentWidth: 0 });

  // Double-check the result reads back exactly as intended before anything is written.
  const check = parse(output);
  for (const [path, value] of values) {
    if (String(check.getIn(path)) !== String(value)) {
      throw new ConfigError(`Could not safely update ${dotted(path)}; nothing was changed.`);
    }
  }
  return { text: output, changed: values.map(([path]) => dotted(path)) };
}

const HOST_KEYS = new Set(['host', 'hostname', 'address', 'ip', 'server']);
const USER_KEYS = new Set(['user', 'username', 'login']);
const PASSWORD_KEYS = new Set(['password', 'pass', 'pw']);

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/^(mysql|sql|db|database|storage|data)[-_.]?/, '')
    .replace(/[-_]/g, '')
    .replace(/^user(name)?password$/, 'password');
}

/**
 * For plugins ICE18 doesn't know: looks for a group of settings with a host, a user
 * and a password, e.g. `database: { host, user, password }` or flat `mysql-host` keys.
 * Returns where they are ("" for the top level), or null.
 */
export function findDatabaseSettings(text: string): string | null {
  let root: unknown;
  try {
    root = parse(text).toJS();
  } catch {
    return null;
  }

  const search = (node: unknown, path: string[], depth: number): string | null => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 6) return null;
    const keys = Object.keys(node).map(normalizeKey);
    const has = (set: Set<string>) => keys.some((key) => set.has(key) || set.has(key.replace(/name$/, '')));
    if (has(HOST_KEYS) && has(USER_KEYS) && has(PASSWORD_KEYS)) return path.join('.');
    for (const [key, value] of Object.entries(node)) {
      const found = search(value, [...path, key], depth + 1);
      if (found !== null) return found;
    }
    return null;
  };
  return search(root, [], 0);
}
