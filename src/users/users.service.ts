import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ApiException } from '../common/api.exception';
import type { AppleCredentials } from '../auth/apple-credentials';
import { AppleSigninCredentials } from '../auth/apple-credentials';
import { DRIZZLE, type Database } from '../db/database';
import {
  authIdentities,
  bookmarks,
  bookshelf,
  devices,
  notes,
  otpCodes,
  readingHistoryEvents,
  readingProgress,
  refreshTokens,
  users,
} from '../db/schema';

const PatchMeSchema = z.object({
  displayName: z.string().min(1).max(80),
});
export class PatchMeDto extends createZodDto(PatchMeSchema) {}

export type Profile = {
  id: string;
  email: string | null;
  displayName: string | null;
  devices: Array<{
    id: string;
    platform: string;
    appVersion: string;
    model: string | null;
    lastSeenAt: string;
  }>;
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AppleSigninCredentials) private readonly apple: AppleCredentials,
  ) {}

  async getMe(userId: string): Promise<Profile> {
    const user = await this.requireUser(userId);
    const deviceRows = await this.db.select().from(devices).where(eq(devices.userId, userId));
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      devices: deviceRows.map((device) => ({
        id: device.id,
        platform: device.platform,
        appVersion: device.appVersion,
        model: device.model,
        lastSeenAt: device.lastSeenAt.toISOString(),
      })),
    };
  }

  async patchMe(userId: string, displayName: string): Promise<Profile> {
    await this.db.update(users).set({ displayName }).where(eq(users.id, userId));
    return this.getMe(userId);
  }

  async deleteMe(userId: string): Promise<void> {
    const identities = await this.db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));
    const appleIdentity = identities.find(
      (identity) => identity.provider === 'apple' && identity.appleRefreshToken,
    );
    if (appleIdentity?.appleRefreshToken) {
      await this.apple.revokeRefreshToken(appleIdentity.appleRefreshToken);
    }
    const user = await this.requireUser(userId);
    await this.db.transaction(async (tx) => {
      const db = tx as unknown as Database;
      await db.delete(readingProgress).where(eq(readingProgress.userId, userId));
      await db.delete(readingHistoryEvents).where(eq(readingHistoryEvents.userId, userId));
      await db.delete(bookmarks).where(eq(bookmarks.userId, userId));
      await db.delete(notes).where(eq(notes.userId, userId));
      await db.delete(bookshelf).where(eq(bookshelf.userId, userId));
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await db.delete(devices).where(eq(devices.userId, userId));
      await db.delete(authIdentities).where(eq(authIdentities.userId, userId));
      if (user.email) {
        await db.delete(otpCodes).where(sql`lower(${otpCodes.email}::text) = ${user.email.toLowerCase()}`);
      }
      await db.delete(users).where(eq(users.id, userId));
    });
  }

  private async requireUser(userId: string) {
    const found = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = found[0];
    if (!user) {
      throw new ApiException('UNAUTHORIZED', 'Account is no longer available', HttpStatus.UNAUTHORIZED);
    }
    return user;
  }
}
