import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/database';
import { users } from '../db/schema';
import { TokenService } from '../auth/token.service';
import { unauthorized } from './api.exception';
import type { AuthContext } from './auth.decorator';
import { IS_PUBLIC } from './public.decorator';

@Injectable()
export class AccessAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      auth?: AuthContext;
    }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized();
    }
    const claims = await this.tokens.verifyAccess(header.slice('Bearer '.length));
    const found = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, claims.userId))
      .limit(1);
    if (!found[0]) {
      throw unauthorized('Account is no longer available');
    }
    request.auth = claims;
    return true;
  }
}
