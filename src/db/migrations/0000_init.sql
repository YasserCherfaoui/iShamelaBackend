CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS sync_seq;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_server_seq()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.server_seq := nextval('sync_seq');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email citext UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE TABLE auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('apple', 'google', 'email')),
  subject text NOT NULL,
  email_at_link citext,
  apple_refresh_token text,
  created_at timestamptz NOT NULL,
  UNIQUE (provider, subject)
);
--> statement-breakpoint
CREATE TABLE otp_codes (
  id uuid PRIMARY KEY,
  email citext NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX otp_codes_email_created_idx ON otp_codes (email, created_at);
--> statement-breakpoint
CREATE TABLE devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform text NOT NULL,
  app_version text NOT NULL,
  model text,
  push_token text,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX devices_user_id_idx ON devices (user_id);
--> statement-breakpoint
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
--> statement-breakpoint
CREATE TABLE reading_progress (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id text NOT NULL,
  page integer NOT NULL,
  volume integer,
  scroll_offset real,
  progress_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  server_seq bigint NOT NULL,
  device_id uuid NOT NULL REFERENCES devices (id),
  PRIMARY KEY (user_id, book_id)
);
--> statement-breakpoint
CREATE INDEX reading_progress_user_seq_idx ON reading_progress (user_id, server_seq);
--> statement-breakpoint
CREATE TRIGGER reading_progress_set_server_seq
BEFORE INSERT OR UPDATE ON reading_progress
FOR EACH ROW EXECUTE FUNCTION set_server_seq();
--> statement-breakpoint
CREATE TABLE reading_history_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id text NOT NULL,
  page integer NOT NULL,
  opened_at timestamptz NOT NULL,
  duration_s integer NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  server_seq bigint NOT NULL,
  device_id uuid NOT NULL REFERENCES devices (id)
);
--> statement-breakpoint
CREATE INDEX reading_history_user_seq_idx ON reading_history_events (user_id, server_seq);
--> statement-breakpoint
CREATE INDEX reading_history_user_book_idx ON reading_history_events (user_id, book_id);
--> statement-breakpoint
CREATE TRIGGER reading_history_set_server_seq
BEFORE INSERT OR UPDATE ON reading_history_events
FOR EACH ROW EXECUTE FUNCTION set_server_seq();
--> statement-breakpoint
CREATE TABLE bookmarks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id text NOT NULL,
  page integer NOT NULL,
  label text,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  server_seq bigint NOT NULL,
  device_id uuid NOT NULL REFERENCES devices (id)
);
--> statement-breakpoint
CREATE INDEX bookmarks_user_seq_idx ON bookmarks (user_id, server_seq);
--> statement-breakpoint
CREATE INDEX bookmarks_user_book_idx ON bookmarks (user_id, book_id);
--> statement-breakpoint
CREATE TRIGGER bookmarks_set_server_seq
BEFORE INSERT OR UPDATE ON bookmarks
FOR EACH ROW EXECUTE FUNCTION set_server_seq();
--> statement-breakpoint
CREATE TABLE notes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id text NOT NULL,
  page integer NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  server_seq bigint NOT NULL,
  device_id uuid NOT NULL REFERENCES devices (id)
);
--> statement-breakpoint
CREATE INDEX notes_user_seq_idx ON notes (user_id, server_seq);
--> statement-breakpoint
CREATE INDEX notes_user_book_idx ON notes (user_id, book_id);
--> statement-breakpoint
CREATE TRIGGER notes_set_server_seq
BEFORE INSERT OR UPDATE ON notes
FOR EACH ROW EXECUTE FUNCTION set_server_seq();
--> statement-breakpoint
CREATE TABLE bookshelf (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id text NOT NULL,
  added_at timestamptz NOT NULL,
  removed_everywhere boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  server_seq bigint NOT NULL,
  device_id uuid NOT NULL REFERENCES devices (id),
  PRIMARY KEY (user_id, book_id)
);
--> statement-breakpoint
CREATE INDEX bookshelf_user_seq_idx ON bookshelf (user_id, server_seq);
--> statement-breakpoint
CREATE TRIGGER bookshelf_set_server_seq
BEFORE INSERT OR UPDATE ON bookshelf
FOR EACH ROW EXECUTE FUNCTION set_server_seq();
