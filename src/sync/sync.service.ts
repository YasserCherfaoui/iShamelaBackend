import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ApiException } from '../common/api.exception';
import { clampClientTime, decideLww, parseClientTime } from '../common/lww';
import { DRIZZLE, type Database } from '../db/database';
import {
  bookmarks,
  bookshelf,
  notes,
  readingHistoryEvents,
  readingProgress,
} from '../db/schema';

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp');

const PullQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(500),
});
export class PullQueryDto extends createZodDto(PullQuerySchema) {}

const PushSchema = z.object({
  changes: z
    .array(
      z.object({
        table: z.string().min(1),
        record: z.record(z.string(), z.unknown()),
      }),
    )
    .max(500),
});
export class PushDto extends createZodDto(PushSchema) {}

export type SyncChange = {
  table: string;
  record: Record<string, unknown>;
};

export type PushResult = {
  applied: Array<{ table: string; key: string; server_seq: number }>;
  rejected: Array<{ table: string; key: string; reason: string }>;
  serverTime: string;
};

const SYNC_TABLES = [
  'reading_progress',
  'reading_history_events',
  'bookmarks',
  'notes',
  'bookshelf',
] as const;

type SyncTable = (typeof SYNC_TABLES)[number];

@Injectable()
export class SyncService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async pull(userId: string, since: number, limit: number): Promise<{
    changes: SyncChange[];
    nextCursor: number;
    hasMore: boolean;
  }> {
    const capped = Math.min(limit, 500);
    const result = await this.db.execute<{
      table_name: string;
      server_seq: string | number;
      record: Record<string, unknown>;
    }>(sql`
      select table_name, server_seq, record
      from (
        select 'reading_progress' as table_name, server_seq, to_jsonb(reading_progress) as record
        from reading_progress
        where user_id = ${userId} and server_seq > ${since}
        union all
        select 'reading_history_events', server_seq, to_jsonb(reading_history_events)
        from reading_history_events
        where user_id = ${userId} and server_seq > ${since}
        union all
        select 'bookmarks', server_seq, to_jsonb(bookmarks)
        from bookmarks
        where user_id = ${userId} and server_seq > ${since}
        union all
        select 'notes', server_seq, to_jsonb(notes)
        from notes
        where user_id = ${userId} and server_seq > ${since}
        union all
        select 'bookshelf', server_seq, to_jsonb(bookshelf)
        from bookshelf
        where user_id = ${userId} and server_seq > ${since}
      ) changes
      order by server_seq asc
      limit ${capped + 1}
    `);
    const rows = result.rows;
    const hasMore = rows.length > capped;
    const page = hasMore ? rows.slice(0, capped) : rows;
    const nextCursor =
      page.length === 0 ? since : Number(page[page.length - 1]?.server_seq ?? since);
    return {
      changes: page.map((row) => ({
        table: row.table_name,
        record: normalizeRecord(row.record),
      })),
      nextCursor,
      hasMore,
    };
  }

  async push(userId: string, deviceId: string, changes: PushDto['changes']): Promise<PushResult> {
    const serverTime = new Date();
    const applied: PushResult['applied'] = [];
    const rejected: PushResult['rejected'] = [];

    await this.db.transaction(async (tx) => {
      const db = tx as unknown as Database;
      for (const change of changes) {
        const key = recordKey(change.table, change.record);
        if (!isSyncTable(change.table)) {
          rejected.push({ table: change.table, key, reason: 'UNKNOWN_TABLE' });
          continue;
        }
        const outcome = await applyChange(db, change.table, change.record, {
          userId,
          deviceId,
          serverTime,
        });
        if (outcome.ok) {
          applied.push({ table: change.table, key: outcome.key, server_seq: outcome.serverSeq });
        } else {
          rejected.push({ table: change.table, key: outcome.key, reason: outcome.reason });
        }
      }
    });

    return { applied, rejected, serverTime: serverTime.toISOString() };
  }
}

function isSyncTable(table: string): table is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(table);
}

