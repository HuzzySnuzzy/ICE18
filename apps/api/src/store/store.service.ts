import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import type { StoreOverview, Subscription } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, isDuplicateKeyError } from '../db/database.service';
import { prefabs, subscriptions, users, type PrefabRow, type SubscriptionRow, type UserRow } from '../db/schema';
import { PterodactylError } from '../pterodactyl/pterodactyl.http';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { ServersService } from '../servers/servers.service';
import { PERIOD_MS, decideRenewal, nextPaidUntil, pterodactylUsername } from './billing';
import { CreditsService } from './credits.service';
import { PrefabsService, toStoreItem } from './prefabs.service';

const RENEWAL_INTERVAL_MS = 10 * 60_000;
const SERVER_NAME = /^[\p{L}\p{N} _.,'()&+-]{1,100}$/u;

/**
 * The store: order a server from a visible prefab, paid monthly in credits. Unpaid or
 * cancelled servers are suspended, never deleted (deleting stays forbidden).
 */
@Injectable()
export class StoreService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Store');
  private timer?: NodeJS.Timeout;
  private firstRun?: NodeJS.Timeout;
  private renewing = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly ptero: PterodactylService,
    private readonly servers: ServersService,
    private readonly prefabs: PrefabsService,
    private readonly credits: CreditsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    this.firstRun = setTimeout(() => void this.runRenewals(), 60_000);
    this.timer = setInterval(() => void this.runRenewals(), RENEWAL_INTERVAL_MS);
    this.firstRun.unref();
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.firstRun);
    clearInterval(this.timer);
  }

  private get db() {
    return this.database.db;
  }

  private toSubscription(row: SubscriptionRow, prefabName: string | null, username?: string): Subscription {
    return {
      id: row.id,
      name: row.name,
      serverIdentifier: row.serverIdentifier,
      prefabName,
      price: row.price,
      status: row.status as Subscription['status'],
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      paidUntil: row.paidUntil.toISOString(),
      createdAt: row.createdAt.toISOString(),
      ...(username !== undefined ? { username } : {}),
    };
  }

  private async withNames(rows: SubscriptionRow[], includeUser = false): Promise<Subscription[]> {
    const prefabIds = [...new Set(rows.map((row) => row.prefabId).filter((id): id is number => id !== null))];
    const names = new Map(
      prefabIds.length ? (await this.db.select({ id: prefabs.id, name: prefabs.name }).from(prefabs).where(inArray(prefabs.id, prefabIds))).map((p) => [p.id, p.name]) : [],
    );
    const userIds = [...new Set(rows.map((row) => row.userId))];
    const usernames = new Map(
      includeUser && userIds.length
        ? (await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.username])
        : [],
    );
    return rows.map((row) =>
      this.toSubscription(row, row.prefabId ? (names.get(row.prefabId) ?? null) : null, includeUser ? (usernames.get(row.userId) ?? '?') : undefined),
    );
  }

  async overview(user: UserRow): Promise<StoreOverview> {
    const [items, mine, credits] = await Promise.all([
      this.prefabs.list(true),
      this.db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).orderBy(desc(subscriptions.id)),
      this.credits.balance(user.id),
    ]);
    return { items: items.map(toStoreItem), credits, subscriptions: await this.withNames(mine) };
  }

  async allSubscriptions(): Promise<Subscription[]> {
    const rows = await this.db.select().from(subscriptions).orderBy(desc(subscriptions.id)).limit(500);
    return this.withNames(rows, true);
  }

  /**
   * The Pterodactyl user an ICE18 account's servers belong to. Creates one when the account
   * isn't linked yet, but never auto-links an existing Pterodactyl account by email: anyone
   * could register in ICE18 with someone else's email.
   */
  async ensurePterodactylUser(user: UserRow): Promise<number> {
    if (user.pteroUserId !== null) return user.pteroUserId;
    const existing = (await this.ptero.findUsers(user.email)).find((entry) => entry.email.toLowerCase() === user.email.toLowerCase());
    if (existing) {
      throw new ConflictException(
        'A Pterodactyl account with this email already exists. Link it first on the Account page (paste one of its client API keys), then order again.',
      );
    }
    let created;
    for (const suffix of ['', String(Math.floor(Math.random() * 9000) + 1000)]) {
      try {
        created = await this.ptero.createUser({
          email: user.email,
          username: pterodactylUsername(user.username, suffix),
          first_name: user.username.slice(0, 191),
          last_name: 'ICE18',
        });
        break;
      } catch (error) {
        // 422: username taken; try once more with a suffix.
        if (!(error instanceof PterodactylError) || error.status !== 422 || suffix) throw error;
      }
    }
    if (!created) throw new BadRequestException('Could not create a Pterodactyl account.');
    try {
      await this.db.update(users).set({ pteroUserId: created.id }).where(eq(users.id, user.id));
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictException('That Pterodactyl account is already linked to another ICE18 account.');
      throw error;
    }
    user.pteroUserId = created.id;
    await this.audit.record(user.id, 'store.pterodactyl_account_created', String(created.id), created.username);
    return created.id;
  }

  private checkName(name: string): string {
    const trimmed = name.trim();
    if (!SERVER_NAME.test(trimmed)) throw new BadRequestException('Server names can be 1-100 characters: letters, numbers, spaces and . , \' ( ) & + - _');
    return trimmed;
  }

  /** Customer order: pay the first period, create the server, refund if creating fails. */
  async order(user: UserRow, prefabId: number, name: string): Promise<Subscription> {
    const prefab = await this.prefabs.get(prefabId);
    if (!prefab.storeVisible) throw new NotFoundException('That product is not for sale.');
    const serverName = this.checkName(name);
    const pteroUserId = await this.ensurePterodactylUser(user);

    const charge = await this.credits.adjust(user.id, -prefab.price, `Order: ${prefab.name} "${serverName}"`);
    let server;
    try {
      server = await this.prefabs.createServer(prefab, pteroUserId, serverName);
    } catch (error) {
      await this.credits.adjust(user.id, prefab.price, `Refund: ${prefab.name} "${serverName}" could not be created`);
      this.logger.warn(`Order by ${user.username} failed: ${(error as Error).message}`);
      if (error instanceof PterodactylError) {
        throw new BadRequestException(
          `The server couldn't be created, so your credits were refunded. ${error.message.replace(/^Pterodactyl responded \d+: /, '')}`,
        );
      }
      throw error;
    }

    const [created] = await this.db
      .insert(subscriptions)
      .values({
        userId: user.id,
        prefabId: prefab.id,
        pteroServerId: server.id,
        serverIdentifier: server.identifier,
        name: serverName,
        price: prefab.price,
        status: 'active',
        paidUntil: new Date(Date.now() + PERIOD_MS),
      })
      .$returningId();
    await this.credits.linkTransaction(charge.transactionId, created!.id);
    this.servers.invalidate();
    await this.audit.record(user.id, 'store.order', server.identifier, `${prefab.name} "${serverName}" for ${prefab.price} credits`);
    const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, created!.id));
    return this.toSubscription(row!, prefab.name);
  }

  /** Admin: create a server from a prefab for any ICE18 user, free and without a subscription. */
  async adminCreate(admin: UserRow, prefabId: number, ownerId: number, name: string): Promise<{ identifier: string }> {
    const prefab: PrefabRow = await this.prefabs.get(prefabId);
    const [owner] = await this.db.select().from(users).where(eq(users.id, ownerId)).limit(1);
    if (!owner) throw new NotFoundException('No such user.');
    const pteroUserId = await this.ensurePterodactylUser(owner);
    let server;
    try {
      server = await this.prefabs.createServer(prefab, pteroUserId, this.checkName(name));
    } catch (error) {
      if (error instanceof PterodactylError) {
        throw new BadRequestException(`Pterodactyl couldn't create the server: ${error.message.replace(/^Pterodactyl responded \d+: /, '')}`);
      }
      throw error;
    }
    this.servers.invalidate();
    await this.audit.record(admin.id, 'admin.server_create', server.identifier, `${prefab.name} "${name}" for ${owner.username}`);
    return { identifier: server.identifier };
  }

  private async mine(user: UserRow, id: number): Promise<SubscriptionRow> {
    const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    if (!row || (row.userId !== user.id && !user.isAdmin)) throw new NotFoundException('No such subscription.');
    return row;
  }

  /** Stop renewing; the server stays usable until the paid period ends. */
  async cancel(user: UserRow, id: number): Promise<void> {
    const row = await this.mine(user, id);
    if (row.status === 'cancelled') return;
    await this.db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.id, id));
    await this.audit.record(user.id, 'store.cancel', row.serverIdentifier, row.name);
  }

  /** Undo a cancel, or reactivate an ended/suspended subscription (charged right away if due). */
  async resume(user: UserRow, id: number): Promise<void> {
    const row = await this.mine(user, id);
    if (row.status === 'cancelled') {
      await this.db.update(subscriptions).set({ status: 'suspended', cancelAtPeriodEnd: false }).where(eq(subscriptions.id, id));
    } else {
      await this.db.update(subscriptions).set({ cancelAtPeriodEnd: false }).where(eq(subscriptions.id, id));
    }
    await this.audit.record(user.id, 'store.resume', row.serverIdentifier, row.name);
    await this.renewOne(id);
  }

  // ---------- renewals ----------

  async runRenewals(): Promise<void> {
    if (this.renewing) return;
    this.renewing = true;
    try {
      const due = await this.db.select().from(subscriptions).where(inArray(subscriptions.status, ['active', 'suspended']));
      for (const row of due) {
        try {
          await this.renewOne(row.id);
        } catch (error) {
          this.logger.error(`Renewal of subscription ${row.id} (${row.name}) failed: ${(error as Error).message}`);
        }
      }
    } finally {
      this.renewing = false;
    }
  }

  /** Applies decideRenewal() to one subscription. */
  async renewOne(id: number, now = new Date()): Promise<string> {
    const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    if (!row) return 'none';
    const balance = await this.credits.balance(row.userId);
    const action = decideRenewal(
      { status: row.status as 'active' | 'suspended' | 'cancelled', cancelAtPeriodEnd: row.cancelAtPeriodEnd, paidUntil: row.paidUntil, price: row.price },
      balance,
      now,
    );

    switch (action) {
      case 'renew':
      case 'resume': {
        try {
          await this.credits.adjust(row.userId, -row.price, `${action === 'renew' ? 'Renewal' : 'Reactivation'}: "${row.name}"`, { subscriptionId: row.id });
        } catch {
          return 'none'; // Balance changed in between; try again next run.
        }
        if (action === 'resume') await this.ptero.unsuspendServer(row.pteroServerId);
        await this.db
          .update(subscriptions)
          .set({ status: 'active', paidUntil: nextPaidUntil(row.paidUntil, now) })
          .where(eq(subscriptions.id, row.id));
        await this.audit.record(row.userId, `store.${action}`, row.serverIdentifier, `${row.name}: ${row.price} credits`);
        break;
      }
      case 'suspend':
      case 'end':
        await this.ptero.suspendServer(row.pteroServerId);
        await this.db
          .update(subscriptions)
          .set({ status: action === 'end' ? 'cancelled' : 'suspended' })
          .where(eq(subscriptions.id, row.id));
        await this.audit.record(
          row.userId,
          action === 'end' ? 'store.ended' : 'store.suspended',
          row.serverIdentifier,
          action === 'end' ? `${row.name}: cancelled, paid period over` : `${row.name}: not enough credits (${row.price} needed)`,
        );
        break;
      default:
        return 'none';
    }
    this.servers.invalidate();
    return action;
  }
}
