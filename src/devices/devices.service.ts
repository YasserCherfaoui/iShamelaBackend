import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { unauthorized } from '../common/api.exception';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DRIZZLE, type Database } from '../db/database';
import { devices } from '../db/schema';

const RegisterDeviceSchema = z.object({
  pushToken: z.string().nullable().optional(),
  appVersion: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  model: z.string().nullable().optional(),
});
export class RegisterDeviceDto extends createZodDto(RegisterDeviceSchema) {}

@Injectable()
export class DevicesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** SPEC-032. Creates the local device row the first time a Firebase session uses it. */
  async ensure(userId: string, deviceId: string): Promise<void> {
    const existing = await this.db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    if (existing[0]) {
      if (existing[0].userId !== userId) {
        throw unauthorized('Device belongs to another account');
      }
      return;
    }
    const now = new Date();
    await this.db.insert(devices).values({
      id: deviceId,
      userId,
      platform: 'unknown',
      appVersion: '0',
      lastSeenAt: now,
      createdAt: now,
    });
  }

  async register(userId: string, deviceId: string, body: RegisterDeviceDto): Promise<{ id: string }> {
    const now = new Date();
    const patch: {
      lastSeenAt: Date;
      pushToken?: string | null;
      appVersion?: string;
      platform?: string;
      model?: string | null;
    } = { lastSeenAt: now };
    if (body.pushToken !== undefined) patch.pushToken = body.pushToken;
    if (body.appVersion !== undefined) patch.appVersion = body.appVersion;
    if (body.platform !== undefined) patch.platform = body.platform;
    if (body.model !== undefined) patch.model = body.model;
    await this.db
      .update(devices)
      .set(patch)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
    return { id: deviceId };
  }
}
