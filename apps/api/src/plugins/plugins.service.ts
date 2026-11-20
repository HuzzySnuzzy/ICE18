import { BadGatewayException, BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  PluginInfo,
  PluginScan,
  PluginSetupRequest,
  PluginSetupResult,
  ServerDatabase,
  ServerDatabaseCredentials,
  ServerPermission,
} from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { CONFIG, type AppConfig } from '../config/config';
import type { UserRow } from '../db/schema';
import { PterodactylError } from '../pterodactyl/pterodactyl.http';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import type { PteroServerDatabase } from '../pterodactyl/pterodactyl.types';
import { ServersService } from '../servers/servers.service';
import { ConfigError, applyRecipe, findDatabaseSettings, findRecipe, readRecipeState } from './recipes';

const CACHE_MS = 60_000;
const MAX_CONFIG_BYTES = 512 * 1024;
const SCAN_CONCURRENCY = 4;
/** Folders in /plugins that aren't plugins. */
const IGNORED_FOLDERS = new Set(['bstats', 'pluginmetrics', 'update', '.paper-remapped', 'spark']);

export const PLUGIN_FOLDER = /^[A-Za-z0-9 _+-][A-Za-z0-9 _.+-]{0,63}$/;
const DATABASE_NAME = /^[A-Za-z0-9_]{1,48}$/;

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Finds plugins that can use MySQL and points them at a server database.
 * Writes are limited (by the Pterodactyl safety rules) to plugin config files, and
 * the original file is always saved as a backup first.
 */
@Injectable()
export class PluginsService {
  private readonly cache = new Map<string, { at: number; scan: PluginScan }>();

  constructor(
    private readonly servers: ServersService,
    private readonly ptero: PterodactylService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async requirePermissions(user: UserRow, identifier: string, needed: ServerPermission[]) {
    const access = await this.servers.getForUser(user, identifier);
    const missing = needed.filter((permission) => !access.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`You need these permissions on this server: ${missing.join(', ')}.`);
    }
    return access;
  }

  /** The address plugins inside the container should use for a database host. */
  pluginHost(address: string): string {
    return ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(address.trim().toLowerCase())
      ? this.config.PLUGIN_DB_LOOPBACK_HOST
      : address;
  }

  private toDatabase(database: PteroServerDatabase): ServerDatabase {
    return {
      id: database.id,
      name: database.name,
      username: database.username,
      host: database.host.address,
      port: database.host.port,
      pluginHost: this.pluginHost(database.host.address),
      connectionsFrom: database.connections_from,
    };
  }

