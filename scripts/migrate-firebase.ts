import { readFileSync, writeFileSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { runMigrations } from '../src/db/migrate';
import * as schema from '../src/db/schema';
import { importFirebaseExport } from '../src/migrate/import-export';
import type { FirebaseExport, FirebaseUserExport } from '../src/migrate/map-export';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const from = arg('--from');
  const serviceAccount = arg('--service-account');
  const out = arg('--out');
  if (!from && !serviceAccount) {
    throw new Error('Pass --from export.json and/or --service-account key.json');
  }

  let data: FirebaseExport;
  if (serviceAccount) {
    data = await exportFirebase(serviceAccount);
    if (out) writeFileSync(out, JSON.stringify(data, null, 2));
  } else {
    data = JSON.parse(readFileSync(from!, 'utf8')) as FirebaseExport;
  }

  if (from && !serviceAccount) {
    await apply(data);
    return;
  }
  if (serviceAccount && process.argv.includes('--apply')) {
    await apply(data);
    return;
  }
  if (!out && !process.argv.includes('--apply')) {
    process.stdout.write(`${JSON.stringify({ users: data.users.length })}\n`);
  }
}

async function apply(data: FirebaseExport): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  await runMigrations(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const db = drizzle(pool, { schema });
    const summary = await importFirebaseExport(db, data);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await pool.end();
  }
}

async function exportFirebase(serviceAccountPath: string): Promise<FirebaseExport> {
  const [{ cert, getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
    import('firebase-admin/firestore'),
  ]);
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as Parameters<
    typeof cert
  >[0];
  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  const auth = getAuth();
  const firestore = getFirestore();
  const users: FirebaseUserExport[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      const uid = user.uid;
      users.push({
        uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        providerData: user.providerData.map((provider) => ({
          providerId: provider.providerId,
          uid: provider.uid,
          email: provider.email ?? null,
        })),
        progress: await dumpCollection(firestore, uid, 'progress'),
        history: await dumpCollection(firestore, uid, 'history'),
        bookmarks: await dumpCollection(firestore, uid, 'bookmarks'),
        notes: await dumpCollection(firestore, uid, 'notes'),
        library: await dumpCollection(firestore, uid, 'library'),
        highlights: await dumpCollection(firestore, uid, 'highlights'),
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return { exportedAt: new Date().toISOString(), users };
}

async function dumpCollection(
  firestore: {
    collection: (path: string) => {
      doc: (id: string) => {
        collection: (name: string) => {
          get: () => Promise<{
            docs: Array<{ id: string; data: () => Record<string, unknown> }>;
          }>;
        };
      };
    };
  },
  uid: string,
  name: string,
): Promise<Array<Record<string, unknown>>> {
  const snap = await firestore.collection('users').doc(uid).collection(name).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...normalize(doc.data()) }));
}

function normalize(value: unknown): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!value || typeof value !== 'object') return output;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = normalizeValue(entry);
  }
  return output;
}

function normalizeValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'migration failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
