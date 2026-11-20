import { Injectable } from '@nestjs/common';
import type {
  DatabaseLockServer,
  DatabaseLockStatus,
  DatabaseUsage,
  DatabaseUsageIndex,
  LocalDatabaseFile,
  PanelDatabase,
  ServerSummary,
} from '@ice18/shared';
import type { UserRow } from '../db/schema';
import { mapLimited } from '../plugins/files';
import { PluginsService } from '../plugins/plugins.service';
import { DatabaseUsageService } from '../plugins/usage.service';
import type { PteroServerDatabase } from '../pterodactyl/pterodactyl.types';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { ServersService } from '../servers/servers.service';
import { isLocked } from './lock';

const DATABASES_CACHE_MS = 60_000;
const STATE_CACHE_MS = 5_000;
/** How old the usage index may be when showing the Databases page. */
export const USAGE_MAX_AGE_VIEW_MS = 10 * 60_000;
/** How old it may be when deciding whether a write is allowed. */
export const USAGE_MAX_AGE_WRITE_MS = 2 * 60_000;

const HIDDEN_SERVER = "A server you don't have access to";


/**
 * The Databases page: every database the viewer can see across all servers, which
 * plugins use each one, and whether it's locked.
 */
@Injectable()
export class DatabasesService {
  private readonly databaseCache = new Map<string, { at: number; list: PteroServerDatabase[] }>();
  private readonly stateCache = new Map<string, { at: number; state: string }>();

  constructor(
    private readonly servers: ServersService,
    private readonly ptero: PterodactylService,
    private readonly plugins: PluginsService,
    private readonly usage: DatabaseUsageService,
  ) {}

  private async serverDatabases(identifier: string): Promise<PteroServerDatabase[]> {
    const cached = this.databaseCache.get(identifier);
    if (cached && Date.now() - cached.at < DATABASES_CACHE_MS) return cached.list;
    const list = await this.ptero.listDatabases(identifier);
    this.databaseCache.set(identifier, { at: Date.now(), list });
    return list;
  }

  async list(user: UserRow): Promise<PanelDatabase[]> {
    const servers = (await this.servers.listForUser(user)).filter((server) => server.permissions.includes('database.read'));
    const perServer = await mapLimited(servers, 4, async (server) => {
      let databases: PteroServerDatabase[];
      try {
        databases = await this.serverDatabases(server.identifier);
      } catch {
        return []; // No database host, or the panel couldn't answer: skip this server.
      }
      const canBrowse = server.permissions.includes('database.view_password');
      return databases.map(
        (database): PanelDatabase => ({
          id: database.id,
          name: database.name,
          username: database.username,
          host: database.host.address,
          port: database.host.port,
          pluginHost: this.plugins.pluginHost(database.host.address),
          connectionsFrom: database.connections_from,
          serverIdentifier: server.identifier,
          serverName: server.name,
          canBrowse,
        }),
      );
    });
    return perServer
      .flat()
      .sort((a, b) => `${a.pluginHost}:${a.port}`.localeCompare(`${b.pluginHost}:${b.port}`) || a.name.localeCompare(b.name));
  }

  async usageIndex(user: UserRow, refresh = false): Promise<DatabaseUsageIndex> {
    if (refresh) this.usage.invalidate();
    const [index, visibleServers, databases] = await Promise.all([
      this.usage.get(USAGE_MAX_AGE_VIEW_MS),
      this.servers.listForUser(user),
      this.list(user),
    ]);
    const visible = new Set(visibleServers.map((server) => server.identifier));
    const known = new Set(databases.map((database) => database.name));

    // Non-admins only learn about usage of databases they can already see.
    const usages: DatabaseUsage[] = index.entries
      .filter((entry) => user.isAdmin || known.has(entry.databaseName))
      .map((entry) =>
        visible.has(entry.serverIdentifier)
          ? { ...entry }
          : { ...entry, serverIdentifier: null, serverName: HIDDEN_SERVER, configFile: null },
      );

    const unmanaged = new Map<string, { databaseName: string; host: string | null }>();
    if (user.isAdmin) {
      for (const entry of index.entries) {
        if (!known.has(entry.databaseName)) unmanaged.set(`${entry.databaseName}@${entry.host}`, { databaseName: entry.databaseName, host: entry.host });
      }
    }

    return {
      usages,
      unmanaged: [...unmanaged.values()].sort((a, b) => a.databaseName.localeCompare(b.databaseName)),
      scannedAt: new Date(index.at).toISOString(),
      failedServers: user.isAdmin ? index.failedServers : 0,
      scannedServers: index.scannedServers,
      scannedFolders: index.scannedFolders,
      problems: user.isAdmin ? index.problems.slice(0, 50) : [],
    };
  }