  private async readConfig(identifier: string, file: string): Promise<string | null> {
    try {
      const text = await this.ptero.readFile(identifier, file);
      return text.length > MAX_CONFIG_BYTES ? null : text;
    } catch (error) {
      if (error instanceof PterodactylError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
  }

  /**
   * For scans: lists the plugin folder first and only reads the file if it's there (some
   * Wings versions answer a missing file with a 500), and never throws: one unreadable
   * plugin shouldn't break the whole scan.
   */
  private async tryReadConfig(
    identifier: string,
    folder: string,
    fileName: string,
  ): Promise<{ text: string } | { missing: true } | { error: string }> {
    try {
      const files = await this.ptero.listFiles(identifier, `/plugins/${folder}`);
      const entry = files.find((file) => file.is_file && file.name === fileName);
      if (!entry) return { missing: true };
      if (entry.size > MAX_CONFIG_BYTES) return { error: `${fileName} is too large to scan.` };
      return { text: await this.ptero.readFile(identifier, `/plugins/${folder}/${fileName}`) };
    } catch (error) {
      if (error instanceof PterodactylError) {
        if (error.status === 404) return { missing: true };
        return { error: `Couldn't read ${fileName} (Pterodactyl/Wings error ${error.status}). Try Rescan.` };
      }
      throw error;
    }
  }

  async scan(user: UserRow, identifier: string, refresh = false): Promise<PluginScan> {
    const access = await this.requirePermissions(user, identifier, ['file.read']);
    const cached = this.cache.get(identifier);
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.scan;

    let root;
    try {
      root = await this.ptero.listFiles(identifier, '/');
    } catch (error) {
      if (error instanceof PterodactylError) {
        throw new BadGatewayException(
          `Couldn't list this server's files: ${error.message.replace(/^Pterodactyl responded \d+: /, '')} ` +
            "This comes from the server's node (Wings): check the node is online in Pterodactyl (Admin → Nodes) and look at the Wings log on that node.",
        );
      }
      throw error;
    }
    const hasPluginsFolder = root.some((entry) => !entry.is_file && entry.name === 'plugins');
    let databases: ServerDatabase[] = [];
    if (access.permissions.includes('database.read')) {
      try {
        databases = (await this.ptero.listDatabases(identifier)).map((database) => this.toDatabase(database));
      } catch (error) {
        // No database host configured, or the panel can't reach it: still show plugins.
        if (!(error instanceof PterodactylError)) throw error;
      }
    }

    let plugins: PluginInfo[] = [];
    if (hasPluginsFolder) {
      const entries = await this.ptero.listFiles(identifier, '/plugins');
      const folders = entries
        .filter((entry) => !entry.is_file && !entry.name.startsWith('.') && PLUGIN_FOLDER.test(entry.name))
        .map((entry) => entry.name)
        .filter((name) => !IGNORED_FOLDERS.has(name.toLowerCase()));
      const jars = entries.filter((entry) => entry.is_file && entry.name.toLowerCase().endsWith('.jar')).map((entry) => entry.name);

      const jarFor = (folder: string) => jars.find((jar) => normalize(jar).startsWith(normalize(folder)));
      plugins = await mapLimited(folders, SCAN_CONCURRENCY, (folder) => this.inspectFolder(identifier, folder, jarFor(folder) ?? null));

      // Jars whose plugin hasn't created a folder yet (never started).
      const claimed = new Set(plugins.map((plugin) => plugin.jar).filter(Boolean));
      for (const jar of jars.filter((name) => !claimed.has(name))) {
        const recipe = findRecipe(jar);
        plugins.push({
          name: recipe?.name.split(' (')[0] ?? jar.replace(/\.jar$/i, ''),
          folder: null,
          jar,
          support: recipe ? 'supported' : 'none',
          recipeId: recipe?.id,
          storage: recipe ? 'not-generated' : undefined,
          summary: recipe ? 'Start the server once so the plugin creates its config.' : 'Not started yet.',
        });
      }

      for (const plugin of plugins) {
        if (plugin.database === undefined) continue;
        plugin.database = databases.find((database) => database.name === plugin.database)?.name ?? null;
      }
      const order = { supported: 0, possible: 1, none: 2 };
      plugins.sort((a, b) => order[a.support] - order[b.support] || a.name.localeCompare(b.name));
    }

    const scan: PluginScan = { hasPluginsFolder, plugins, databases, scannedAt: new Date().toISOString() };
    this.cache.set(identifier, { at: Date.now(), scan });
    return scan;
  }

  private async inspectFolder(identifier: string, folder: string, jar: string | null): Promise<PluginInfo> {
    const recipe = findRecipe(folder) ?? (jar ? findRecipe(jar) : undefined);
    if (recipe) {
      const configFile = `/plugins/${folder}/${recipe.configFile}`;
      const read = await this.tryReadConfig(identifier, folder, recipe.configFile);
      const base = { name: folder, folder, jar, support: 'supported' as const, recipeId: recipe.id, configFile };
      if ('missing' in read) {
        return { ...base, storage: 'not-generated', summary: 'Start the server once so the plugin creates its config.' };
      }
      if ('error' in read) return { ...base, summary: read.error };
      try {
        const state = readRecipeState(recipe, read.text);
        return { ...base, storage: state.storage, summary: state.summary, database: state.database };
      } catch (error) {
        return { ...base, summary: (error as Error).message };
      }
    }

    const configFile = `/plugins/${folder}/config.yml`;
    const read = await this.tryReadConfig(identifier, folder, 'config.yml');
    if ('error' in read) return { name: folder, folder, jar, support: 'none', summary: read.error };
    const settingsPath = 'text' in read ? findDatabaseSettings(read.text) : null;
    if (settingsPath !== null) {
      return {
        name: folder,
        folder,
        jar,
        support: 'possible',
        configFile,
        settingsPath,
        summary: `Has database settings${settingsPath ? ` under "${settingsPath}"` : ''} in config.yml.`,
      };
    }
    return { name: folder, folder, jar, support: 'none', summary: 'No database settings found.' };
  }

  async createDatabase(user: UserRow, identifier: string, name: string): Promise<ServerDatabaseCredentials> {
    await this.requirePermissions(user, identifier, ['database.create', 'database.view_password']);
    const created = await this.createPteroDatabase(identifier, name);
    await this.audit.record(user.id, 'server.database.create', identifier, created.name);
    this.cache.delete(identifier);
    return created;
  }

  private async createPteroDatabase(identifier: string, name: string): Promise<ServerDatabaseCredentials> {
    if (!DATABASE_NAME.test(name)) {
      throw new BadRequestException('Database names can only use letters, numbers and _ (up to 48 characters).');
    }
    let created: PteroServerDatabase;
    try {
      created = await this.ptero.createDatabase(identifier, name);
    } catch (error) {
      if (error instanceof PterodactylError && error.status >= 400 && error.status < 500) {
        throw new BadRequestException(
          `Pterodactyl couldn't create the database: ${error.message.replace(/^Pterodactyl responded \d+: /, '')} ` +
            "(If this server's database limit is reached, an admin can raise it, or pick an existing database.)",
        );
      }
      throw error;
    }
    return this.withPassword(identifier, created);
  }

  private async withPassword(identifier: string, database: PteroServerDatabase): Promise<ServerDatabaseCredentials> {
    let password = database.relationships?.password?.attributes.password;
    if (password === undefined) {
      const all = await this.ptero.listDatabases(identifier, true);
      password = all.find((entry) => entry.id === database.id)?.relationships?.password?.attributes.password;
    }
    if (password === undefined) throw new BadRequestException('Pterodactyl did not return the database password.');
    return { ...this.toDatabase(database), password };
  }

  async credentials(user: UserRow, identifier: string, databaseId: string): Promise<ServerDatabaseCredentials> {
    await this.requirePermissions(user, identifier, ['database.read', 'database.view_password']);
    const database = (await this.ptero.listDatabases(identifier, true)).find((entry) => entry.id === databaseId);
    if (!database) throw new BadRequestException('No such database on this server.');
    await this.audit.record(user.id, 'server.database.view_password', identifier, database.name);
    return this.withPassword(identifier, database);
  }

  async setup(user: UserRow, identifier: string, folder: string, request: PluginSetupRequest): Promise<PluginSetupResult> {
    const needed: ServerPermission[] = ['file.read', 'file.update', 'database.read', 'database.view_password'];
    if (request.newDatabaseName) needed.push('database.create');
    await this.requirePermissions(user, identifier, needed);

    if (!PLUGIN_FOLDER.test(folder)) throw new BadRequestException('Invalid plugin folder.');
    const recipe = findRecipe(folder);
    if (!recipe) throw new BadRequestException(`ICE18 can't set up ${folder} automatically. Use the database details to set it up by hand.`);

    const configFile = `/plugins/${folder}/${recipe.configFile}`;
    const original = await this.readConfig(identifier, configFile);
    if (original === null) {
      throw new BadRequestException(`${configFile} doesn't exist yet. Start the server once so ${recipe.name} creates it.`);
    }

    // Check the config can be updated before creating anything.
    const placeholder = { host: 'h', port: 3306, database: 'd', username: 'u', password: 'p' };
    try {
      applyRecipe(recipe, original, placeholder);
    } catch (error) {
      if (error instanceof ConfigError) throw new BadRequestException(error.message);
      throw error;
    }

    let database: ServerDatabaseCredentials;
    if (request.databaseId) {
      database = await this.credentials(user, identifier, request.databaseId);
    } else if (request.newDatabaseName) {
      database = await this.createPteroDatabase(identifier, request.newDatabaseName);
      await this.audit.record(user.id, 'server.database.create', identifier, database.name);
    } else {
      throw new BadRequestException('Choose a database or a name for a new one.');
    }

    const host = request.host?.trim() || database.pluginHost;
    if (!/^[A-Za-z0-9.:_-]{1,253}$/.test(host)) throw new BadRequestException('That host address is not valid.');

    let updated;
    try {
      updated = applyRecipe(recipe, original, {
        host,
        port: database.port,
        database: database.name,
        username: database.username,
        password: database.password,
      });
    } catch (error) {
      if (error instanceof ConfigError) throw new BadRequestException(error.message);
      throw error;
    }

    // Backup first, then the change. Never overwrite an earlier backup.
    const existing = new Set((await this.ptero.listFiles(identifier, `/plugins/${folder}`)).map((entry) => entry.name));
    const fileName = recipe.configFile;
    let when = Date.now();
    while (existing.has(`${fileName}.ice18-backup-${timestamp(new Date(when))}`)) when += 1000;
    const backupFile = `${configFile}.ice18-backup-${timestamp(new Date(when))}`;
    await this.ptero.writeFile(identifier, backupFile, original);
    await this.ptero.writeFile(identifier, configFile, updated.text);

    // Read it back to make sure the change landed.
    const written = await this.readConfig(identifier, configFile);
    const state = written === null ? null : readRecipeState(recipe, written);
    if (!state || state.storage !== 'mysql' || state.database !== database.name) {
      throw new BadRequestException(
        `The config didn't save as expected. Your original is in ${backupFile}; check ${configFile}.`,
      );
    }

    await this.audit.record(user.id, 'server.plugin.database_setup', identifier, `${recipe.name} -> ${database.name}`);
    this.cache.delete(identifier);
    const { password: _password, ...publicDatabase } = database;
    return { plugin: recipe.name, configFile, backupFile, database: publicDatabase, changed: updated.changed };
  }
}
