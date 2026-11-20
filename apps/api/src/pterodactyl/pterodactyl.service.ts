import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PowerSignal } from '@ice18/shared';
import { CONFIG, isPterodactylConfigured, type AppConfig } from '../config/config';
import { PterodactylHttp, downloadSignedFile } from './pterodactyl.http';
import type {
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
}
