import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { JWTVerifyGetKey } from 'jose';

import { ApiException, unauthorized, tokenInvalid } from '../common/api.exception';
import type { AuthContext } from '../common/auth.decorator';
import { addDuration, ENV, type Env } from '../config/env';
import { DRIZZLE, type Database } from '../db/database';
import { refreshTokens } from '../db/schema';

export const APPLE_JWKS = Symbol('APPLE_JWKS');
export type AppleJwks = JWTVerifyGetKey;

type LockedRefresh = {
  id: string;
  user_id: string;
  device_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};

@Injectable()
export class TokenService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async signAccess(userId: string, deviceId: string): Promise<string> {
    const { SignJWT } = await import('jose');
    return new SignJWT({ dev: deviceId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(this.env.ACCESS_TOKEN_TTL)
      .sign(secretKey(this.env.JWT_ACCESS_SECRET));
  }

  async verifyAccess(token: string): Promise<AuthContext> {
    const { jwtVerify } = await import('jose');
    try {
      const { payload } = await jwtVerify(token, secretKey(this.env.JWT_ACCESS_SECRET), {
        algorithms: ['HS256'],
      });
      if (!payload.sub || typeof payload.dev !== 'string') throw unauthorized();
      return { userId: payload.sub, deviceId: payload.dev };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw unauthorized('Access token is invalid');
    }
  }

  async issueRefresh(
    db: Database,
    userId: string,
    deviceId: string,
    familyId: string = randomUUID(),
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await db.insert(refreshTokens).values({
      id: randomUUID(),
      userId,
      deviceId,
      tokenHash: hashToken(token),
      familyId,
      expiresAt: addDuration(now, this.env.REFRESH_TOKEN_TTL),
      createdAt: now,
    });
    return token;
  }

  async rotate(presented: string): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = hashToken(presented);
    const outcome = await this.db.transaction(async (tx) => {
      const executor = tx as unknown as Database;
      const locked = await executor.execute<LockedRefresh>(sql`
        select id, user_id, device_id, family_id, expires_at, revoked_at
        from refresh_tokens
        where token_hash = ${hash}
        for update
      `);
      const row = locked.rows[0];
      if (!row) return { kind: 'invalid' as const };
      if (row.revoked_at) return { kind: 'reuse' as const, familyId: row.family_id };
      if (new Date(row.expires_at).getTime() <= Date.now()) return { kind: 'invalid' as const };
      await executor
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, row.id));
      const refreshToken = await this.issueRefresh(
        executor,
        row.user_id,
        row.device_id,
        row.family_id,
      );
      const accessToken = await this.signAccess(row.user_id, row.device_id);
      return { kind: 'ok' as const, accessToken, refreshToken };
    });

    if (outcome.kind === 'reuse') {
      await this.revokeFamily(this.db, outcome.familyId);
      throw tokenInvalid('Refresh token reuse detected');
    }
    if (outcome.kind === 'invalid') throw tokenInvalid('Refresh token is invalid');
    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
  }

  async revokePresentedFamily(presented: string): Promise<void> {
    const found = await this.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(presented)))
      .limit(1);
    if (!found[0]) return;
    await this.revokeFamily(this.db, found[0].familyId);
  }

  async revokeFamily(db: Database, familyId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}
