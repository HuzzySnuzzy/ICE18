import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { POWER_SIGNALS, type ServerResources, type ServerSummary } from '@ice18/shared';
import { CurrentUser } from '../auth/guards';
import { parseBody } from '../common/validation';
import type { UserRow } from '../db/schema';
import { ServersService } from './servers.service';

const powerSchema = z.object({ signal: z.enum(POWER_SIGNALS) });

@Controller('servers')
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  list(@CurrentUser() user: UserRow): Promise<ServerSummary[]> {
    return this.servers.listForUser(user);
  }

  @Get(':identifier')
  async get(@CurrentUser() user: UserRow, @Param('identifier') identifier: string): Promise<ServerSummary> {
    return (await this.servers.getForUser(user, identifier)).server;
  }

  @Get(':identifier/resources')
  resources(@CurrentUser() user: UserRow, @Param('identifier') identifier: string): Promise<ServerResources> {
    return this.servers.resources(user, identifier);
  }

  @Post(':identifier/power')
  @HttpCode(204)
  async power(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { signal } = parseBody(powerSchema, body);
    await this.servers.power(user, identifier, signal);
  }
}
