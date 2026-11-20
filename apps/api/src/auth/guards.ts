import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../common/request';
import type { UserRow } from '../db/schema';
import { AuthService, SESSION_COOKIE } from './auth.service';

const IS_PUBLIC = 'ice18:isPublic';
const IS_ADMIN = 'ice18:isAdmin';

/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route needs an ICE18 admin. */
export const AdminOnly = () => SetMetadata(IS_ADMIN, true);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): UserRow => {
  const user = context.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

export const CSRF_HEADER = 'x-ice18-csrf';

/**
 * State-changing requests must carry a custom header. Browsers won't let other
 * websites add custom headers to cross-site requests, which blocks CSRF.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    if (request.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException(`Missing ${CSRF_HEADER} header.`);
    }
    return true;
  }
}

/** Every route requires a login unless marked @Public(). @AdminOnly() routes also require an admin. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<AppRequest>();
    const cookies = (request as { cookies?: Record<string, string> }).cookies ?? {};
    request.user = await this.auth.userFromSession(cookies[SESSION_COOKIE]);

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!request.user) throw new UnauthorizedException('Please log in.');
    if (this.reflector.getAllAndOverride<boolean>(IS_ADMIN, targets) && !request.user.isAdmin) {
      throw new ForbiddenException('Admins only.');
    }
    return true;
  }
}
