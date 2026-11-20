import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { count, eq, or, sql } from 'drizzle-orm';
import type { MetaInfo, PublicUser } from '@ice18/shared';
import { CONFIG, isPterodactylConfigured, type AppConfig } from '../config/config';
import { DatabaseService, isDuplicateKeyError } from '../db/database.service';
import { users, type UserRow } from '../db/schema';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE = 'ice18_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

interface SessionPayload {
  sub: number;
  v: number;
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    isAdmin: user.isAdmin,
    pteroUserId: user.pteroUserId ?? null,
    credits: user.credits,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Minimal Cookie header parser, used for websocket upgrades (which skip Express middleware). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.database.db;
  }

  async userCount(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(users);
    return row?.value ?? 0;
  }

  async meta(): Promise<MetaInfo> {
    const needsSetup = (await this.userCount()) === 0;
    return {
      needsSetup,
      registrationOpen: needsSetup || this.config.REGISTRATION_ENABLED,
      pterodactylConfigured: isPterodactylConfigured(this.config),
    };
  }

  async register(input: { email: string; username: string; password: string }): Promise<UserRow> {
    const isFirstUser = (await this.userCount()) === 0;
    if (!isFirstUser && !this.config.REGISTRATION_ENABLED) {
      throw new ForbiddenException('Registration is closed. Ask an admin for an account.');
    }
    const passwordHash = await hashPassword(input.password);
    try {
      const [created] = await this.db
        .insert(users)
        .values({
          email: input.email.toLowerCase(),
          username: input.username,
          passwordHash,
          // The very first account owns the panel.
          isAdmin: isFirstUser,
        })
        .$returningId();
      return this.getById(created!.id) as Promise<UserRow>;
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictException('That email or username is already taken.');
      throw error;
    }
  }

  async login(login: string, password: string): Promise<UserRow> {
    const identifier = login.trim();
    const [user] = await this.db
      .select()
      .from(users)
      .where(or(eq(users.email, identifier.toLowerCase()), eq(users.username, identifier)))
      .limit(1);
    // Hash even when the user doesn't exist so response time doesn't reveal which accounts exist.
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : (await hashPassword(password), false);
    if (!user || !ok) throw new UnauthorizedException('Wrong username/email or password.');
    return user;
  }

  async changePassword(user: UserRow, currentPassword: string, newPassword: string): Promise<UserRow> {
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is wrong.');
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id));
    return (await this.getById(user.id))!;
  }

  async getById(id: number): Promise<UserRow | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  issueSession(user: UserRow): Promise<string> {
    const payload: SessionPayload = { sub: user.id, v: user.sessionVersion };
    return this.jwt.signAsync(payload, { expiresIn: SESSION_TTL_SECONDS });
  }

  /** Returns the logged-in user for a session token, or undefined. */
  async userFromSession(token: string | undefined): Promise<UserRow | undefined> {
    if (!token) return undefined;
    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      return undefined;
    }
    const user = await this.getById(payload.sub);
    if (!user || user.sessionVersion !== payload.v) return undefined;
    return user;
  }

  userFromCookieHeader(header: string | undefined): Promise<UserRow | undefined> {
    return this.userFromSession(readCookie(header, SESSION_COOKIE));
  }
}
