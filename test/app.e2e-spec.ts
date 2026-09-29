import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { configureApp } from '../src/main';
import { AppModule } from '../src/app.module';
import { ENV, type Env } from '../src/config/env';
import { DRIZZLE, type Database } from '../src/db/database';
import { runMigrations } from '../src/db/migrate';
import {
  authIdentities,
  bookmarks,
  devices,
  notes,
  readingProgress,
  refreshTokens,
  users,
} from '../src/db/schema';
import { AppleSigninCredentials } from '../src/auth/apple-credentials';
import { GoogleTokenVerifier } from '../src/auth/google.verifier';
import { APPLE_JWKS } from '../src/auth/token.service';
import { MAIL, InMemoryMailSender } from '../src/mail/mail.service';
import { countRowsForUser, importFirebaseExport } from '../src/migrate/import-export';
import type { FirebaseExport } from '../src/migrate/map-export';
import { uuidV5 } from '../src/migrate/uuid';

class FakeAppleCredentials {
  exchanged: string[] = [];
  revoked: string[] = [];

  async exchangeAuthorizationCode(code: string): Promise<string | null> {
    this.exchanged.push(code);
    return `refresh-${code}`;
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    this.revoked.push(refreshToken);
  }
}

class LocalGoogleVerifier {
  constructor(
    private readonly jwks: unknown,
    private readonly audiences: string[],
  ) {}

  async verify(idToken: string): Promise<{ sub: string; email: string | null }> {
    const { jwtVerify } = await import('jose');
    try {
      const { payload } = await jwtVerify(idToken, this.jwks as never, {
        issuer: 'https://accounts.google.com',
        audience: this.audiences,
      });
      if (!payload.sub) throw new Error('missing sub');
      return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
    } catch {
      const { tokenInvalid } = await import('../src/common/api.exception');
      throw tokenInvalid('Google ID token is invalid');
    }
  }
}

