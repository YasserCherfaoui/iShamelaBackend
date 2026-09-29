import { randomInt, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ApiException } from '../common/api.exception';
import { maskEmail } from '../common/mask-email';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Database } from '../db/database';
import { authIdentities, devices, otpCodes, users } from '../db/schema';
import { MAIL, type MailSender } from '../mail/mail.service';
import type { AppleCredentials } from './apple-credentials';
import { AppleSigninCredentials } from './apple-credentials';
import { AppleTokenVerifier } from './apple.verifier';
import { GoogleTokenVerifier } from './google.verifier';
import { TokenService } from './token.service';

const DeviceSchema = z.object({
  id: z.string().uuid().optional(),
  platform: z.string().min(1),
  appVersion: z.string().min(1),
  model: z.string().optional(),
});

export class DeviceDto extends createZodDto(DeviceSchema) {}

const AppleAuthSchema = z.object({
  identityToken: z.string().min(1),
  authorizationCode: z.string().min(1).optional(),
  device: DeviceSchema,
});
export class AppleAuthDto extends createZodDto(AppleAuthSchema) {}

const GoogleAuthSchema = z.object({
  idToken: z.string().min(1),
  device: DeviceSchema,
});
export class GoogleAuthDto extends createZodDto(GoogleAuthSchema) {}

const OtpRequestSchema = z.object({
  email: z.string().email(),
});
export class OtpRequestDto extends createZodDto(OtpRequestSchema) {}

const OtpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  device: DeviceSchema,
});
export class OtpVerifyDto extends createZodDto(OtpVerifySchema) {}

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export class RefreshDto extends createZodDto(RefreshSchema) {}

export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string | null; displayName: string | null };
  device: { id: string };
  isNewUser: boolean;
};