function recordKey(table: string, record: Record<string, unknown>): string {
  if (table === 'reading_progress' || table === 'bookshelf') {
    return typeof record.book_id === 'string' ? record.book_id : '';
  }
  return typeof record.id === 'string' ? record.id : '';
}

type ApplyContext = { userId: string; deviceId: string; serverTime: Date };

async function applyChange(
  db: Database,
  table: SyncTable,
  record: Record<string, unknown>,
  ctx: ApplyContext,
): Promise<
  | { ok: true; key: string; serverSeq: number }
  | { ok: false; key: string; reason: string }
> {
  if (table === 'reading_progress') return applyProgress(db, record, ctx);
  if (table === 'bookshelf') return applyBookshelf(db, record, ctx);
  if (table === 'reading_history_events') return applyHistory(db, record, ctx);
  if (table === 'bookmarks') return applyBookmark(db, record, ctx);
  return applyNote(db, record, ctx);
}

const ProgressRecord = z.object({
  book_id: z.string().min(1),
  page: z.number().int(),
  volume: z.number().int().nullable().optional(),
  scroll_offset: z.number().nullable().optional(),
  progress_at: timestamp,
  updated_at: timestamp.optional(),
  deleted_at: timestamp.nullable().optional(),
});

async function applyProgress(db: Database, record: Record<string, unknown>, ctx: ApplyContext) {
  const parsed = ProgressRecord.safeParse(record);
  if (!parsed.success) return { ok: false as const, key: recordKey('reading_progress', record), reason: 'INVALID' };
  const progressAt = clampClientTime(new Date(parsed.data.progress_at), ctx.serverTime);
  const updatedAt = clampClientTime(
    new Date(parsed.data.updated_at ?? parsed.data.progress_at),
    ctx.serverTime,
  );
  const deletedAt = optionalTime(parsed.data.deleted_at, ctx.serverTime);
  const existing = await db
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, ctx.userId), eq(readingProgress.bookId, parsed.data.book_id)))
    .limit(1);
  const decision = decideLww(progressAt, existing[0]?.progressAt ?? null);
  if (decision === 'stale') {
    return { ok: false as const, key: parsed.data.book_id, reason: 'STALE' };
  }
  if (decision === 'duplicate') {
    return { ok: true as const, key: parsed.data.book_id, serverSeq: existing[0]!.serverSeq };
  }
  const values = {
    userId: ctx.userId,
    bookId: parsed.data.book_id,
    page: parsed.data.page,
    volume: parsed.data.volume ?? null,
    scrollOffset: parsed.data.scroll_offset ?? null,
    progressAt,
    updatedAt,
    deletedAt,
    deviceId: ctx.deviceId,
    serverSeq: 0,
  };
  if (!existing[0]) {
    await db.insert(readingProgress).values(values);
  } else {
    await db
      .update(readingProgress)
      .set(values)
      .where(and(eq(readingProgress.userId, ctx.userId), eq(readingProgress.bookId, parsed.data.book_id)));
  }
  const stored = await db
    .select({ serverSeq: readingProgress.serverSeq })
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, ctx.userId), eq(readingProgress.bookId, parsed.data.book_id)))
    .limit(1);
  return { ok: true as const, key: parsed.data.book_id, serverSeq: stored[0]?.serverSeq ?? 0 };
}

const HistoryRecord = z.object({
  id: z.string().uuid(),
  book_id: z.string().min(1),
  page: z.number().int(),
  opened_at: timestamp,
  duration_s: z.number().int(),
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
});

