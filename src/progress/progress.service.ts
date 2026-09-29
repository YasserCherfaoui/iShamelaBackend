import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApiException } from '../common/api.exception';
import { clampClientTime } from '../common/lww';
import { DRIZZLE, type Database } from '../db/database';
import { devices, readingProgress } from '../db/schema';

const ProgressItemSchema = z.object({
  bookId: z.string().min(1),
  page: z.number().int(),
  volume: z.number().int().nullable().optional(),
  scrollOffset: z.number().nullable().optional(),
  progressAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp'),
  deviceId: z.string().uuid(),
});

const ProgressBodySchema = z.union([
  ProgressItemSchema,
  z.array(ProgressItemSchema).min(1).max(50),
]);

type ProgressItem = z.infer<typeof ProgressItemSchema>;

@Injectable()
export class ProgressService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async beacon(userId: string, fallbackDeviceId: string, body: unknown): Promise<void> {
    const parsed = ProgressBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiException('VALIDATION_ERROR', 'Request validation failed', HttpStatus.BAD_REQUEST);
    }
    const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const serverTime = new Date();
    await this.db.transaction(async (tx) => {
      const db = tx as unknown as Database;
      for (const item of items) {
        await writeBeacon(db, userId, await resolveDevice(db, userId, item.deviceId, fallbackDeviceId), item, serverTime);
      }
    });
  }
}

async function resolveDevice(
  db: Database,
  userId: string,
  deviceId: string,
  fallback: string,
): Promise<string> {
  const found = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .limit(1);
  return found[0]?.id ?? fallback;
}

async function writeBeacon(
  db: Database,
  userId: string,
  deviceId: string,
  item: ProgressItem,
  serverTime: Date,
): Promise<void> {
  const progressAt = clampClientTime(new Date(item.progressAt), serverTime);
  await db
    .insert(readingProgress)
    .values({
      userId,
      bookId: item.bookId,
      page: item.page,
      volume: item.volume ?? null,
      scrollOffset: item.scrollOffset ?? null,
      progressAt,
      updatedAt: progressAt,
      deviceId,
      serverSeq: 0,
    })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.bookId],
      set: {
        page: item.page,
        volume: item.volume ?? null,
        scrollOffset: item.scrollOffset ?? null,
        progressAt,
        updatedAt: progressAt,
        deletedAt: null,
        deviceId,
      },
      setWhere: sql`excluded.progress_at > reading_progress.progress_at`,
    });
}
