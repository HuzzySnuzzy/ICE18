import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { CONFIG, type AppConfig } from '../config/config';
import type { UserRow } from '../db/schema';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { filterClientMessage } from './console-filter';
import { ServersService, type ServerAccess } from './servers.service';

const CONSOLE_PATH = /^\/api\/servers\/([A-Za-z0-9-]{1,64})\/console$/;

/** Close codes the web app understands. 44xx = don't retry, 45xx = retry. */
export const CloseCode = {
  NotLoggedIn: 4401,
  Forbidden: 4403,
  NotFound: 4404,
  UpstreamClosed: 4500,
  UpstreamError: 4502,
} as const;

/**
 * Browser <-> ICE18 <-> Wings console relay.
 *
 * The browser never sees a Wings token. ICE18 checks the user's permissions, fetches
 * the token from Pterodactyl, connects to Wings with the panel's Origin (which Wings
 * requires), refreshes the token before it expires, and only forwards browser
 * messages that pass `filterClientMessage`.
 */
@Injectable()
export class ConsoleRelay implements OnModuleDestroy {
  private readonly logger = new Logger('Console');
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private readonly alive = new WeakSet<WebSocket>();
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly auth: AuthService,
    private readonly servers: ServersService,
    private readonly ptero: PterodactylService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  attach(server: HttpServer): void {
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const match = CONSOLE_PATH.exec((request.url ?? '').split('?')[0] ?? '');
      if (!match) {
        socket.destroy();
        return;
      }
      if (!this.originAllowed(request)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (client) => {
        this.alive.add(client);
        client.on('pong', () => this.alive.add(client));
        this.accept(client, request, match[1]!).catch((error: Error) => {
          this.logger.error(`Console connection failed: ${error.message}`);
          client.close(CloseCode.UpstreamError, 'Internal error');
        });
      });
    });

    // Keep connections alive through proxies and drop dead ones.
    this.heartbeat = setInterval(() => {
      for (const client of this.wss.clients) {
        if (!this.alive.has(client)) {
          client.terminate();
          continue;
        }
        this.alive.delete(client);
        client.ping();
      }
    }, 30_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    for (const client of this.wss.clients) client.close(1001, 'Panel shutting down');
    this.wss.close();
  }

  /** Blocks other websites from opening a console with the visitor's cookie. */
  private originAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return false;
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      return false;
    }
    if (this.config.PUBLIC_URL) return originUrl.origin === new URL(this.config.PUBLIC_URL).origin;

    const forwardedHost = this.config.TRUST_PROXY ? request.headers['x-forwarded-host'] : undefined;
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
    return Boolean(host) && originUrl.host === host;
  }

  private async accept(client: WebSocket, request: IncomingMessage, identifier: string): Promise<void> {
    const user = await this.auth.userFromCookieHeader(request.headers.cookie);
    if (!user) return client.close(CloseCode.NotLoggedIn, 'Please log in.');

    let access: ServerAccess;
    try {
      access = await this.servers.getForUser(user, identifier);
    } catch {
      return client.close(CloseCode.NotFound, 'Server not found.');
    }
    if (!access.permissions.includes('websocket.connect')) {
      return client.close(CloseCode.Forbidden, "You don't have access to this server's console.");
    }

    new ConsoleSession(client, identifier, user, access, this.ptero, this.audit, this.logger).start();
  }
}

class ConsoleSession {
  private upstream?: WebSocket;
  private authenticated = false;
  private closed = false;
  private refreshing = false;

  constructor(
    private readonly client: WebSocket,
    private readonly identifier: string,
    private readonly user: UserRow,
    private readonly access: ServerAccess,
    private readonly ptero: PterodactylService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.client.on('message', (data, isBinary) => this.fromClient(data, isBinary));
    this.client.on('close', () => this.shutdown());
    this.client.on('error', () => this.shutdown());
    void this.connectUpstream();
  }

  private notify(level: 'info' | 'warning' | 'error', message: string): void {
    if (this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify({ event: 'ice18 notice', args: [level, message] }));
    }
  }

  private closeClient(code: number, reason: string): void {
    if (this.client.readyState === WebSocket.OPEN || this.client.readyState === WebSocket.CONNECTING) {
      this.client.close(code, reason);
    }
    this.shutdown();
  }

  private async connectUpstream(): Promise<void> {
    let credentials: { token: string; socket: string };
    try {
      credentials = await this.ptero.getWebsocketCredentials(this.identifier);
    } catch (error) {
      this.notify('error', `Pterodactyl refused console access: ${(error as Error).message}`);
      return this.closeClient(CloseCode.UpstreamError, 'Pterodactyl error');
    }
    if (this.closed) return;

    const upstream = new WebSocket(credentials.socket, { origin: this.ptero.panelOrigin, handshakeTimeout: 10_000 });
    this.upstream = upstream;

    upstream.on('open', () => upstream.send(JSON.stringify({ event: 'auth', args: [credentials.token] })));
    upstream.on('message', (data) => this.fromUpstream(data.toString()));
    upstream.on('error', (error) => {
      this.logger.warn(`Wings connection for ${this.identifier} failed: ${error.message}`);
    });
    upstream.on('close', () => {
      if (this.closed) return;
      this.notify('error', 'Lost connection to the server node. Reconnecting…');
      this.closeClient(CloseCode.UpstreamClosed, 'Node connection closed');
    });
  }

  private fromUpstream(raw: string): void {
    let event: unknown;
    try {
      event = (JSON.parse(raw) as { event?: unknown }).event;
    } catch {
      return;
    }
    if (event === 'auth success') {
      // Wings repeats this after every token renewal; the browser only needs the first one.
      if (this.authenticated) return;
      this.authenticated = true;
    }
    if (event === 'token expiring' || event === 'token expired') {
      void this.refreshToken();
      return;
    }
    if (this.client.readyState === WebSocket.OPEN) this.client.send(raw);
  }

  private async refreshToken(): Promise<void> {
    if (this.refreshing || this.closed) return;
    this.refreshing = true;
    try {
      const { token } = await this.ptero.getWebsocketCredentials(this.identifier);
      if (this.upstream?.readyState === WebSocket.OPEN) {
        this.upstream.send(JSON.stringify({ event: 'auth', args: [token] }));
      }
    } catch (error) {
      this.notify('error', `Could not renew console access: ${(error as Error).message}`);
    } finally {
      this.refreshing = false;
    }
  }

  private fromClient(data: RawData, isBinary: boolean): void {
    if (isBinary) return;
    const result = filterClientMessage(data.toString(), this.access.permissions);
    if (result.kind === 'reject') return this.notify('error', result.reason);
    if (result.kind !== 'forward') return;

    if (!this.authenticated || this.upstream?.readyState !== WebSocket.OPEN) {
      return this.notify('warning', 'The console is still connecting. Try again in a moment.');
    }
    this.upstream.send(JSON.stringify(result.message));
    if (result.audit) {
      void this.audit.record(this.user.id, result.audit.action, this.identifier, result.audit.detail);
    }
  }

  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    const upstream = this.upstream;
    if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
      upstream.terminate();
    }
  }
}
