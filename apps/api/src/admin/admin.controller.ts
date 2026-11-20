import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuditEntry, PterodactylUserSummary, PublicUser } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService, toPublicUser } from '../auth/auth.service';
import { AdminOnly, CurrentUser } from '../auth/guards';
import { parseBody } from '../common/validation';
import { DatabaseService, isDuplicateKeyError } from '../db/database.service';
import { users, type UserRow } from '../db/schema';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';

const linkSchema = z.object({ pteroUserId: z.number().int().positive().nullable() });
const adminSchema = z.object({ isAdmin: z.boolean() });

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
    private readonly ptero: PterodactylService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  async users(): Promise<PublicUser[]> {
    const rows = await this.database.db.select().from(users).orderBy(asc(users.id));
    return rows.map(toPublicUser);
  }

  /** Link (or unlink with null) an ICE18 account to a Pterodactyl user. */
  @Post('users/:id/pterodactyl')
  @HttpCode(200)
  async link(
    @CurrentUser() admin: UserRow,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<PublicUser> {
    const { pteroUserId } = parseBody(linkSchema, body);
    if (pteroUserId !== null) await this.ptero.getUser(pteroUserId); // 404s if it doesn't exist
    try {
      await this.database.db.update(users).set({ pteroUserId }).where(eq(users.id, id));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('That Pterodactyl user is already linked to another ICE18 account.');
      }
      throw error;
    }
    await this.audit.record(admin.id, 'admin.link_pterodactyl', `user:${id}`, String(pteroUserId));
    const updated = await this.auth.getById(id);
    if (!updated) throw new BadRequestException('No such user.');
    return toPublicUser(updated);
  }

  @Post('users/:id/admin')
  @HttpCode(200)
  async setAdmin(
    @CurrentUser() admin: UserRow,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<PublicUser> {
    const { isAdmin } = parseBody(adminSchema, body);
    if (id === admin.id && !isAdmin) throw new BadRequestException("You can't remove your own admin rights.");
    await this.database.db.update(users).set({ isAdmin }).where(eq(users.id, id));
    await this.audit.record(admin.id, isAdmin ? 'admin.grant_admin' : 'admin.revoke_admin', `user:${id}`);
    const updated = await this.auth.getById(id);
    if (!updated) throw new BadRequestException('No such user.');
    return toPublicUser(updated);
  }

  @Get('pterodactyl/users')
  async pterodactylUsers(@Query('email') email?: string): Promise<PterodactylUserSummary[]> {
    const found = await this.ptero.findUsers(email?.trim() || undefined);
    return found.map((user) => ({ id: user.id, username: user.username, email: user.email, rootAdmin: user.root_admin }));
  }

  @Get('audit')
  auditLog(): Promise<AuditEntry[]> {
    return this.audit.recent();
  }
}