describe('SPEC-027 API', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication;
  let db: Database;
  let mail: InMemoryMailSender;
  let appleKeys: { privateKey: unknown; jwks: unknown };
  let googleKeys: { privateKey: unknown; jwks: unknown };
  const fakeApple = new FakeAppleCredentials();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    if (process.env.TEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    } else {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      process.env.DATABASE_URL = container.getConnectionUri();
    }
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.ACCESS_TOKEN_TTL = '15m';
    process.env.REFRESH_TOKEN_TTL = '60d';
    process.env.APPLE_CLIENT_IDS = 'online.ishamela.ios,online.ishamela.web';
    process.env.APPLE_TEAM_ID = 'TEAMID1234';
    process.env.APPLE_KEY_ID = 'KEYID12345';
    process.env.APPLE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_CLIENT_IDS = 'google-client-id';
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'iShamela <no-reply@ishamela.online>';
    process.env.OTP_TTL_SECONDS = '600';
    process.env.CORS_ORIGINS = 'http://localhost:3000';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.SKIP_MIGRATE = '1';
    await runMigrations(process.env.DATABASE_URL);

    const jose = await import('jose');
    appleKeys = await testJwks(jose, 'apple-key');
    googleKeys = await testJwks(jose, 'google-key');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APPLE_JWKS)
      .useValue(appleKeys.jwks)
      .overrideProvider(GoogleTokenVerifier)
      .useValue(new LocalGoogleVerifier(googleKeys.jwks, ['google-client-id']))
      .overrideProvider(AppleSigninCredentials)
      .useValue(fakeApple)
      .compile();

    const nest = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(nest, nest.get<Env>(ENV));
    await nest.init();
    app = nest;
    db = nest.get<Database>(DRIZZLE);
    mail = nest.get<InMemoryMailSender>(MAIL);
    await db.execute(sql`truncate table users, otp_codes cascade`);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('GET /health reports the database', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('rejects protected routes without a bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/v1/me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('completes email OTP for an unknown address and rejects bad codes', async () => {
    const email = 'new-reader@example.com';
    await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ email }).expect(204);
    const code = mail.latest(email);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ email, code: '000000', device: device() });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('OTP_INVALID');

    const ok = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ email, code, device: device() })
      .expect(201);
    expect(ok.body.isNewUser).toBe(true);
    expect(ok.body.user.email).toBe(email);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    expect(ok.body.device.id).toEqual(expect.any(String));
  });

  it('returns OTP_EXPIRED and OTP_TOO_MANY_ATTEMPTS', async () => {
    const expiredEmail = 'expired@example.com';
    await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ email: expiredEmail }).expect(204);
    await db.execute(
      sql`update otp_codes set expires_at = now() - interval '1 minute' where lower(email::text) = ${expiredEmail}`,
    );
    const expired = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ email: expiredEmail, code: mail.latest(expiredEmail), device: device() });
    expect(expired.body.error.code).toBe('OTP_EXPIRED');

    const limited = 'limited@example.com';
    await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ email: limited }).expect(204);
    const code = mail.latest(limited);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ email: limited, code: '111111', device: device() });
      expect(response.body.error.code).toBe('OTP_INVALID');
    }
    const blocked = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ email: limited, code, device: device() });
    expect(blocked.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('stops sending after three OTP requests for one email in 15 minutes', async () => {
    const email = 'throttle@example.com';
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ email }).expect(204);
    }
    expect(mail.sent.filter((row) => row.to === email)).toHaveLength(3);
    const verified = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ email, code: mail.latest(email), device: device() })
      .expect(201);
    expect(verified.body.user.email).toBe(email);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const session = await signIn('reuse@example.com');
    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(201);
    expect(rotated.body.refreshToken).not.toBe(session.refreshToken);

    const reuse = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('TOKEN_INVALID');

    const family = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken });
    expect(family.status).toBe(401);
  });

  it('logout revokes the refresh family', async () => {
    const session = await signIn('logout@example.com');
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(204);
    const again = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(again.status).toBe(401);
  });

  it('verifies Apple tokens against the test JWKS and links a matching email', async () => {
    const session = await signIn('linked@example.com');
    const identityToken = await signApple({
      sub: 'apple-sub-linked',
      email: 'linked@example.com',
      aud: 'online.ishamela.ios',
    });
    const linked = await request(app.getHttpServer())
      .post('/v1/auth/apple')
      .send({
        identityToken,
        authorizationCode: 'apple-code-linked',
        device: device('ios'),
      })
      .expect(201);
    expect(linked.body.isNewUser).toBe(false);
    expect(linked.body.user.id).toBe(session.userId);
    expect(fakeApple.exchanged).toContain('apple-code-linked');

    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, session.userId));
    expect(identities.map((row) => row.provider).sort()).toEqual(['apple', 'email']);

    const wrongAudience = await signApple({
      sub: 'other',
      email: 'other@example.com',
      aud: 'com.example.other',
    });
    const rejected = await request(app.getHttpServer())
      .post('/v1/auth/apple')
      .send({ identityToken: wrongAudience, device: device() });
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a Google token whose audience is not configured', async () => {
    const idToken = await signGoogle({
      sub: 'google-sub',
      email: 'google@example.com',
      aud: 'some-other-client',
    });
    const rejected = await request(app.getHttpServer())
      .post('/v1/auth/google')
      .send({ idToken, device: device('android') });
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe('TOKEN_INVALID');
  });

  it('deletes every row, revokes Apple, and the next sign-in is a new account', async () => {
    const identityToken = await signApple({
      sub: 'apple-delete-me',
      email: 'delete-me@example.com',
      aud: 'online.ishamela.ios',
    });
    const created = await request(app.getHttpServer())
      .post('/v1/auth/apple')
      .send({ identityToken, authorizationCode: 'delete-code', device: device() })
      .expect(201);
    const userId = created.body.user.id as string;
    await request(app.getHttpServer())
      .delete('/v1/me')
      .set('authorization', `Bearer ${created.body.accessToken}`)
      .expect(204);

    expect(fakeApple.revoked).toContain('refresh-delete-code');
    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(0);
    expect(await db.select().from(authIdentities).where(eq(authIdentities.userId, userId))).toHaveLength(0);
    expect(await db.select().from(devices).where(eq(devices.userId, userId))).toHaveLength(0);
    expect(await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))).toHaveLength(0);

    const againToken = await signApple({
      sub: 'apple-delete-me',
      email: 'delete-me@example.com',
      aud: 'online.ishamela.ios',
    });
    const again = await request(app.getHttpServer())
      .post('/v1/auth/apple')
      .send({ identityToken: againToken, device: device() })
      .expect(201);
    expect(again.body.isNewUser).toBe(true);
    expect(again.body.user.id).not.toBe(userId);
  });

  it('updates the profile and the signed-in device', async () => {
    const session = await signIn('profile@example.com');
    const patched = await request(app.getHttpServer())
      .patch('/v1/me')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({ displayName: 'Reader' })
      .expect(200);
    expect(patched.body.displayName).toBe('Reader');

    await request(app.getHttpServer())
      .post('/v1/devices/register')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({ pushToken: 'push-1', appVersion: '1.2.0' })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(me.body.devices[0].appVersion).toBe('1.2.0');
  });

  it('syncs deltas, tombstones, and last-writer-wins across two devices', async () => {
    const first = await signIn('sync@example.com', 'ios');
    const second = await signIn('sync@example.com', 'android');
    expect(second.userId).toBe(first.userId);
    expect(second.deviceId).not.toBe(first.deviceId);

    const t1 = '2024-01-01T00:00:00.000Z';
    const t2 = '2024-01-02T00:00:00.000Z';
    const noteId = randomUUID();
    const bookmarkA = randomUUID();
    const bookmarkB = randomUUID();

    const progress = await push(first.accessToken, [
      {
        table: 'reading_progress',
        record: { book_id: '10', page: 42, progress_at: t1, updated_at: t1 },
      },
    ]);
    expect(progress.body.applied).toHaveLength(1);

    const newer = await push(second.accessToken, [
      {
        table: 'reading_progress',
        record: { book_id: '10', page: 300, progress_at: t2, updated_at: t2 },
      },
    ]);
    expect(newer.body.applied).toHaveLength(1);

    const stale = await push(first.accessToken, [
      {
        table: 'reading_progress',
        record: { book_id: '10', page: 42, progress_at: t1, updated_at: t1 },
      },
    ]);
    expect(stale.body.rejected).toEqual([
      { table: 'reading_progress', key: '10', reason: 'STALE' },
    ]);

    const duplicate = await push(second.accessToken, [
      {
        table: 'reading_progress',
        record: { book_id: '10', page: 1, progress_at: t2, updated_at: t2 },
      },
    ]);
    expect(duplicate.body.applied[0].server_seq).toBe(newer.body.applied[0].server_seq);
    const stored = await db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.userId, first.userId));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.page).toBe(300);

    await push(first.accessToken, [
      { table: 'notes', record: { id: noteId, book_id: '10', page: 3, body: 'note', updated_at: t1 } },
      {
        table: 'bookmarks',
        record: { id: bookmarkA, book_id: '10', page: 1, label: 'a', updated_at: t1 },
      },
      {
        table: 'bookmarks',
        record: { id: bookmarkB, book_id: '10', page: 2, label: 'b', updated_at: t1 },
      },
    ]);
    await push(first.accessToken, [
      {
        table: 'notes',
        record: { id: noteId, book_id: '10', page: 3, body: 'note', updated_at: t2, deleted_at: t2 },
      },
    ]);

    const page = await request(app.getHttpServer())
      .get('/v1/sync/pull')
      .query({ since: 0, limit: 2 })
      .set('authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    expect(page.body.hasMore).toBe(true);
    expect(page.body.changes).toHaveLength(2);

    const rest = await request(app.getHttpServer())
      .get('/v1/sync/pull')
      .query({ since: page.body.nextCursor, limit: 50 })
      .set('authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    expect(rest.body.hasMore).toBe(false);
    const tombstone = [...page.body.changes, ...rest.body.changes].find(
      (change: { table: string; record: { id?: string } }) =>
        change.table === 'notes' && change.record.id === noteId,
    );
    expect(tombstone.record.deleted_at).toEqual(expect.any(String));

    const cursor = rest.body.nextCursor as number;
    const quiet = await request(app.getHttpServer())
      .get('/v1/sync/pull')
      .query({ since: cursor })
      .set('authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    expect(quiet.body.changes).toEqual([]);

    const freshId = randomUUID();
    await push(first.accessToken, [
      {
        table: 'bookmarks',
        record: { id: freshId, book_id: '11', page: 4, label: 'new', updated_at: t2 },
      },
    ]);
    const delta = await request(app.getHttpServer())
      .get('/v1/sync/pull')
      .query({ since: cursor })
      .set('authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    expect(delta.body.changes.map((change: { record: { id?: string } }) => change.record.id)).toContain(
      freshId,
    );
  });

  it('clamps a far-future client timestamp to server time', async () => {
    const session = await signIn('clock@example.com');
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const id = randomUUID();
    await push(session.accessToken, [
      { table: 'bookmarks', record: { id, book_id: '1', page: 1, updated_at: future } },
    ]);
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id));
    expect(row[0]?.updatedAt.getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it('does not move progress backward through the beacon', async () => {
    const session = await signIn('beacon@example.com');
    const later = new Date().toISOString();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    await request(app.getHttpServer())
      .post('/v1/progress')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({
        bookId: '99',
        page: 42,
        progressAt: later,
        deviceId: session.deviceId,
      })
      .expect(204);
    await request(app.getHttpServer())
      .post('/v1/progress')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send([
        {
          bookId: '99',
          page: 7,
          progressAt: earlier,
          deviceId: session.deviceId,
        },
      ])
      .expect(204);
    const rows = await db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.userId, session.userId));
    expect(rows.find((row) => row.bookId === '99')?.page).toBe(42);

    const tooMany = await request(app.getHttpServer())
      .post('/v1/progress')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send(
        Array.from({ length: 51 }, (_, index) => ({
          bookId: `x${index}`,
          page: 1,
          progressAt: later,
          deviceId: session.deviceId,
        })),
      );
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a push larger than 500 changes', async () => {
    const session = await signIn('bulk@example.com');
    const changes = Array.from({ length: 501 }, () => ({
      table: 'bookmarks',
      record: { id: randomUUID(), book_id: '1', page: 1, updated_at: '2024-01-01T00:00:00.000Z' },
    }));
    const response = await request(app.getHttpServer())
      .post('/v1/sync/push')
      .set('authorization', `Bearer ${session.accessToken}`)
      .send({ changes });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('imports a Firebase export twice without duplicating rows', async () => {
    const exportedAt = '2024-06-01T00:00:00.000Z';
    const data: FirebaseExport = {
      exportedAt,
      users: [
        {
          uid: 'firebase-uid-1',
          email: 'migrated@example.com',
          displayName: 'Migrated',
          providerData: [
            { providerId: 'google.com', uid: 'google-sub-mig', email: 'migrated@example.com' },
          ],
          progress: [{ id: '42', book_id: 42, print_page: 12, updatedAt: 1_717_200_000_000 }],
          history: [],
          bookmarks: [],
          notes: [
            {
              id: 'n1',
              book_id: 42,
              page_id: 9,
              note: 'hello',
              start_offset: 1,
              end_offset: 2,
              updatedAt: 1_717_200_000_000,
            },
          ],
          library: [{ id: '7', title: 'Book', status: 'installed', installedAt: 1_717_200_000_000, updatedAt: 1_717_200_000_000 }],
          highlights: [{ id: 'h' }],
        },
      ],
    };
    const first = await importFirebaseExport(db, data);
    const second = await importFirebaseExport(db, data);
    expect(second).toEqual(first);
    expect(first.highlightsSkipped).toBe(1);
    expect(first.noteOffsetsDropped).toBe(1);
    const counts = await countRowsForUser(db, uuidV5('user:firebase-uid-1'));
    expect(counts).toEqual({
      users: 1,
      identities: 1,
      progress: 1,
      history: 0,
      bookmarks: 0,
      notes: 1,
      bookshelf: 1,
    });
    const note = await db.select().from(notes).where(eq(notes.userId, uuidV5('user:firebase-uid-1')));
    expect(note[0]?.body).toBe('hello');
  });

  async function signIn(email: string, platform = 'ios') {
    await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ email }).expect(204);
    const response = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ email, code: mail.latest(email), device: device(platform) })
      .expect(201);
    return {
      accessToken: response.body.accessToken as string,
      refreshToken: response.body.refreshToken as string,
      userId: response.body.user.id as string,
      deviceId: response.body.device.id as string,
    };
  }

  async function push(accessToken: string, changes: unknown[]) {
    return request(app.getHttpServer())
      .post('/v1/sync/push')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ changes });
  }

  async function signApple(claims: { sub: string; email: string; aud: string }) {
    const { SignJWT } = await import('jose');
    return new SignJWT({ email: claims.email })
      .setProtectedHeader({ alg: 'ES256', kid: 'apple-key' })
      .setIssuer('https://appleid.apple.com')
      .setAudience(claims.aud)
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(appleKeys.privateKey as never);
  }

  async function signGoogle(claims: { sub: string; email: string; aud: string }) {
    const { SignJWT } = await import('jose');
    return new SignJWT({ email: claims.email })
      .setProtectedHeader({ alg: 'ES256', kid: 'google-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience(claims.aud)
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(googleKeys.privateKey as never);
  }
});

function device(platform = 'ios') {
  return { platform, appVersion: '1.0.0', model: 'test' };
}

async function testJwks(jose: typeof import('jose'), kid: string) {
  const { publicKey, privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  return { privateKey, jwks: jose.createLocalJWKSet({ keys: [jwk] }) };
}