async function applyHistory(db: Database, record: Record<string, unknown>, ctx: ApplyContext) {
  const parsed = HistoryRecord.safeParse(record);
  if (!parsed.success) return { ok: false as const, key: recordKey('reading_history_events', record), reason: 'INVALID' };
  const updatedAt = clampClientTime(new Date(parsed.data.updated_at), ctx.serverTime);
  const openedAt = clampClientTime(new Date(parsed.data.opened_at), ctx.serverTime);
  const deletedAt = optionalTime(parsed.data.deleted_at, ctx.serverTime);
  const existing = await db
    .select()
    .from(readingHistoryEvents)
    .where(and(eq(readingHistoryEvents.id, parsed.data.id), eq(readingHistoryEvents.userId, ctx.userId)))
    .limit(1);
  const decision = decideLww(updatedAt, existing[0]?.updatedAt ?? null);
  if (decision === 'stale') return { ok: false as const, key: parsed.data.id, reason: 'STALE' };
  if (decision === 'duplicate') {
    return { ok: true as const, key: parsed.data.id, serverSeq: existing[0]!.serverSeq };
  }
  const values = {
    id: parsed.data.id,
    userId: ctx.userId,
    bookId: parsed.data.book_id,
    page: parsed.data.page,
    openedAt,
    durationS: parsed.data.duration_s,
    updatedAt,
    deletedAt,
    deviceId: ctx.deviceId,
    serverSeq: 0,
  };
  if (!existing[0]) await db.insert(readingHistoryEvents).values(values);
  else {
    await db.update(readingHistoryEvents).set(values).where(eq(readingHistoryEvents.id, parsed.data.id));
  }
  const stored = await reloadSeq(db, 'reading_history_events', parsed.data.id, ctx.userId);
  return { ok: true as const, key: parsed.data.id, serverSeq: stored };
}

const BookmarkRecord = z.object({
  id: z.string().uuid(),
  book_id: z.string().min(1),
  page: z.number().int(),
  label: z.string().nullable().optional(),
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
});

async function applyBookmark(db: Database, record: Record<string, unknown>, ctx: ApplyContext) {
  const parsed = BookmarkRecord.safeParse(record);
  if (!parsed.success) return { ok: false as const, key: recordKey('bookmarks', record), reason: 'INVALID' };
  const updatedAt = clampClientTime(new Date(parsed.data.updated_at), ctx.serverTime);
  const deletedAt = optionalTime(parsed.data.deleted_at, ctx.serverTime);
  const existing = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.id, parsed.data.id), eq(bookmarks.userId, ctx.userId)))
    .limit(1);
  const decision = decideLww(updatedAt, existing[0]?.updatedAt ?? null);
  if (decision === 'stale') return { ok: false as const, key: parsed.data.id, reason: 'STALE' };
  if (decision === 'duplicate') {
    return { ok: true as const, key: parsed.data.id, serverSeq: existing[0]!.serverSeq };
  }
  const values = {
    id: parsed.data.id,
    userId: ctx.userId,
    bookId: parsed.data.book_id,
    page: parsed.data.page,
    label: parsed.data.label ?? null,
    updatedAt,
    deletedAt,
    deviceId: ctx.deviceId,
    serverSeq: 0,
  };
  if (!existing[0]) await db.insert(bookmarks).values(values);
  else await db.update(bookmarks).set(values).where(eq(bookmarks.id, parsed.data.id));
  return { ok: true as const, key: parsed.data.id, serverSeq: await reloadSeq(db, 'bookmarks', parsed.data.id, ctx.userId) };
}

const NoteRecord = z.object({
  id: z.string().uuid(),
  book_id: z.string().min(1),
  page: z.number().int(),
  body: z.string(),
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
});

