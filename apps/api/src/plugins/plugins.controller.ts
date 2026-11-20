import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { PluginScan, PluginSetupResult, ServerDatabaseCredentials } from '@ice18/shared';
import { CurrentUser } from '../auth/guards';
import { parseBody } from '../common/validation';
import type { UserRow } from '../db/schema';
import { PluginsService } from './plugins.service';

const setupSchema = z
  .object({
    databaseId: z.string().trim().min(1).max(64).optional(),
    newDatabaseName: z.string().trim().min(1).max(48).optional(),
    host: z.string().trim().max(253).optional(),
  })
  .refine((body) => Boolean(body.databaseId) !== Boolean(body.newDatabaseName), {
    message: 'Choose either an existing database or a name for a new one.',
  });

const createSchema = z.object({ name: z.string().trim().min(1).max(48) });

@Controller('servers/:identifier')
export class PluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get('plugins')
  scan(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Query('refresh') refresh?: string,
  ): Promise<PluginScan> {
    return this.plugins.scan(user, identifier, refresh === '1' || refresh === 'true');
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('plugins/:folder/database')
  setup(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('folder') folder: string,
    @Body() body: unknown,
  ): Promise<PluginSetupResult> {
    return this.plugins.setup(user, identifier, folder, parseBody(setupSchema, body));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('databases')
  createDatabase(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Body() body: unknown,
  ): Promise<ServerDatabaseCredentials> {
    return this.plugins.createDatabase(user, identifier, parseBody(createSchema, body).name);
  }

  @Get('databases/:databaseId/credentials')
  credentials(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
  ): Promise<ServerDatabaseCredentials> {
    return this.plugins.credentials(user, identifier, databaseId);
  }
}