  /** SQLite/H2 files in plugin folders on servers where the viewer can see files. */
  async localFiles(user: UserRow, refresh = false): Promise<LocalDatabaseFile[]> {
    if (refresh) this.usage.invalidate();
    const [index, visibleServers] = await Promise.all([this.usage.get(USAGE_MAX_AGE_VIEW_MS), this.servers.listForUser(user)]);
    const readable = new Set(
      visibleServers.filter((server) => server.permissions.includes('file.read')).map((server) => server.identifier),
    );
    return index.files.filter((file) => readable.has(file.serverIdentifier));
  }

  private async serverState(identifier: string): Promise<string> {
    const cached = this.stateCache.get(identifier);
    if (cached && Date.now() - cached.at < STATE_CACHE_MS) return cached.state;
    let state: string;
    try {
      const resources = await this.ptero.getResources(identifier);
      state = resources.is_suspended ? 'suspended' : resources.current_state;
    } catch {
      state = 'unknown'; // Unknown counts as online: locked.
    }
    this.stateCache.set(identifier, { at: Date.now(), state });
    return state;
  }

  /**
   * Whether a database may be edited: only when its owner server and every server with
   * a plugin pointing at it are offline. `forWrite` uses a fresher usage index and skips cached server states.
   */
  async lockStatus(
    user: UserRow,
    ownerIdentifier: string,
    databaseName: string,
    options: { forWrite?: boolean } = {},
  ): Promise<DatabaseLockStatus> {
    const [index, allServers, visibleServers] = await Promise.all([
      this.usage.get(options.forWrite ? USAGE_MAX_AGE_WRITE_MS : USAGE_MAX_AGE_VIEW_MS),
      this.servers.allServers(),
      this.servers.listForUser(user),
    ]);
    if (options.forWrite) this.stateCache.clear();

    const names = new Map(allServers.map((server) => [server.identifier, server.name]));
    const visible = new Map<string, ServerSummary>(visibleServers.map((server) => [server.identifier, server]));

    const involved = new Map<string, { role: 'owner' | 'plugin'; plugins: string[] }>();
    involved.set(ownerIdentifier, { role: 'owner', plugins: [] });
    for (const entry of index.entries) {
      if (entry.databaseName !== databaseName) continue;
      const current = involved.get(entry.serverIdentifier) ?? { role: 'plugin' as const, plugins: [] };
      current.plugins.push(entry.plugin);
      involved.set(entry.serverIdentifier, current);
    }

    const servers: DatabaseLockServer[] = await mapLimited([...involved.entries()], 4, async ([identifier, info]) => {
      const summary = visible.get(identifier);
      return {
        identifier: summary ? identifier : null,
        name: summary?.name ?? (user.isAdmin ? (names.get(identifier) ?? identifier) : HIDDEN_SERVER),
        state: await this.serverState(identifier),
        role: info.role,
        plugins: info.plugins,
        canStop: Boolean(summary?.permissions.includes('control.stop')),
      };
    });

    return {
      locked: isLocked(servers.map((server) => server.state)),
      servers,
      checkedAt: new Date().toISOString(),
    };
  }
}
