import { Injectable, Logger } from '@nestjs/common';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { ServersService } from '../servers/servers.service';
import { mapLimited, readPluginConfig } from './files';
import { findRecipe, readRecipeState } from './recipes';

export interface UsageEntry {
  databaseName: string;
  host: string | null;
  serverIdentifier: string;
  serverName: string;
  plugin: string;
  configFile: string;
}

export interface UsageIndex {
  at: number;
  entries: UsageEntry[];
  failedServers: number;
}

const SCAN_CONCURRENCY = 3;

/**
 * Panel-wide index of which plugins, on which servers, point at which MySQL database.
 * Several servers often share one database (e.g. LuckPerms on a network), so the
 * Databases page uses this to show where a database is used and to lock it while any
 * of those servers is online.
 *
 * Built from the configs of plugins ICE18 has recipes for, across every server on the
 * panel (with the admin client key), and cached. Read-only: it never writes anything.
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
    let failedServers = 0;
    await mapLimited(servers, SCAN_CONCURRENCY, async (server) => {
      try {
        entries.push(...(await this.scanServer(server.identifier, server.name)));
      } catch (error) {
        failedServers += 1;
        this.logger.warn(`Couldn't scan plugins on ${server.name}: ${(error as Error).message}`);
      }
    });
    this.index = { at: Date.now(), entries, failedServers };
    return this.index;
  }

  private async scanServer(identifier: string, name: string): Promise<UsageEntry[]> {
    const root = await this.ptero.listFiles(identifier, '/');
    if (!root.some((entry) => !entry.is_file && entry.name === 'plugins')) return [];
    const folders = (await this.ptero.listFiles(identifier, '/plugins'))
      .filter((entry) => !entry.is_file && findRecipe(entry.name))
      .map((entry) => entry.name);

    const found: UsageEntry[] = [];
    for (const folder of folders) {
      const recipe = findRecipe(folder)!;
      const read = await readPluginConfig(this.ptero, identifier, folder, recipe.configFile);
      if (!('text' in read)) continue;
      try {
        const state = readRecipeState(recipe, read.text);
        if (state.storage === 'mysql' && state.database) {
          found.push({
            databaseName: state.database,
            host: state.host,
            serverIdentifier: identifier,
            serverName: name,
            plugin: recipe.name.split(' (')[0]!,
            configFile: `/plugins/${folder}/${recipe.configFile}`,
          });
        }
      } catch {
        /* unreadable config: skip */
      }
    }
    return found;
  }
}
