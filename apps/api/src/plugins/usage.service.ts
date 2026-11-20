import { Injectable, Logger } from '@nestjs/common';
import type { LocalDatabaseFile } from '@ice18/shared';
import type { PteroFileObject } from '../pterodactyl/pterodactyl.types';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { ServersService } from '../servers/servers.service';
import { MAX_CONFIG_BYTES, mapLimited } from './files';
import { DATA_SUBFOLDERS, classifyLocalFile, fileKey, localDatabaseKind } from './localfiles';
import { findRecipe, readRecipeState, type RecipeState } from './recipes';

export interface UsageEntry {
  databaseName: string;
  host: string | null;
  serverIdentifier: string;
  serverName: string;
  plugin: string;
  configFile: string;
}

export interface ScanProblem {
  serverName: string;
  /** Plugin folder, or null when the whole server couldn't be scanned. */
  folder: string | null;
  error: string;
}

export interface UsageIndex {
  at: number;
  entries: UsageEntry[];
  /** SQLite/H2 files found in plugin folders. */
  files: LocalDatabaseFile[];
  failedServers: number;
  scannedServers: number;
  scannedFolders: number;
  /** What couldn't be read, so missing results aren't silent. */
  problems: ScanProblem[];
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

const SERVER_CONCURRENCY = 3;
/** Config files checked for a mention of a database file, in order. */
const CONFIG_FILES = ['config.yml', 'config.yaml', 'config.properties', 'config.json', 'settings.yml'];
const FOLDER_CONCURRENCY = 2;
/** Folders in /plugins that aren't plugins. */
const IGNORED_FOLDERS = new Set(['bstats', 'pluginmetrics', 'update', '.paper-remapped', 'spark']);

/**
 * Panel-wide index of where plugin data lives:
 * - which plugins, on which servers, point at which MySQL database (several servers often
 *   share one, e.g. LuckPerms on a network), and
 * - local database files (SQLite/H2) inside plugin folders, including "loose" ones the
 *   plugin's config never mentions.
 *
 * Built with the admin client key across every server on the panel, and cached. It only
 * lists and reads files; it never writes anything.
 */
@Injectable()
export class DatabaseUsageService {
  private readonly logger = new Logger('DatabaseUsage');
  private index?: UsageIndex;
  private building?: Promise<UsageIndex>;

  constructor(
    private readonly servers: ServersService,
    private readonly ptero: PterodactylService,
  ) {}

  /** Forget the index, e.g. after a plugin was pointed at a different database. */
  invalidate(): void {
    this.index = undefined;
  }

  /** Returns the index, rebuilding it if it's older than `maxAgeMs`. */
  async get(maxAgeMs: number): Promise<UsageIndex> {
    if (this.index && Date.now() - this.index.at <= maxAgeMs) return this.index;
    this.building ??= this.build().finally(() => {
      this.building = undefined;
    });
    return this.building;
  }

  private async build(): Promise<UsageIndex> {
    const servers = await this.servers.allServers();
    const entries: UsageEntry[] = [];
    const files: LocalDatabaseFile[] = [];
    const problems: ScanProblem[] = [];
    let failedServers = 0;
    let scannedServers = 0;
    let scannedFolders = 0;
    await mapLimited(servers, SERVER_CONCURRENCY, async (server) => {
      try {
        const result = await this.scanServer(server.identifier, server.name, problems);
        entries.push(...result.entries);
        files.push(...result.files);
        scannedFolders += result.folders;
        scannedServers += 1;
      } catch (error) {
        failedServers += 1;
        problems.push({ serverName: server.name, folder: null, error: describe(error) });
        this.logger.warn(`Couldn't scan plugins on ${server.name}: ${describe(error)}`);
      }
    });
    files.sort((a, b) => a.serverName.localeCompare(b.serverName) || a.path.localeCompare(b.path));
    if (problems.length > 0) this.logger.warn(`Plugin scan: ${problems.length} folder(s)/server(s) couldn't be read.`);
    this.index = { at: Date.now(), entries, files, failedServers, scannedServers, scannedFolders, problems };
    return this.index;
  }

