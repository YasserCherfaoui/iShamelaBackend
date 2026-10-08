import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AuthService } from '../auth/auth.service';
import { FirebaseTokenVerifier } from '../auth/firebase.verifier';
import { jwtAlg } from '../auth/firebase-identity';
import { TokenService } from '../auth/token.service';
import { DRIZZLE, type Database } from '../db/database';
import { users } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { unauthorized } from './api.exception';
import type { AuthContext } from './auth.decorator';
import { IS_PUBLIC } from './public.decorator';

const deviceIdSchema = z.string().uuid();

@Injectable()
export class AccessAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly firebase: FirebaseTokenVerifier,
    private readonly authService: AuthService,
    private readonly devices: DevicesService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string; 'x-device-id'?: string | string[] };
      auth?: AuthContext;
    }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized();
    }
    const token = header.slice('Bearer '.length);
    const claims = await this.claimsFor(token, request.headers['x-device-id']);
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

  private async claimsFor(token: string, deviceHeader: string | string[] | undefined): Promise<AuthContext> {
    const alg = jwtAlg(token);
    if (alg === 'HS256') {
      return this.tokens.verifyAccess(token);
    }
    if (alg !== 'RS256') {
      throw unauthorized('Access token is invalid');
    }
    const identity = await this.firebase.verify(token);
    const userId = await this.authService.linkIdentity(identity);
    const raw = Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader;
    const deviceId = deviceIdSchema.safeParse(raw);
    if (!deviceId.success) {
      throw unauthorized('X-Device-Id is required');
    }
    await this.devices.ensure(userId, deviceId.data);
    return { userId, deviceId: deviceId.data };
  }
}
