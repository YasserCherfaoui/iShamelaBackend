import { uuidV5 } from './uuid';

export type FirebaseProvider = {
  providerId: string;
  uid: string;
  email: string | null;
};

export type FirebaseUserExport = {
  uid: string;
  email: string | null;
  displayName: string | null;
  providerData: FirebaseProvider[];
  progress: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  bookmarks: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  library: Array<Record<string, unknown>>;
  highlights?: Array<Record<string, unknown>>;
};

export type FirebaseExport = {
  exportedAt: string;
  users: FirebaseUserExport[];
};

export type MigrationSummary = {
  users: number;
  identities: number;
  progress: number;
  history: number;
  bookmarks: number;
  notes: number;
  bookshelf: number;
  highlightsSkipped: number;
  noteOffsetsDropped: number;
  historyFieldsDropped: number;
  libraryFieldsDropped: number;
  rowsSkipped: number;
};

export type MappedIdentity = {
  provider: 'apple' | 'google' | 'email';
  subject: string;
  emailAtLink: string | null;
};

export type MappedProgress = {
  bookId: string;
  page: number;
  progressAt: Date;
  updatedAt: Date;
};

export type MappedHistory = {
  id: string;
  bookId: string;
  page: number;
  openedAt: Date;
  durationS: number;
  updatedAt: Date;
};

export type MappedBookmark = {
  id: string;
  bookId: string;
  page: number;
  label: string | null;
  updatedAt: Date;
};

export type MappedNote = {
  id: string;
  bookId: string;
  page: number;
  body: string;
  updatedAt: Date;
};

export type MappedShelf = {
  bookId: string;
  addedAt: Date;
  removedEverywhere: boolean;
  updatedAt: Date;
};

export type MappedAccount = {
  userId: string;
  deviceId: string;
  email: string | null;
  displayName: string | null;
  createdAt: Date;
  identities: MappedIdentity[];
  progress: MappedProgress[];
  history: MappedHistory[];
  bookmarks: MappedBookmark[];
  notes: MappedNote[];
  bookshelf: MappedShelf[];
};

export function emptySummary(): MigrationSummary {
  return {
    users: 0,
    identities: 0,
    progress: 0,
    history: 0,
    bookmarks: 0,
    notes: 0,
    bookshelf: 0,
    highlightsSkipped: 0,
    noteOffsetsDropped: 0,
    historyFieldsDropped: 0,
    libraryFieldsDropped: 0,
    rowsSkipped: 0,
  };
}

export function mapFirebaseExport(input: FirebaseExport): {
  accounts: MappedAccount[];
  summary: MigrationSummary;
} {
  const summary = emptySummary();
  const fallback = parseTime(input.exportedAt) ?? new Date();
  const accounts: MappedAccount[] = [];

  for (const user of input.users) {
    const identities = mapIdentities(user);
    if (identities.length === 0) {
      summary.rowsSkipped += 1;
      summary.highlightsSkipped += user.highlights?.length ?? 0;
      continue;
    }
    summary.highlightsSkipped += user.highlights?.length ?? 0;
    const account: MappedAccount = {
      userId: uuidV5(`user:${user.uid}`),
      deviceId: uuidV5(`device:${user.uid}`),
      email: user.email?.trim().toLowerCase() || identities.find((item) => item.emailAtLink)?.emailAtLink || null,
      displayName: user.displayName,
      createdAt: fallback,
      identities,
      progress: [],
      history: [],
      bookmarks: [],
      notes: [],
      bookshelf: [],
    };
    summary.users += 1;
    summary.identities += identities.length;

    for (const doc of user.progress) {
      const mapped = mapProgress(doc, fallback);
      if (!mapped) {
        summary.rowsSkipped += 1;
        continue;
      }
      account.progress.push(mapped);
      summary.progress += 1;
    }
    for (const doc of user.history) {
      if ('part' in doc || 'section_title' in doc) summary.historyFieldsDropped += 1;
      const mapped = mapHistory(user.uid, doc, fallback);
      if (!mapped) {
        summary.rowsSkipped += 1;
        continue;
      }
      account.history.push(mapped);
      summary.history += 1;
    }
    for (const doc of user.bookmarks) {
      const mapped = mapBookmark(user.uid, doc, fallback);
      if (!mapped) {
        summary.rowsSkipped += 1;
        continue;
      }
      account.bookmarks.push(mapped);
      summary.bookmarks += 1;
    }
    for (const doc of user.notes) {
      if ('start_offset' in doc || 'end_offset' in doc) summary.noteOffsetsDropped += 1;
      const mapped = mapNote(user.uid, doc, fallback);
      if (!mapped) {
        summary.rowsSkipped += 1;
        continue;
      }
      account.notes.push(mapped);
      summary.notes += 1;
    }
    for (const doc of user.library) {
      if ('title' in doc || 'sizeBytes' in doc || 'catalogVersion' in doc) {
        summary.libraryFieldsDropped += 1;
      }
      const mapped = mapShelf(doc, fallback);
      if (!mapped) {
        summary.rowsSkipped += 1;
        continue;
      }
      account.bookshelf.push(mapped);
      summary.bookshelf += 1;
    }
    accounts.push(account);
  }

  return { accounts, summary };
}

