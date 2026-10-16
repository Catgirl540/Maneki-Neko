-- Owner-only bootstrap. Application session roles have no schema privileges.
CREATE SCHEMA IF NOT EXISTS ai_sessions;
REVOKE ALL ON SCHEMA ai_sessions FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ai_sessions.sessions (
  namespace TEXT NOT NULL CHECK(namespace IN ('customer','staff','ops')),
  id TEXT NOT NULL, owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 128),
  started BOOLEAN NOT NULL DEFAULT false, busy BOOLEAN NOT NULL DEFAULT false,
  interrupted BOOLEAN NOT NULL DEFAULT false,
  event_seq BIGINT NOT NULL DEFAULT 0 CHECK(event_seq BETWEEN 0 AND 9007199254740991),
  legacy_context_cipher TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS ai_sessions.events (
  namespace TEXT NOT NULL, session_id TEXT NOT NULL,
  seq BIGINT NOT NULL CHECK(seq BETWEEN 1 AND 9007199254740991),
  event_type TEXT NOT NULL CHECK(event_type <> 'card-secret'),
  body_cipher TEXT NOT NULL CHECK(body_cipher LIKE 'aesgcm:v1:%'), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(namespace,session_id,seq),
  FOREIGN KEY(namespace,session_id) REFERENCES ai_sessions.sessions(namespace,id)
);
CREATE TABLE IF NOT EXISTS ai_sessions.imports (
  namespace TEXT NOT NULL CHECK(namespace IN ('customer','staff','ops')),
  source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
  session_count BIGINT NOT NULL CHECK(session_count>=0), event_count BIGINT NOT NULL CHECK(event_count>=0),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(namespace,source_sha256)
);
CREATE OR REPLACE FUNCTION ai_sessions.protect_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.namespace IS DISTINCT FROM OLD.namespace OR NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.event_seq<OLD.event_seq THEN
    RAISE EXCEPTION 'session owner and monotonic event sequence are protected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS session_owner_guard ON ai_sessions.sessions;
CREATE TRIGGER session_owner_guard BEFORE UPDATE ON ai_sessions.sessions FOR EACH ROW EXECUTE FUNCTION ai_sessions.protect_owner();
CREATE OR REPLACE FUNCTION ai_sessions.immutable_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'session events and import evidence are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS session_event_immutable ON ai_sessions.events;
CREATE TRIGGER session_event_immutable BEFORE UPDATE OR DELETE ON ai_sessions.events FOR EACH ROW EXECUTE FUNCTION ai_sessions.immutable_event();
DROP TRIGGER IF EXISTS session_import_immutable ON ai_sessions.imports;
CREATE TRIGGER session_import_immutable BEFORE UPDATE OR DELETE ON ai_sessions.imports FOR EACH ROW EXECUTE FUNCTION ai_sessions.immutable_event();
REVOKE ALL ON ALL TABLES IN SCHEMA ai_sessions FROM PUBLIC;
