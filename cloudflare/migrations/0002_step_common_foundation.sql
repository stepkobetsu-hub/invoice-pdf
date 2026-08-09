PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_modules (
  module_id TEXT PRIMARY KEY,
  module_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS managed_files (
  file_id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES system_modules(module_id),
  storage_binding TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  content_sha256 TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility = 'private'),
  created_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS access_tokens (
  access_token_id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES system_modules(module_id),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id TEXT PRIMARY KEY,
  module_id TEXT REFERENCES system_modules(module_id),
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  result TEXT NOT NULL,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_files_module ON managed_files(module_id, created_at);
CREATE INDEX IF NOT EXISTS idx_access_tokens_resource ON access_tokens(module_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(module_id, resource_type, resource_id, occurred_at);

INSERT OR IGNORE INTO system_modules(module_id, module_key, display_name, enabled, created_at, updated_at)
VALUES ('module-invoice', 'invoice', '請求書', 1, datetime('now'), datetime('now'));
