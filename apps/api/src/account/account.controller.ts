import { BadRequestException, Body, ConflictException, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PublicUser } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService, toPublicUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/guards';
import { parseBody } from '../common/validation';
import { DatabaseService, isDuplicateKeyError } from '../db/database.service';
import { users, type UserRow } from '../db/schema';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import { PterodactylError } from '../pterodactyl/pterodactyl.http';

const linkSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{20,128}$/, "doesn't look like a Pterodactyl client API key"),
});

@Controller('account')
export class AccountController {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
    private readonly ptero: PterodactylService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Links this ICE18 account to a Pterodactyl account. The user proves they own it by
   * pasting one of its client API keys; ICE18 uses the key once to ask Pterodactyl
   * whose account it is, then forgets it.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('link-pterodactyl')
  @HttpCode(200)
  async link(@CurrentUser() user: UserRow, @Body() body: unknown): Promise<PublicUser> {
    const { apiKey } = parseBody(linkSchema, body);
    if (apiKey.startsWith('ptla_')) {
      throw new BadRequestException('That is an Application (admin) key. Use a key from Account → API Credentials.');
    }

    let account;
    try {
      account = await this.ptero.getAccountForKey(apiKey);
    } catch (error) {
      if (error instanceof PterodactylError && (error.status === 401 || error.status === 403)) {
        throw new BadRequestException('Pterodactyl did not accept that API key.');
      }
      throw error;
    }

    try {
      await this.database.db.update(users).set({ pteroUserId: account.id }).where(eq(users.id, user.id));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('That Pterodactyl account is already linked to another ICE18 account.');
      }
      throw error;
    }
    await this.audit.record(user.id, 'account.link_pterodactyl', String(account.id), account.username);
    return toPublicUser((await this.auth.getById(user.id))!);
  }

  @Post('unlink-pterodactyl')
  @HttpCode(200)
  async unlink(@CurrentUser() user: UserRow): Promise<PublicUser> {
    await this.database.db.update(users).set({ pteroUserId: null }).where(eq(users.id, user.id));
    await this.audit.record(user.id, 'account.unlink_pterodactyl', String(user.pteroUserId ?? ''));
    return toPublicUser((await this.auth.getById(user.id))!);
  }
}
