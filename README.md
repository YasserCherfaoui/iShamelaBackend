# iShamela backend

Project-owned API for accounts and user-data sync (SPEC-027). Book content stays on Hugging Face; this service never serves it.

Node 22, NestJS 11, PostgreSQL 16, Drizzle. This machine may run a newer Node for local tests; Docker and CI pin 22.

## Local stack

```bash
cp .env.example .env
docker compose up
```

- API: http://localhost:3000
- Health: http://localhost:3000/health
- Mailpit (OTP inbox): http://localhost:8025

`POST /v1/auth/otp/request` with any email returns 204. The code is in Mailpit. In development, mail goes to Mailpit over SMTP. Production uses Resend.

Apple and Google sign-in need a real identity token from a dev build. Email OTP works with no third-party account.

## Tests

```bash
npm test
npm run test:e2e
```

End-to-end tests start Postgres 16 with Testcontainers and do not call Apple, Google, or Resend. Set `TEST_DATABASE_URL` to point them at an existing database instead of Docker.

## Firebase migration

Highlights are counted and skipped. Note anchors, history part/section, and library title/size/catalog version are not columns in SPEC-027 and are dropped.

```bash
# transform a JSON export (idempotent)
DATABASE_URL=postgres://ishamela:ishamela@localhost:5432/ishamela \
  npm run migrate:firebase -- --from export.json

# export from Firebase, optionally write the JSON, and apply
DATABASE_URL=... npm run migrate:firebase -- \
  --service-account ./firebase-service-account.json --out export.json --apply
```

The service-account file is gitignored. Do not commit it.

## Progress benchmark

`npm run bench:progress` measures the reading-progress upsert against `DATABASE_URL`. SPEC-027 targets server-side p95 under 50 ms at 100 requests/second. That number is not a CI gate.

## Not in this pass

Railway deploy, `api.ishamela.online`, SPF/DKIM for `ishamela.online`, the weekly `pg_dump`, and turning off Firebase are follow-ups after the app points at this API.

When those happen:

1. Railway project with a Dockerfile API service (root of this repo) and the Postgres plugin. Railway injects `DATABASE_URL`.
2. Set the variables from `.env.example` in Railway. Do not commit `.env`.
3. `railway.json` health check is `GET /health`.
4. Point `api.ishamela.online` at the service and add it to `CORS_ORIGINS`.
5. Verify the `ishamela.online` mail domain in Resend (SPF and DKIM).
6. Prefer the EU West region. Account deletion removes rows immediately; backups should be purged within 30 days.
7. After the app release that uses this API, disable Firebase Auth providers and delete the Firestore database. Cloud Messaging, Crashlytics, and Analytics stay in the client.
