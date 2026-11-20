import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PowerSignal } from '@ice18/shared';
import { CONFIG, isPterodactylConfigured, type AppConfig } from '../config/config';
import { PterodactylHttp, downloadSignedFile } from './pterodactyl.http';
import type {
  PteroCreateServer,
  PteroEgg,
  PteroLocation,
  PteroNest,
  PteroAllocation,
  PteroEggVariable,
  PteroStartupMeta,
  PteroSubuserFull,
  PteroFileObject,
  PteroServerDatabase,
  PteroApplicationServer,
  PteroApplicationUser,
  PteroClientAccount,
  PteroItem,
  PteroList,
  PteroResources,
  PteroWebsocketCredentials,
} from './pterodactyl.types';

const IDENTIFIER = /^[A-Za-z0-9-]{1,64}$/;

function assertIdentifier(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) throw new Error(`Invalid server identifier: ${identifier}`);
  return identifier;
}

/** Typed access to the parts of the Pterodactyl API that ICE18 uses. */
@Injectable()
export class PterodactylService {
  private readonly application?: PterodactylHttp;
  private readonly client?: PterodactylHttp;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    if (isPterodactylConfigured(config)) {
      this.application = new PterodactylHttp(config.PTERODACTYL_URL!, config.PTERODACTYL_APP_KEY!);
      this.client = new PterodactylHttp(config.PTERODACTYL_URL!, config.PTERODACTYL_CLIENT_KEY!);
    }
  }

  get configured(): boolean {
    return Boolean(this.application && this.client);
  }

  /** The panel's origin; Wings only accepts console websockets that come from it. */
  get panelOrigin(): string {
    this.requireConfigured();
    return new URL(this.config.PTERODACTYL_URL!).origin;
  }

  private requireConfigured(): true {
    if (!this.application || !this.client) {
      throw new ServiceUnavailableException(
        'Pterodactyl is not connected. Set PTERODACTYL_URL, PTERODACTYL_APP_KEY and PTERODACTYL_CLIENT_KEY.',
      );
    }
    return true;
  }

  private app(): PterodactylHttp {
    this.requireConfigured();
    return this.application!;
  }

  private cli(): PterodactylHttp {
    this.requireConfigured();
    return this.client!;
  }

  async listAllServers(): Promise<PteroApplicationServer[]> {
    const servers: PteroApplicationServer[] = [];
    for (let page = 1; page <= 1000; page++) {
      const result = await this.app().request<PteroList<PteroItem<PteroApplicationServer>>>(
        'GET',
        '/api/application/servers',
        { query: { include: 'subusers,node,egg', per_page: 100, page } },
      );
      servers.push(...result.data.map((item) => item.attributes));
      const totalPages = result.meta?.pagination?.total_pages ?? 1;
      if (page >= totalPages) break;
    }
    return servers;
  }

  async findUsers(email?: string): Promise<PteroApplicationUser[]> {
    const result = await this.app().request<PteroList<PteroItem<PteroApplicationUser>>>('GET', '/api/application/users', {
      query: { per_page: 50, 'filter[email]': email || undefined },
    });
    return result.data.map((item) => item.attributes);
  }

  async getUser(id: number): Promise<PteroApplicationUser> {
    const result = await this.app().request<PteroItem<PteroApplicationUser>>('GET', `/api/application/users/${id}`);
    return result.attributes;
  }

  /**
   * Looks up whose account a client API key belongs to. Used to let people prove they
   * own a Pterodactyl account. The key is used for this one request and never stored.
   */
  async getAccountForKey(apiKey: string): Promise<PteroClientAccount> {
    this.requireConfigured();
    const http = new PterodactylHttp(this.config.PTERODACTYL_URL!, apiKey);
    const result = await http.request<PteroItem<PteroClientAccount>>('GET', '/api/client/account');
    return result.attributes;
  }

  async getResources(identifier: string): Promise<PteroResources> {
    const result = await this.cli().request<PteroItem<PteroResources>>(
      'GET',
      `/api/client/servers/${assertIdentifier(identifier)}/resources`,
    );
    return result.attributes;
  }

  async sendPower(identifier: string, signal: PowerSignal): Promise<void> {
    await this.cli().request('POST', `/api/client/servers/${assertIdentifier(identifier)}/power`, { body: { signal } });
  }

  async getWebsocketCredentials(identifier: string): Promise<{ token: string; socket: string }> {
    const result = await this.cli().request<PteroWebsocketCredentials>(
      'GET',
      `/api/client/servers/${assertIdentifier(identifier)}/websocket`,
    );
    return result.data;
  }

  async listFiles(identifier: string, directory: string): Promise<PteroFileObject[]> {
    const result = await this.cli().request<PteroList<PteroItem<PteroFileObject>>>(
      'GET',
      `/api/client/servers/${assertIdentifier(identifier)}/files/list`,
      { query: { directory } },
    );
    return result.data.map((item) => item.attributes);
  }

  readFile(identifier: string, file: string): Promise<string> {
    return this.cli().request<string>('GET', `/api/client/servers/${assertIdentifier(identifier)}/files/contents`, {
      query: { file },
      responseType: 'text',
    });
  }

  /** Only plugin config files can be written; the safety rules refuse anything else. */
  async writeFile(identifier: string, file: string, contents: string): Promise<void> {
    await this.cli().request('POST', `/api/client/servers/${assertIdentifier(identifier)}/files/write`, {
      query: { file },
      textBody: contents,
    });
  }

  async listDatabases(identifier: string, includePasswords = false): Promise<PteroServerDatabase[]> {
    const result = await this.cli().request<PteroList<PteroItem<PteroServerDatabase>>>(
      'GET',
      `/api/client/servers/${assertIdentifier(identifier)}/databases`,
      { query: { include: includePasswords ? 'password' : undefined } },
    );
    return result.data.map((item) => item.attributes);
  }

  async createDatabase(identifier: string, name: string): Promise<PteroServerDatabase> {
    const result = await this.cli().request<PteroItem<PteroServerDatabase>>(
      'POST',
      `/api/client/servers/${assertIdentifier(identifier)}/databases`,
      { body: { database: name, remote: '%' } },
    );
    return result.attributes;
  }

  /** Downloads a copy of a SQLite file from a plugin folder (the safety rules refuse anything else). */
  async downloadFile(identifier: string, file: string, destination: string, maxBytes: number): Promise<number> {
    const signed = await this.cli().request<PteroItem<{ url: string }>>(
      'GET',
      `/api/client/servers/${assertIdentifier(identifier)}/files/download`,
      { query: { file } },
    );
    return downloadSignedFile(signed.attributes.url, destination, maxBytes);
  }

  // ---- File manager (paths are checked again by the safety rules) ----

  private server(identifier: string): string {
    return `/api/client/servers/${assertIdentifier(identifier)}`;
  }

  async signedDownloadUrl(identifier: string, file: string): Promise<string> {
    const result = await this.cli().request<PteroItem<{ url: string }>>('GET', `${this.server(identifier)}/files/download`, { query: { file } });
    return result.attributes.url;
  }

  async signedUploadUrl(identifier: string): Promise<string> {
    const result = await this.cli().request<PteroItem<{ url: string }>>('GET', `${this.server(identifier)}/files/upload`);
    return result.attributes.url;
  }

  async createFolder(identifier: string, root: string, name: string): Promise<void> {
    await this.cli().request('POST', `${this.server(identifier)}/files/create-folder`, { body: { root, name } });
  }

  async renameFiles(identifier: string, root: string, files: Array<{ from: string; to: string }>): Promise<void> {
    await this.cli().request('PUT', `${this.server(identifier)}/files/rename`, { body: { root, files } });
  }

  async copyFile(identifier: string, location: string): Promise<void> {
    await this.cli().request('POST', `${this.server(identifier)}/files/copy`, { body: { location } });
  }

  async compressFiles(identifier: string, root: string, files: string[]): Promise<PteroFileObject> {
    const result = await this.cli().request<PteroItem<PteroFileObject>>('POST', `${this.server(identifier)}/files/compress`, {
      body: { root, files },
    });
    return result.attributes;
  }

  async decompressFile(identifier: string, root: string, file: string): Promise<void> {
    await this.cli().request('POST', `${this.server(identifier)}/files/decompress`, { body: { root, file } });
  }

  /** Real delete (owner-approved). The safety rules cap it and check every path. */
  async deleteFiles(identifier: string, root: string, files: string[]): Promise<void> {
    await this.cli().request('POST', `${this.server(identifier)}/files/delete`, { body: { root, files } });
  }

  // ---- Users ----

  async permissionCatalogue(): Promise<Record<string, { description: string; keys: Record<string, string> }>> {
    const result = await this.cli().request<PteroItem<{ permissions: Record<string, { description: string; keys: Record<string, string> }> }>>(
      'GET',
      '/api/client/permissions',
    );
    return result.attributes.permissions;
  }

  async listSubusers(identifier: string): Promise<PteroSubuserFull[]> {
    const result = await this.cli().request<PteroList<PteroItem<PteroSubuserFull>>>('GET', `${this.server(identifier)}/users`);
    return result.data.map((item) => item.attributes);
  }

  async createSubuser(identifier: string, email: string, permissions: string[]): Promise<PteroSubuserFull> {
    const result = await this.cli().request<PteroItem<PteroSubuserFull>>('POST', `${this.server(identifier)}/users`, {
      body: { email, permissions },
    });
    return result.attributes;
  }

  async updateSubuser(identifier: string, uuid: string, permissions: string[]): Promise<PteroSubuserFull> {
    const result = await this.cli().request<PteroItem<PteroSubuserFull>>('POST', `${this.server(identifier)}/users/${assertIdentifier(uuid)}`, {
      body: { permissions },
    });
    return result.attributes;
  }

  async removeSubuser(identifier: string, uuid: string): Promise<void> {
    await this.cli().request('DELETE', `${this.server(identifier)}/users/${assertIdentifier(uuid)}`);
  }

  // ---- Startup ----

  async startup(identifier: string): Promise<{ variables: PteroEggVariable[]; meta: PteroStartupMeta }> {
    const result = await this.cli().request<PteroList<PteroItem<PteroEggVariable>> & { meta: PteroStartupMeta }>(
      'GET',
      `${this.server(identifier)}/startup`,
    );
    return { variables: result.data.map((item) => item.attributes), meta: result.meta };
  }

  async updateStartupVariable(identifier: string, key: string, value: string): Promise<PteroEggVariable> {
    const result = await this.cli().request<PteroItem<PteroEggVariable>>('PUT', `${this.server(identifier)}/startup/variable`, {
      body: { key, value },
    });
    return result.attributes;
  }

  async renameServer(identifier: string, name: string, description?: string): Promise<void> {
    await this.cli().request('POST', `${this.server(identifier)}/settings/rename`, {
      body: description === undefined ? { name } : { name, description },
    });
  }

  // ---- Network ----

  async allocations(identifier: string): Promise<PteroAllocation[]> {
    const result = await this.cli().request<PteroList<PteroItem<PteroAllocation>>>('GET', `${this.server(identifier)}/network/allocations`);
    return result.data.map((item) => item.attributes);
  }

  async assignAllocation(identifier: string): Promise<PteroAllocation> {
    const result = await this.cli().request<PteroItem<PteroAllocation>>('POST', `${this.server(identifier)}/network/allocations`);
    return result.attributes;
  }

  async setAllocationNotes(identifier: string, id: number, notes: string | null): Promise<PteroAllocation> {
    const result = await this.cli().request<PteroItem<PteroAllocation>>('POST', `${this.server(identifier)}/network/allocations/${id}`, {
      body: { notes },
    });
    return result.attributes;
  }

  async setPrimaryAllocation(identifier: string, id: number): Promise<PteroAllocation> {
    const result = await this.cli().request<PteroItem<PteroAllocation>>('POST', `${this.server(identifier)}/network/allocations/${id}/primary`);
    return result.attributes;
  }

  // ---- Prefabs & store (Application API) ----

  async nests(): Promise<PteroNest[]> {
    const result = await this.app().request<PteroList<PteroItem<PteroNest>>>('GET', '/api/application/nests', { query: { per_page: 100 } });
    return result.data.map((item) => item.attributes);
  }

  async eggs(nestId: number): Promise<PteroEgg[]> {
    const result = await this.app().request<PteroList<PteroItem<PteroEgg>>>('GET', `/api/application/nests/${nestId}/eggs`, {
      query: { per_page: 100 },
    });
    return result.data.map((item) => item.attributes);
  }

  async egg(nestId: number, eggId: number): Promise<PteroEgg> {
    const result = await this.app().request<PteroItem<PteroEgg>>('GET', `/api/application/nests/${nestId}/eggs/${eggId}`, {
      query: { include: 'variables' },
    });
    return result.attributes;
  }

  async locations(): Promise<PteroLocation[]> {
    const result = await this.app().request<PteroList<PteroItem<PteroLocation>>>('GET', '/api/application/locations', { query: { per_page: 100 } });
    return result.data.map((item) => item.attributes);
  }

  async createUser(input: { email: string; username: string; first_name: string; last_name: string }): Promise<PteroApplicationUser> {
    const result = await this.app().request<PteroItem<PteroApplicationUser>>('POST', '/api/application/users', { body: input });
    return result.attributes;
  }

  async createServer(input: PteroCreateServer): Promise<PteroApplicationServer> {
    const result = await this.app().request<PteroItem<PteroApplicationServer>>('POST', '/api/application/servers', { body: input });
    return result.attributes;
  }

  async suspendServer(serverId: number): Promise<void> {
    await this.app().request('POST', `/api/application/servers/${serverId}/suspend`);
  }

  async unsuspendServer(serverId: number): Promise<void> {
    await this.app().request('POST', `/api/application/servers/${serverId}/unsuspend`);
  }
}