function mapIdentities(user: FirebaseUserExport): MappedIdentity[] {
  const identities: MappedIdentity[] = [];
  for (const provider of user.providerData) {
    const mapped = mapProvider(provider);
    if (mapped) identities.push(mapped);
  }
  if (identities.length === 0 && user.email) {
    identities.push({
      provider: 'email',
      subject: user.email.trim().toLowerCase(),
      emailAtLink: user.email.trim().toLowerCase(),
    });
  }
  return identities;
}

function mapProvider(provider: FirebaseProvider): MappedIdentity | null {
  const email = provider.email?.trim().toLowerCase() || null;
  if (provider.providerId === 'apple.com') {
    return { provider: 'apple', subject: provider.uid, emailAtLink: email };
  }
  if (provider.providerId === 'google.com') {
    return { provider: 'google', subject: provider.uid, emailAtLink: email };
  }
  if (provider.providerId === 'password' || provider.providerId === 'email') {
    const subject = email ?? provider.uid.trim().toLowerCase();
    return { provider: 'email', subject, emailAtLink: email };
  }
  return null;
}

function mapProgress(doc: Record<string, unknown>, fallback: Date): MappedProgress | null {
  const bookId = bookIdOf(doc);
  const page = pageOf(doc);
  if (!bookId || page == null) return null;
  const progressAt = timeOf(doc.updatedAt, fallback);
  return { bookId, page, progressAt, updatedAt: progressAt };
}

function mapHistory(uid: string, doc: Record<string, unknown>, fallback: Date): MappedHistory | null {
  const bookId = bookIdOf(doc);
  const page = pageOf(doc);
  const opened = asInt(doc.opened_at);
  if (!bookId || page == null || opened == null) return null;
  return {
    id: uuidV5(`history:${uid}:${docId(doc)}`),
    bookId,
    page,
    openedAt: new Date(opened),
    durationS: durationOf(doc),
    updatedAt: timeOf(doc.updatedAt, fallback),
  };
}

function mapBookmark(uid: string, doc: Record<string, unknown>, fallback: Date): MappedBookmark | null {
  const bookId = bookIdOf(doc);
  const page = pageOf(doc);
  if (!bookId || page == null) return null;
  const label = typeof doc.label === 'string' ? doc.label : null;
  return {
    id: uuidV5(`bookmark:${uid}:${docId(doc)}`),
    bookId,
    page,
    label,
    updatedAt: timeOf(doc.updatedAt, fallback),
  };
}

function mapNote(uid: string, doc: Record<string, unknown>, fallback: Date): MappedNote | null {
  const bookId = bookIdOf(doc);
  const page = pageOf(doc);
  const body = typeof doc.note === 'string' ? doc.note : typeof doc.body === 'string' ? doc.body : null;
  if (!bookId || page == null || body == null) return null;
  return {
    id: uuidV5(`note:${uid}:${docId(doc)}`),
    bookId,
    page,
    body,
    updatedAt: timeOf(doc.updatedAt, fallback),
  };
}

function mapShelf(doc: Record<string, unknown>, fallback: Date): MappedShelf | null {
  const bookId = bookIdOf(doc);
  if (!bookId) return null;
  return {
    bookId,
    addedAt: timeOf(doc.installedAt ?? doc.updatedAt, fallback),
    removedEverywhere: doc.status === 'removed',
    updatedAt: timeOf(doc.updatedAt, fallback),
  };
}

function bookIdOf(doc: Record<string, unknown>): string | null {
  if (doc.book_id != null && `${doc.book_id}`.length > 0) return String(doc.book_id);
  const id = docId(doc);
  return id.length > 0 ? id : null;
}

function pageOf(doc: Record<string, unknown>): number | null {
  return asInt(doc.print_page) ?? asInt(doc.page_id) ?? asInt(doc.page);
}

function durationOf(doc: Record<string, unknown>): number {
  const explicit = asInt(doc.duration_seconds) ?? asInt(doc.duration_s);
  if (explicit != null) return Math.max(0, explicit);
  const opened = asInt(doc.opened_at);
  const closed = asInt(doc.closed_at);
  if (opened != null && closed != null) return Math.max(0, Math.round((closed - opened) / 1000));
  return 0;
}

function timeOf(value: unknown, fallback: Date): Date {
  return parseTime(value) ?? fallback;
}

function parseTime(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return new Date(Number(value));
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function docId(doc: Record<string, unknown>): string {
  return doc.id == null ? '' : String(doc.id);
}
