import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import type { MetaInfo, PublicUser } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { parseBody } from '../common/validation';
import { CONFIG, type AppConfig } from '../config/config';
import type { UserRow } from '../db/schema';
import { AuthService, SESSION_COOKIE, SESSION_TTL_SECONDS, toPublicUser } from './auth.service';
import { CurrentUser, Public } from './guards';

const password = z.string().min(10, 'must be at least 10 characters').max(200);

const registerSchema = z.object({
  email: z.email().max(255),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{3,32}$/, 'must be 3-32 characters: letters, numbers, _ . -'),
  password,
});

const loginSchema = z.object({
  login: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

// Login and sign-up attempts per IP per minute.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async startSession(response: Response, user: UserRow): Promise<void> {
    response.cookie(SESSION_COOKIE, await this.auth.issueSession(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE,
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: '/',
    });
  }

  @Public()
  @Get('meta')
  meta(): Promise<MetaInfo> {
    return this.auth.meta();
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response): Promise<PublicUser> {
    const input = parseBody(registerSchema, body);
    const user = await this.auth.register(input);
    await this.audit.record(user.id, 'auth.register', user.username, user.isAdmin ? 'first account: admin' : null);
    await this.startSession(response, user);
    return toPublicUser(user);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response): Promise<PublicUser> {
    const input = parseBody(loginSchema, body);
    const user = await this.auth.login(input.login, input.password);
    await this.audit.record(user.id, 'auth.login', user.username);
    await this.startSession(response, user);
    return toPublicUser(user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: UserRow): PublicUser {
    return toPublicUser(user);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: UserRow,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicUser> {
    const input = parseBody(changePasswordSchema, body);
    const updated = await this.auth.changePassword(user, input.currentPassword, input.newPassword);
    await this.audit.record(user.id, 'auth.change_password', user.username, 'signed out other sessions');
    // Other sessions are now invalid; keep this one signed in.
    await this.startSession(response, updated);
    return toPublicUser(updated);
  }
}