async function applyNote(db: Database, record: Record<string, unknown>, ctx: ApplyContext) {
  const parsed = NoteRecord.safeParse(record);
  if (!parsed.success) return { ok: false as const, key: recordKey('notes', record), reason: 'INVALID' };
  const updatedAt = clampClientTime(new Date(parsed.data.updated_at), ctx.serverTime);
  const deletedAt = optionalTime(parsed.data.deleted_at, ctx.serverTime);
  const existing = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, parsed.data.id), eq(notes.userId, ctx.userId)))
    .limit(1);
  const decision = decideLww(updatedAt, existing[0]?.updatedAt ?? null);
  if (decision === 'stale') return { ok: false as const, key: parsed.data.id, reason: 'STALE' };
  if (decision === 'duplicate') {
    return { ok: true as const, key: parsed.data.id, serverSeq: existing[0]!.serverSeq };
  }
  const values = {
    id: parsed.data.id,
    userId: ctx.userId,
    bookId: parsed.data.book_id,
    page: parsed.data.page,
    body: parsed.data.body,
    updatedAt,
    deletedAt,
    deviceId: ctx.deviceId,
    serverSeq: 0,
  };
  if (!existing[0]) await db.insert(notes).values(values);
  else await db.update(notes).set(values).where(eq(notes.id, parsed.data.id));
  return { ok: true as const, key: parsed.data.id, serverSeq: await reloadSeq(db, 'notes', parsed.data.id, ctx.userId) };
}

const ShelfRecord = z.object({
  book_id: z.string().min(1),
  added_at: timestamp,
  removed_everywhere: z.boolean().optional(),
  updated_at: timestamp,
  deleted_at: timestamp.nullable().optional(),
});

async function applyBookshelf(db: Database, record: Record<string, unknown>, ctx: ApplyContext) {
  const parsed = ShelfRecord.safeParse(record);
  if (!parsed.success) return { ok: false as const, key: recordKey('bookshelf', record), reason: 'INVALID' };
  const updatedAt = clampClientTime(new Date(parsed.data.updated_at), ctx.serverTime);
  const addedAt = clampClientTime(new Date(parsed.data.added_at), ctx.serverTime);
  const deletedAt = optionalTime(parsed.data.deleted_at, ctx.serverTime);
  const existing = await db
    .select()
    .from(bookshelf)
    .where(and(eq(bookshelf.userId, ctx.userId), eq(bookshelf.bookId, parsed.data.book_id)))
    .limit(1);
  const decision = decideLww(updatedAt, existing[0]?.updatedAt ?? null);
  if (decision === 'stale') return { ok: false as const, key: parsed.data.book_id, reason: 'STALE' };
  if (decision === 'duplicate') {
    return { ok: true as const, key: parsed.data.book_id, serverSeq: existing[0]!.serverSeq };
  }
  const values = {
    userId: ctx.userId,
    bookId: parsed.data.book_id,
    addedAt,
    removedEverywhere: parsed.data.removed_everywhere ?? false,
    updatedAt,
    deletedAt,
    deviceId: ctx.deviceId,
    serverSeq: 0,
  };
  if (!existing[0]) await db.insert(bookshelf).values(values);
  else {
    await db
      .update(bookshelf)
      .set(values)
      .where(and(eq(bookshelf.userId, ctx.userId), eq(bookshelf.bookId, parsed.data.book_id)));
  }
  const stored = await db
    .select({ serverSeq: bookshelf.serverSeq })
    .from(bookshelf)
    .where(and(eq(bookshelf.userId, ctx.userId), eq(bookshelf.bookId, parsed.data.book_id)))
    .limit(1);
  return { ok: true as const, key: parsed.data.book_id, serverSeq: stored[0]?.serverSeq ?? 0 };
}

function optionalTime(value: string | null | undefined, serverTime: Date): Date | null {
  if (value == null) return null;
  const parsed = parseClientTime(value);
  if (!parsed) {
    throw new ApiException('VALIDATION_ERROR', 'Invalid timestamp', HttpStatus.BAD_REQUEST);
  }
  return clampClientTime(parsed, serverTime);
}

async function reloadSeq(db: Database, table: SyncTable, id: string, userId: string): Promise<number> {
  const result = await db.execute<{ server_seq: string | number }>(sql`
    select server_seq from ${sql.identifier(table)}
    where id = ${id} and user_id = ${userId}
  `);
  return Number(result.rows[0]?.server_seq ?? 0);
}

function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'server_seq' && (typeof value === 'string' || typeof value === 'number')) {
      next[key] = Number(value);
    } else {
      next[key] = value;
    }
  }
  return next;
}