  private async scanServer(identifier: string, serverName: string, problems: ScanProblem[]) {
    const root = await this.ptero.listFiles(identifier, '/');
    if (!root.some((entry) => !entry.is_file && entry.name === 'plugins')) return { entries: [], files: [], folders: 0 };
    const folders = (await this.ptero.listFiles(identifier, '/plugins'))
      .filter((entry) => !entry.is_file && !entry.name.startsWith('.') && !IGNORED_FOLDERS.has(entry.name.toLowerCase()))
      .map((entry) => entry.name);

    const results = await mapLimited(folders, FOLDER_CONCURRENCY, (folder) =>
      this.scanFolder(identifier, serverName, folder).catch((error: unknown) => {
        problems.push({ serverName, folder, error: describe(error) });
        return { entries: [], files: [] };
      }),
    );
    return {
      entries: results.flatMap((result) => result.entries),
      files: results.flatMap((result) => result.files),
      folders: folders.length,
    };
  }

  private async read(identifier: string, path: string, entry: PteroFileObject | undefined): Promise<string | null> {
    if (!entry || !entry.is_file || entry.size > MAX_CONFIG_BYTES) return null;
    try {
      return await this.ptero.readFile(identifier, path);
    } catch {
      return null;
    }
  }

  private async scanFolder(
    identifier: string,
    serverName: string,
    folder: string,
  ): Promise<{ entries: UsageEntry[]; files: LocalDatabaseFile[] }> {
    const base = `/plugins/${folder}`;
    const listing = await this.ptero.listFiles(identifier, base);

    // Database files at the top of the plugin folder and in data-like subfolders.
    const found: Array<{ dir: string; file: PteroFileObject }> = listing
      .filter((entry) => entry.is_file && localDatabaseKind(entry.name))
      .map((file) => ({ dir: base, file }));
    for (const sub of listing.filter((entry) => !entry.is_file && DATA_SUBFOLDERS.has(entry.name.toLowerCase()))) {
      try {
        const inner = await this.ptero.listFiles(identifier, `${base}/${sub.name}`);
        found.push(...inner.filter((entry) => entry.is_file && localDatabaseKind(entry.name)).map((file) => ({ dir: `${base}/${sub.name}`, file })));
      } catch {
        /* unreadable subfolder: skip */
      }
    }

    // What the plugin's config says.
    const recipe = findRecipe(folder);
    const entries: UsageEntry[] = [];
    let state: RecipeState | null = null;
    if (recipe) {
      const configFile = `${base}/${recipe.configFile}`;
      const text = await this.read(identifier, configFile, listing.find((entry) => entry.name === recipe.configFile));
      if (text !== null) {
        try {
          state = readRecipeState(recipe, text);
          if (state.storage === 'mysql' && state.database) {
            entries.push({
              databaseName: state.database,
              host: state.host,
              serverIdentifier: identifier,
              serverName,
              plugin: recipe.name.split(' (')[0]!,
              configFile,
            });
          }
        } catch {
          /* unreadable config */
        }
      }
    }
    let configText: string | null = null;
    let configName = 'config.yml';
    if (!recipe && found.length > 0) {
      const config = CONFIG_FILES.map((name) => listing.find((entry) => entry.is_file && entry.name === name)).find(Boolean);
      if (config) {
        configName = config.name;
        configText = await this.read(identifier, `${base}/${config.name}`, config);
      }
    }

    const files = found.map(({ dir, file }): LocalDatabaseFile => {
      const path = `${dir}/${file.name}`;
      const { status, note } = classifyLocalFile(
        file.name,
        folder,
        recipe ? { name: recipe.name.split(' (')[0]!, state } : null,
        configText,
        configName,
      );
      return {
        key: fileKey(path),
        serverIdentifier: identifier,
        serverName,
        plugin: folder,
        path,
        name: file.name,
        size: file.size,
        modifiedAt: file.modified_at || null,
        kind: localDatabaseKind(file.name)!,
        status,
        note,
      };
    });
    return { entries, files };
  }
}
