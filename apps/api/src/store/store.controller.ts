import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { EggDetails, EggSummary, LocationSummary, Prefab, StoreOverview, Subscription, Wallet } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { AdminOnly, CurrentUser } from '../auth/guards';
import { parseBody } from '../common/validation';
import type { UserRow } from '../db/schema';
import { CreditsService } from './credits.service';
import { PrefabsService, toPrefab } from './prefabs.service';
import { StoreService } from './store.service';

const count = (max: number) => z.number().int().min(0).max(max);
const prefabSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(''),
  nestId: z.number().int().positive(),
  eggId: z.number().int().positive(),
  dockerImage: z.string().trim().min(1).max(255),
  startup: z.string().trim().min(1).max(4000),
  environment: z.record(z.string().max(191), z.string().max(4000)).default({}),
  memory: count(10_000_000),
  swap: z.number().int().min(-1).max(10_000_000).default(0),
  disk: count(100_000_000),
  io: z.number().int().min(10).max(1000).default(500),
  cpu: count(100_000),
  databases: count(1000).default(0),
  allocations: count(1000).default(1),
  backups: count(1000).default(0),
  locationIds: z.array(z.number().int().positive()).min(1).max(50),
  price: count(100_000_000),
  storeVisible: z.boolean().default(false),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
});

/** Customers: the store, their servers' subscriptions and their credits. */
@Controller('store')
export class StoreController {
  constructor(
    private readonly store: StoreService,
    private readonly credits: CreditsService,
  ) {}

  @Get()
  overview(@CurrentUser() user: UserRow): Promise<StoreOverview> {
    return this.store.overview(user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('order')
  order(@CurrentUser() user: UserRow, @Body() body: unknown): Promise<Subscription> {
    const input = parseBody(z.object({ prefabId: z.number().int().positive(), name: z.string().min(1).max(100) }), body);
    return this.store.order(user, input.prefabId, input.name);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(204)
  async cancel(@CurrentUser() user: UserRow, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.store.cancel(user, id);
  }

  @Post('subscriptions/:id/resume')
  @HttpCode(204)
  async resume(@CurrentUser() user: UserRow, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.store.resume(user, id);
  }

  @Get('wallet')
  wallet(@CurrentUser() user: UserRow): Promise<Wallet> {
    return this.credits.wallet(user.id);
  }
}

/** Admins: prefabs, creating servers, credits and all subscriptions. */
@AdminOnly()
@Controller('admin')
export class StoreAdminController {
  constructor(
    private readonly prefabs: PrefabsService,
    private readonly store: StoreService,
    private readonly credits: CreditsService,
    private readonly audit: AuditService,
  ) {}

  @Get('prefabs')
  async list(): Promise<Prefab[]> {
    return (await this.prefabs.list()).map(toPrefab);
  }

  @Post('prefabs')
  async create(@CurrentUser() admin: UserRow, @Body() body: unknown): Promise<Prefab> {
    const prefab = await this.prefabs.create(parseBody(prefabSchema, body));
    await this.audit.record(admin.id, 'admin.prefab_create', String(prefab.id), prefab.name);
    return prefab;
  }

  @Put('prefabs/:id')
  async update(@CurrentUser() admin: UserRow, @Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<Prefab> {
    const prefab = await this.prefabs.update(id, parseBody(prefabSchema, body));
    await this.audit.record(admin.id, 'admin.prefab_update', String(id), prefab.name);
    return prefab;
  }

  @Delete('prefabs/:id')
  @HttpCode(204)
  async remove(@CurrentUser() admin: UserRow, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.prefabs.remove(id);
    await this.audit.record(admin.id, 'admin.prefab_delete', String(id));
  }

  @Post('prefabs/:id/create-server')
  createServer(@CurrentUser() admin: UserRow, @Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<{ identifier: string }> {
    const input = parseBody(z.object({ ownerId: z.number().int().positive(), name: z.string().min(1).max(100) }), body);
    return this.store.adminCreate(admin, id, input.ownerId, input.name);
  }

  @Get('catalogue/eggs')
  eggs(@Query('refresh') refresh?: string): Promise<EggSummary[]> {
    return this.prefabs.eggs(refresh === '1');
  }

  @Get('catalogue/eggs/:nest/:egg')
  egg(@Param('nest', ParseIntPipe) nest: number, @Param('egg', ParseIntPipe) egg: number): Promise<EggDetails> {
    return this.prefabs.eggDetails(nest, egg);
  }

  @Get('catalogue/locations')
  locations(): Promise<LocationSummary[]> {
    return this.prefabs.locations();
  }

  @Get('users/:id/credits')
  wallet(@Param('id', ParseIntPipe) id: number): Promise<Wallet> {
    return this.credits.wallet(id);
  }

  @Post('users/:id/credits')
  async adjust(@CurrentUser() admin: UserRow, @Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<Wallet> {
    const input = parseBody(
      z.object({ amount: z.number().int().min(-100_000_000).max(100_000_000).refine((value) => value !== 0, 'must not be 0'), reason: z.string().trim().min(1).max(200) }),
      body,
    );
    await this.credits.adjust(id, input.amount, `Admin: ${input.reason}`, { createdBy: admin.id });
    await this.audit.record(admin.id, 'admin.credits', `user:${id}`, `${input.amount > 0 ? '+' : ''}${input.amount}: ${input.reason}`);
    // A top-up may let suspended servers come back right away.
    void this.store.runRenewals();
    return this.credits.wallet(id);
  }

  @Get('subscriptions')
  subscriptions(): Promise<Subscription[]> {
    return this.store.allSubscriptions();
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(204)
  async cancel(@CurrentUser() admin: UserRow, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.store.cancel(admin, id);
  }
}
