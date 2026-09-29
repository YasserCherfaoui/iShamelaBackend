import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Database } from '../db/database';
import {
  authIdentities,
  bookmarks,
  bookshelf,
  devices,
  notes,
  readingHistoryEvents,
  readingProgress,
  users,
} from '../db/schema';
import {
  mapFirebaseExport,
  type FirebaseExport,
  type MappedAccount,
  type MigrationSummary,
} from './map-export';

export async function importFirebaseExport(db: Database, input: FirebaseExport): Promise<MigrationSummary> {
  const { accounts, summary } = mapFirebaseExport(input);
  for (const account of accounts) {
    await db.transaction(async (tx) => {
      await writeAccount(tx as unknown as Database, account);
    });
  }
  return summary;
}

async function writeAccount(db: Database, account: MappedAccount): Promise<void> {
  await db
    .insert(users)
    .values({
      id: account.userId,
      email: account.email,
      displayName: account.displayName,
      createdAt: account.createdAt,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: account.email,
        displayName: account.displayName,
      },
    });

  await db
    .insert(devices)
    .values({
      id: account.deviceId,
      userId: account.userId,
      platform: 'migration',
      appVersion: 'migrate-firebase',
      model: null,
      lastSeenAt: account.createdAt,
      createdAt: account.createdAt,
    })
    .onConflictDoNothing({ target: devices.id });

  for (const identity of account.identities) {
    await db
      .insert(authIdentities)
      .values({
        id: randomUUID(),
        userId: account.userId,
        provider: identity.provider,
        subject: identity.subject,
        emailAtLink: identity.emailAtLink,
        createdAt: account.createdAt,
      })
      .onConflictDoUpdate({
        target: [authIdentities.provider, authIdentities.subject],
        set: { emailAtLink: identity.emailAtLink },
      });
  }

  for (const row of account.progress) {
    await db
      .insert(readingProgress)
      .values({
        userId: account.userId,
        bookId: row.bookId,
        page: row.page,
        progressAt: row.progressAt,
        updatedAt: row.updatedAt,
        deviceId: account.deviceId,
        serverSeq: 0,
      })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.bookId],
        set: {
          page: row.page,
          progressAt: row.progressAt,
          updatedAt: row.updatedAt,
          deviceId: account.deviceId,
        },
      });
  }

  for (const row of account.history) {
    await db
      .insert(readingHistoryEvents)
      .values({
        id: row.id,
        userId: account.userId,
        bookId: row.bookId,
        page: row.page,
        openedAt: row.openedAt,
        durationS: row.durationS,
        updatedAt: row.updatedAt,
        deviceId: account.deviceId,
        serverSeq: 0,
      })
      .onConflictDoUpdate({
        target: readingHistoryEvents.id,
        set: {
          page: row.page,
          openedAt: row.openedAt,
          durationS: row.durationS,
          updatedAt: row.updatedAt,
          deviceId: account.deviceId,
        },
      });
  }

  for (const row of account.bookmarks) {
    await db
      .insert(bookmarks)
      .values({
        id: row.id,
        userId: account.userId,
        bookId: row.bookId,
        page: row.page,
        label: row.label,
        updatedAt: row.updatedAt,
        deviceId: account.deviceId,
        serverSeq: 0,
      })
      .onConflictDoUpdate({
        target: bookmarks.id,
        set: {
          page: row.page,
          label: row.label,
          updatedAt: row.updatedAt,
          deviceId: account.deviceId,
        },
      });
  }

  for (const row of account.notes) {
    await db
      .insert(notes)
      .values({
        id: row.id,
        userId: account.userId,
        bookId: row.bookId,
        page: row.page,
        body: row.body,
        updatedAt: row.updatedAt,
        deviceId: account.deviceId,
        serverSeq: 0,
      })
      .onConflictDoUpdate({
        target: notes.id,
        set: {
          page: row.page,
          body: row.body,
          updatedAt: row.updatedAt,
          deviceId: account.deviceId,
        },
      });
  }

  for (const row of account.bookshelf) {
    await db
      .insert(bookshelf)
      .values({
        userId: account.userId,
        bookId: row.bookId,
        addedAt: row.addedAt,
        removedEverywhere: row.removedEverywhere,
        updatedAt: row.updatedAt,
        deviceId: account.deviceId,
        serverSeq: 0,
      })
      .onConflictDoUpdate({
        target: [bookshelf.userId, bookshelf.bookId],
        set: {
          addedAt: row.addedAt,
          removedEverywhere: row.removedEverywhere,
          updatedAt: row.updatedAt,
          deviceId: account.deviceId,
        },
      });
  }
}

export async function countRowsForUser(db: Database, userId: string) {
  const [userRows, identityRows, progressRows, historyRows, bookmarkRows, noteRows, shelfRows] =
    await Promise.all([
      db.select().from(users).where(eq(users.id, userId)),
      db.select().from(authIdentities).where(eq(authIdentities.userId, userId)),
      db.select().from(readingProgress).where(eq(readingProgress.userId, userId)),
      db.select().from(readingHistoryEvents).where(eq(readingHistoryEvents.userId, userId)),
      db.select().from(bookmarks).where(eq(bookmarks.userId, userId)),
      db.select().from(notes).where(eq(notes.userId, userId)),
      db.select().from(bookshelf).where(eq(bookshelf.userId, userId)),
    ]);
  return {
    users: userRows.length,
    identities: identityRows.length,
    progress: progressRows.length,
    history: historyRows.length,
    bookmarks: bookmarkRows.length,
    notes: noteRows.length,
    bookshelf: shelfRows.length,
  };
}
