PRAGMA foreign_keys = ON;

CREATE TABLE partners (
  partner_id TEXT PRIMARY KEY,
  customer_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_kana TEXT,
  honorific TEXT NOT NULL DEFAULT '様',
  postal_code TEXT,
  prefecture TEXT,
  address1 TEXT,
  address2 TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  cc_email TEXT,
  delivery_suspended INTEGER NOT NULL DEFAULT 0 CHECK (delivery_suspended IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invoices (
  invoice_id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  partner_id TEXT NOT NULL REFERENCES partners(partner_id),
  subject_month TEXT,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  tax INTEGER NOT NULL CHECK (tax >= 0),
  total INTEGER NOT NULL CHECK (total >= 0 AND total = subtotal + tax),
  status TEXT NOT NULL DEFAULT 'draft',
  r2_object_key TEXT UNIQUE,
  pdf_sha256 TEXT,
  pdf_size INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invoice_items (
  item_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  service_date TEXT,
  description TEXT NOT NULL,
  unit_price INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0.10,
  UNIQUE(invoice_id, line_number)
);

CREATE TABLE deliveries (
  delivery_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(invoice_id),
  recipient_email TEXT NOT NULL,
  cc_email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  first_opened_at TEXT,
  last_opened_at TEXT,
  downloaded_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  resend_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE download_events (
  event_id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(delivery_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('open', 'download', 'rejected')),
  occurred_at TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'success',
  user_agent_present INTEGER NOT NULL DEFAULT 0 CHECK (user_agent_present IN (0, 1)),
  ip_stored INTEGER NOT NULL DEFAULT 0 CHECK (ip_stored = 0)
);

CREATE TABLE email_templates (
  template_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description TEXT,
  is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE operation_logs (
  log_id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(user_id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  result TEXT NOT NULL,
  detail_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE send_queue (
  queue_id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(delivery_id),
  send_type TEXT NOT NULL CHECK (send_type IN ('initial', 'resend', 'test')),
  status TEXT NOT NULL DEFAULT 'blocked',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_invoices_partner ON invoices(partner_id);
CREATE INDEX idx_deliveries_invoice ON deliveries(invoice_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_deliveries_expires ON deliveries(expires_at);
CREATE INDEX idx_download_events_delivery ON download_events(delivery_id, occurred_at);
CREATE INDEX idx_send_queue_status ON send_queue(status, available_at);
CREATE INDEX idx_operation_logs_target ON operation_logs(target_type, target_id, occurred_at);

INSERT INTO settings(setting_key, setting_value, description, is_secret, updated_at) VALUES
  ('PRODUCTION_SEND_APPROVED', 'false', '本番メール送信承認', 0, datetime('now')),
  ('TEST_SEND_APPROVED', 'false', 'テストメール送信承認', 0, datetime('now')),
  ('PARENT_LINK_TTL_DAYS', '60', '保護者向けURL有効日数', 0, datetime('now')),
  ('EMAIL_PROVIDER_CONFIGURED', 'false', 'メール送信事業者設定済みフラグ', 0, datetime('now'));