type ProviderName = 'apple' | 'google' | 'email';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(MAIL) private readonly mail: MailSender,
    private readonly tokens: TokenService,
    private readonly appleTokens: AppleTokenVerifier,
    private readonly googleTokens: GoogleTokenVerifier,
    @Inject(AppleSigninCredentials) private readonly appleCredentials: AppleCredentials,
  ) {}

  async signInWithApple(body: AppleAuthDto): Promise<AuthResult> {
    const identity = await this.appleTokens.verify(body.identityToken);
    let appleRefresh: string | null = null;
    if (body.authorizationCode) {
      appleRefresh = await this.appleCredentials.exchangeAuthorizationCode(body.authorizationCode);
    }
    return this.signInWithIdentity({
      provider: 'apple',
      subject: identity.sub,
      email: identity.email,
      device: body.device,
      appleRefreshToken: appleRefresh,
    });
  }

  async signInWithGoogle(body: GoogleAuthDto): Promise<AuthResult> {
    const identity = await this.googleTokens.verify(body.idToken);
    return this.signInWithIdentity({
      provider: 'google',
      subject: identity.sub,
      email: identity.email,
      device: body.device,
    });
  }

  async requestOtp(emailRaw: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const windowStart = new Date(Date.now() - 15 * 60 * 1000);
    const recent = await this.db
      .select({ id: otpCodes.id })
      .from(otpCodes)
      .where(and(sql`lower(${otpCodes.email}::text) = ${email}`, gt(otpCodes.createdAt, windowStart)));
    if (recent.length >= 3) {
      this.logger.log(`otp suppressed ${maskEmail(email)}`);
      return;
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    const now = new Date();
    await this.db
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(and(sql`lower(${otpCodes.email}::text) = ${email}`, isNull(otpCodes.consumedAt)));
    await this.db.insert(otpCodes).values({
      id: randomUUID(),
      email,
      codeHash,
      expiresAt: new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000),
      attempts: 0,
      createdAt: now,
    });
    await this.mail.sendOtp(email, code);
    this.logger.log(`otp sent ${maskEmail(email)}`);
  }

  async verifyOtp(body: OtpVerifyDto): Promise<AuthResult> {
    const email = body.email.trim().toLowerCase();
    const active = await this.db
      .select()
      .from(otpCodes)
      .where(and(sql`lower(${otpCodes.email}::text) = ${email}`, isNull(otpCodes.consumedAt)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    const row = active[0];
    if (!row) {
      throw new ApiException('OTP_INVALID', 'The code is not valid', HttpStatus.BAD_REQUEST);
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new ApiException('OTP_EXPIRED', 'The code has expired', HttpStatus.BAD_REQUEST);
    }
    if (row.attempts >= 5) {
      throw new ApiException(
        'OTP_TOO_MANY_ATTEMPTS',
        'Too many attempts for this code',
        HttpStatus.BAD_REQUEST,
      );
    }
    const matches = await bcrypt.compare(body.code, row.codeHash);
    if (!matches) {
      await this.db
        .update(otpCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(otpCodes.id, row.id));
      throw new ApiException('OTP_INVALID', 'The code is not valid', HttpStatus.BAD_REQUEST);
    }
    await this.db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
    return this.signInWithIdentity({
      provider: 'email',
      subject: email,
      email,
      device: body.device,
    });
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return this.tokens.rotate(refreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokePresentedFamily(refreshToken);
  }

  private async signInWithIdentity(input: {
    provider: ProviderName;
    subject: string;
    email: string | null;
    device: z.infer<typeof DeviceSchema>;
    appleRefreshToken?: string | null;
  }): Promise<AuthResult> {
    const email = input.email?.trim().toLowerCase() || null;
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as Database;
      const existing = await db
        .select()
        .from(authIdentities)
        .where(and(eq(authIdentities.provider, input.provider), eq(authIdentities.subject, input.subject)))
        .limit(1);

      let userId: string;
      let isNewUser = false;

      if (existing[0]) {
        userId = existing[0].userId;
        if (input.appleRefreshToken) {
          await db
            .update(authIdentities)
            .set({ appleRefreshToken: input.appleRefreshToken, emailAtLink: email ?? existing[0].emailAtLink })
            .where(eq(authIdentities.id, existing[0].id));
        }
      } else {
        const linked = email ? await this.findUserByEmail(db, email) : undefined;
        if (linked) {
          userId = linked;
        } else {
          userId = randomUUID();
          isNewUser = true;
          await db.insert(users).values({
            id: userId,
            email,
            displayName: null,
            createdAt: new Date(),
          });
        }
        await db.insert(authIdentities).values({
          id: randomUUID(),
          userId,
          provider: input.provider,
          subject: input.subject,
          emailAtLink: email,
          appleRefreshToken: input.appleRefreshToken ?? null,
          createdAt: new Date(),
        });
      }

      const deviceId = await this.upsertDevice(db, userId, input.device);
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const accessToken = await this.tokens.signAccess(userId, deviceId);
      const refreshToken = await this.tokens.issueRefresh(db, userId, deviceId);
      return {
        accessToken,
        refreshToken,
        user: {
          id: userId,
          email: user[0]?.email ?? null,
          displayName: user[0]?.displayName ?? null,
        },
        device: { id: deviceId },
        isNewUser,
      };
    });
  }

  private async findUserByEmail(db: Database, email: string): Promise<string | undefined> {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}::text) = ${email}`)
      .limit(1);
    return found[0]?.id;
  }

  private async upsertDevice(
    db: Database,
    userId: string,
    device: z.infer<typeof DeviceSchema>,
  ): Promise<string> {
    const now = new Date();
    if (device.id) {
      const existing = await db.select().from(devices).where(eq(devices.id, device.id)).limit(1);
      if (existing[0]?.userId === userId) {
        await db
          .update(devices)
          .set({
            platform: device.platform,
            appVersion: device.appVersion,
            model: device.model ?? existing[0].model,
            lastSeenAt: now,
          })
          .where(eq(devices.id, device.id));
        return device.id;
      }
      if (!existing[0]) {
        await db.insert(devices).values({
          id: device.id,
          userId,
          platform: device.platform,
          appVersion: device.appVersion,
          model: device.model ?? null,
          lastSeenAt: now,
          createdAt: now,
        });
        return device.id;
      }
    }
    const id = randomUUID();
    await db.insert(devices).values({
      id,
      userId,
      platform: device.platform,
      appVersion: device.appVersion,
      model: device.model ?? null,
      lastSeenAt: now,
      createdAt: now,
    });
    return id;
  }
}
