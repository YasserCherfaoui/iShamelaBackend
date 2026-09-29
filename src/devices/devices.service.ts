import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
