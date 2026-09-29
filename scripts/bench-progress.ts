import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { runMigrations } from '../src/db/migrate';
import * as schema from '../src/db/schema';
import { devices, readingProgress, users } from '../src/db/schema';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  await runMigrations(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  const userId = randomUUID();
  const deviceId = randomUUID();
  const now = new Date();
  await db.insert(users).values({ id: userId, email: null, displayName: null, createdAt: now });
  await db.insert(devices).values({
    id: deviceId,
    userId,
    platform: 'bench',
    appVersion: '0',
    lastSeenAt: now,
    createdAt: now,
  });

  const samples: number[] = [];
  const iterations = 200;
  for (let i = 0; i < iterations; i += 1) {
    const progressAt = new Date(now.getTime() + i);
    const started = performance.now();
    await db
      .insert(readingProgress)
      .values({
        userId,
        bookId: 'bench',
        page: i,
        progressAt,
        updatedAt: progressAt,
        deviceId,
        serverSeq: 0,
      })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.bookId],
        set: { page: i, progressAt, updatedAt: progressAt, deviceId },
        setWhere: sql`excluded.progress_at > reading_progress.progress_at`,
      });
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
  process.stdout.write(
    `${JSON.stringify({ iterations, p95Ms: Number(p95.toFixed(2)), targetMs: 50 })}\n`,
  );
  await pool.end();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'bench failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
