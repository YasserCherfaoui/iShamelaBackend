import { mapFirebaseExport, type FirebaseExport } from '../src/migrate/map-export';

const exportedAt = '2024-06-01T00:00:00.000Z';

function fixture(): FirebaseExport {
  return {
    exportedAt,
    users: [
      {
        uid: 'firebase-uid-1',
        email: 'Migrated@example.com',
        displayName: 'Migrated',
        providerData: [
          { providerId: 'apple.com', uid: 'apple-sub-1', email: 'Migrated@example.com' },
        ],
        progress: [{ id: '42', book_id: 42, page_id: 10, print_page: 12, updatedAt: 1_717_200_000_000 }],
        history: [
          {
            id: 'h1',
            book_id: 42,
            page_id: 3,
            print_page: 4,
            part: '1',
            section_title: 'Intro',
            opened_at: 1_717_200_000_000,
            closed_at: 1_717_200_090_000,
            updatedAt: 1_717_200_090_000,
          },
        ],
        bookmarks: [{ id: 'b1', book_id: 42, print_page: 8, label: 'mark', updatedAt: 1_717_200_000_000 }],
        notes: [
          {
            id: 'n1',
            book_id: 42,
            page_id: 9,
            note: 'hello',
            start_offset: 1,
            end_offset: 4,
            updatedAt: 1_717_200_000_000,
          },
        ],
        library: [
          {
            id: '7',
            title: 'Book',
            sizeBytes: 10,
            catalogVersion: 1,
            status: 'removed',
            installedAt: 1_717_200_000_000,
            updatedAt: 1_717_200_001_000,
          },
        ],
        highlights: [{ id: 'highlight-1', book_id: 42 }],
      },
    ],
  };
}

describe('mapFirebaseExport', () => {
  it('maps SPEC-027 columns and counts fields the schema does not store', () => {
    const { accounts, summary } = mapFirebaseExport(fixture());
    const account = accounts[0];
    expect(account?.email).toBe('migrated@example.com');
    expect(account?.identities).toEqual([
      { provider: 'apple', subject: 'apple-sub-1', emailAtLink: 'migrated@example.com' },
    ]);
    expect(account?.progress[0]).toMatchObject({ bookId: '42', page: 12 });
    expect(account?.history[0]).toMatchObject({ bookId: '42', page: 4, durationS: 90 });
    expect(account?.notes[0]).toMatchObject({ body: 'hello', page: 9 });
    expect(account?.bookshelf[0]).toMatchObject({ bookId: '7', removedEverywhere: true });
    expect(summary).toMatchObject({
      users: 1,
      identities: 1,
      progress: 1,
      history: 1,
      bookmarks: 1,
      notes: 1,
      bookshelf: 1,
      highlightsSkipped: 1,
      noteOffsetsDropped: 1,
      historyFieldsDropped: 1,
      libraryFieldsDropped: 1,
      rowsSkipped: 0,
    });
  });
});
