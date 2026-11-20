import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PowerSignal, ServerPermission, ServerResources, ServerSummary } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import type { UserRow } from '../db/schema';
import type { PteroApplicationServer } from '../pterodactyl/pterodactyl.types';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { computePermissions, permissionForSignal } from './access';

const CACHE_MS = 15_000;

export interface ServerAccess {
  server: ServerSummary;
  permissions: ServerPermission[];
  /**
   * Every Pterodactyl permission the viewer has on this server, or '*' for admins and the
   * owner. ICE18 acts with the admin key, so it must check this itself, e.g. so a subuser
   * can't hand out permissions they don't have.
   */
  grantable: string[] | '*';
  /** The viewer's own Pterodactyl user id is the owner's. */
  isOwner: boolean;
}

/**
 * Servers from every source, filtered to what the current user may see.
 * Today the only source is Pterodactyl; native Wings nodes would plug in here.
 */
@Injectable()
export class ServersService {
  private cache?: { at: number; servers: PteroApplicationServer[] };
  private inflight?: Promise<PteroApplicationServer[]>;

  constructor(
    private readonly ptero: PterodactylService,
    private readonly audit: AuditService,
  ) {}

  private async allPterodactylServers(): Promise<PteroApplicationServer[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.servers;
    this.inflight ??= this.ptero
      .listAllServers()
      .then((servers) => {
        this.cache = { at: Date.now(), servers };
        return servers;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  private summarize(server: PteroApplicationServer, permissions: ServerPermission[]): ServerSummary {
    return {
      identifier: server.identifier,
      uuid: server.uuid,
      name: server.name,
      description: server.description ?? '',
      source: 'pterodactyl',
      node: server.relationships?.node?.attributes.name ?? null,
      egg: server.relationships?.egg?.attributes.name ?? null,
      status: server.status,
      suspended: server.suspended,
      limits: { memory: server.limits.memory, disk: server.limits.disk, cpu: server.limits.cpu },
      ownerPteroUserId: server.user,
      permissions,
    };
  }

  private accessFor(user: UserRow, server: PteroApplicationServer): ServerPermission[] | null {
    return computePermissions(
      { isAdmin: user.isAdmin, pteroUserId: user.pteroUserId ?? null },
      {
        ownerId: server.user,
        subusers: (server.relationships?.subusers?.data ?? []).map((item) => ({
          userId: item.attributes.user_id,
          permissions: item.attributes.permissions,
        })),
      },
    );
  }

  /** Forget cached server details (e.g. after a rename). */
  invalidate(): void {
    this.cache = undefined;
  }

  /** Every server on the panel (identifier and name), whoever owns it. For system checks only. */
  async allServers(): Promise<Array<{ identifier: string; name: string }>> {
    if (!this.ptero.configured) return [];
    return (await this.allPterodactylServers()).map((server) => ({ identifier: server.identifier, name: server.name }));
  }

  async listForUser(user: UserRow): Promise<ServerSummary[]> {
    if (!this.ptero.configured) return [];
    const servers = await this.allPterodactylServers();
    return servers
      .map((server) => {
        const permissions = this.accessFor(user, server);
        return permissions ? this.summarize(server, permissions) : null;
      })
      .filter((summary): summary is ServerSummary => summary !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Throws 404 (not 403) for servers the user can't see, so their existence isn't revealed. */
  async getForUser(user: UserRow, identifier: string): Promise<ServerAccess> {
    const server = (await this.allPterodactylServers()).find((entry) => entry.identifier === identifier);
    const permissions = server ? this.accessFor(user, server) : null;
    if (!server || !permissions) throw new NotFoundException('Server not found.');
    const isOwner = user.pteroUserId !== null && user.pteroUserId === server.user;
    const subuser = (server.relationships?.subusers?.data ?? []).find((item) => item.attributes.user_id === user.pteroUserId);
    const grantable = user.isAdmin || isOwner ? '*' : (subuser?.attributes.permissions ?? []);
    return { server: this.summarize(server, permissions), permissions, grantable, isOwner };
  }

  async resources(user: UserRow, identifier: string): Promise<ServerResources> {
    await this.getForUser(user, identifier);
    const stats = await this.ptero.getResources(identifier);
    return {
      state: stats.current_state,
      isSuspended: stats.is_suspended,
      memoryBytes: stats.resources.memory_bytes,
      cpuPercent: stats.resources.cpu_absolute,
      diskBytes: stats.resources.disk_bytes,
      networkRxBytes: stats.resources.network_rx_bytes,
      networkTxBytes: stats.resources.network_tx_bytes,
      uptimeMs: stats.resources.uptime,
    };
  }

  async power(user: UserRow, identifier: string, signal: PowerSignal): Promise<void> {
    const { permissions, server } = await this.getForUser(user, identifier);
    if (!permissions.includes(permissionForSignal(signal))) {
      throw new ForbiddenException(`You don't have permission to ${signal} this server.`);
    }
    await this.ptero.sendPower(identifier, signal);
    await this.audit.record(user.id, `server.power.${signal}`, identifier, server.name);
  }
}
