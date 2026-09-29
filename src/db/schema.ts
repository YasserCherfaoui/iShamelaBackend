import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: citext('email'),
  displayName: text('display_name'),
  createdAt: ts('created_at').notNull(),
  deletedAt: ts('deleted_at'),
});

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    emailAtLink: citext('email_at_link'),
    appleRefreshToken: text('apple_refresh_token'),
    createdAt: ts('created_at').notNull(),
  },
  (table) => [
    unique('auth_identities_provider_subject').on(table.provider, table.subject),
    check(
      'auth_identities_provider_check',
      sql`${table.provider} in ('apple', 'google', 'email')`,
    ),
  ],
);

export const otpCodes = pgTable('otp_codes', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: ts('consumed_at'),
  createdAt: ts('created_at').notNull(),
});

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    appVersion: text('app_version').notNull(),
    model: text('model'),
    pushToken: text('push_token'),
    lastSeenAt: ts('last_seen_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (table) => [index('devices_user_id_idx').on(table.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull(),
  },
  (table) => [index('refresh_tokens_family_idx').on(table.familyId)],
);

const envelope = {
  updatedAt: ts('updated_at').notNull(),
  deletedAt: ts('deleted_at'),
  serverSeq: bigint('server_seq', { mode: 'number' }).notNull(),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id),
};

export const readingProgress = pgTable(
  'reading_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: text('book_id').notNull(),
    page: integer('page').notNull(),
    volume: integer('volume'),
    scrollOffset: real('scroll_offset'),
    progressAt: ts('progress_at').notNull(),
    ...envelope,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.bookId] }),
    index('reading_progress_user_seq_idx').on(table.userId, table.serverSeq),
  ],
);

export const readingHistoryEvents = pgTable(
  'reading_history_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: text('book_id').notNull(),
    page: integer('page').notNull(),
    openedAt: ts('opened_at').notNull(),
    durationS: integer('duration_s').notNull(),
    ...envelope,
  },
  (table) => [
    index('reading_history_user_seq_idx').on(table.userId, table.serverSeq),
    index('reading_history_user_book_idx').on(table.userId, table.bookId),
  ],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: text('book_id').notNull(),
    page: integer('page').notNull(),
    label: text('label'),
    ...envelope,
  },
  (table) => [
    index('bookmarks_user_seq_idx').on(table.userId, table.serverSeq),
    index('bookmarks_user_book_idx').on(table.userId, table.bookId),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: text('book_id').notNull(),
    page: integer('page').notNull(),
    body: text('body').notNull(),
    ...envelope,
  },
  (table) => [
    index('notes_user_seq_idx').on(table.userId, table.serverSeq),
    index('notes_user_book_idx').on(table.userId, table.bookId),
  ],
);

export const bookshelf = pgTable(
  'bookshelf',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: text('book_id').notNull(),
    addedAt: ts('added_at').notNull(),
    removedEverywhere: boolean('removed_everywhere').notNull().default(false),
    ...envelope,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.bookId] }),
    index('bookshelf_user_seq_idx').on(table.userId, table.serverSeq),
  ],
);
