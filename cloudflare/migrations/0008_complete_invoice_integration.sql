PRAGMA foreign_keys = ON;

-- Issue #27: keep invoice business data in D1. Existing tables are extended
-- instead of replaced so this migration is safe after a partial import.
ALTER TABLE partners ADD COLUMN payment_due_months INTEGER NOT NULL DEFAULT 1;
ALTER TABLE partners ADD COLUMN payment_due_day INTEGER;
ALTER TABLE partners ADD COLUMN weekend_policy TEXT;
ALTER TABLE partners ADD COLUMN department TEXT;
ALTER TABLE partners ADD COLUMN contact_title TEXT;
ALTER TABLE partners ADD COLUMN internal_owner TEXT;
ALTER TABLE partners ADD COLUMN peppol_id TEXT;
ALTER TABLE partners ADD COLUMN memo TEXT;
ALTER TABLE partners ADD COLUMN grade TEXT;
ALTER TABLE partners ADD COLUMN classroom TEXT;
ALTER TABLE partners ADD COLUMN deleted_at TEXT;

CREATE TABLE billing_adjustments (
  adjustment_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  subject_month TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  tax_rate REAL NOT NULL DEFAULT 0.10 CHECK (tax_rate >= 0),
  description TEXT NOT NULL,
  applied_invoice_id TEXT REFERENCES invoices(invoice_id),
  cancelled_at TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE receipts (
  receipt_id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  source_invoice_id TEXT REFERENCES invoices(invoice_id),
  partner_id TEXT NOT NULL REFERENCES partners(partner_id),
  customer_code TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  honorific TEXT NOT NULL DEFAULT '様',
  subject TEXT,
  issue_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL,
  total INTEGER NOT NULL,
  email TEXT,
  cc_email TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  r2_object_key TEXT UNIQUE,
  pdf_sha256 TEXT,
  pdf_size INTEGER,
  pdf_version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE receipt_items (
  item_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  description TEXT NOT NULL,
  unit_price INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0.10,
  UNIQUE(receipt_id, line_number)
);

CREATE TABLE delivery_jobs (
  job_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL CHECK (job_type IN ('initial','resend','test')),
  status TEXT NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked','queued','running','complete','partial','failed','cancelled')),
  total_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE delivery_job_items (
  job_item_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES delivery_jobs(job_id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(invoice_id),
  receipt_id TEXT REFERENCES receipts(receipt_id),
  recipient_email TEXT,
  status TEXT NOT NULL DEFAULT 'blocked',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((invoice_id IS NOT NULL) != (receipt_id IS NOT NULL)),
  UNIQUE(job_id, invoice_id, receipt_id)
);

CREATE TABLE delivery_events (
  event_id TEXT PRIMARY KEY,
  delivery_id TEXT REFERENCES deliveries(delivery_id),
  provider_message_id TEXT,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  signature_verified INTEGER NOT NULL DEFAULT 0 CHECK (signature_verified IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE migration_runs (
  migration_run_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('dry-run','import')),
  status TEXT NOT NULL CHECK (status IN ('running','complete','failed')),
  checkpoint TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  source_amount_total INTEGER NOT NULL DEFAULT 0,
  imported_amount_total INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  created_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX idx_adjustments_applied_once ON billing_adjustments(applied_invoice_id, adjustment_id) WHERE applied_invoice_id IS NOT NULL;
CREATE INDEX idx_adjustments_unapplied ON billing_adjustments(subject_month, customer_code, cancelled_at, applied_invoice_id);
CREATE INDEX idx_adjustments_updated ON billing_adjustments(updated_at DESC);
CREATE INDEX idx_partners_active ON partners(deleted_at, customer_code);
CREATE INDEX idx_invoices_month_partner ON invoices(subject_month, customer_code, deleted_at);
CREATE INDEX idx_invoices_payment_due ON invoices(payment_status, due_date, deleted_at);
CREATE INDEX idx_invoices_delivery_state ON invoices(updated_at DESC, deleted_at);
CREATE INDEX idx_receipts_partner ON receipts(partner_id, issue_date DESC, deleted_at);
CREATE INDEX idx_receipts_source_invoice ON receipts(source_invoice_id, deleted_at);
CREATE INDEX idx_delivery_jobs_status ON delivery_jobs(status, next_attempt_at, created_at);
CREATE INDEX idx_delivery_job_items_retry ON delivery_job_items(status, next_attempt_at);
CREATE INDEX idx_delivery_events_provider ON delivery_events(provider_message_id, occurred_at);
CREATE INDEX idx_migration_runs_source ON migration_runs(source_name, started_at DESC);

INSERT INTO settings(setting_key, setting_value, description, is_secret, updated_at) VALUES
  ('GOOGLE_COMPATIBILITY_MIRROR', 'true', '移行確認期間中のGoogle互換ミラー', 0, datetime('now')),
  ('INVOICE_D1_AUTHORITATIVE', 'true', '請求業務データの正本をD1とする', 0, datetime('now'))
ON CONFLICT(setting_key) DO UPDATE SET
  setting_value=excluded.setting_value,
  description=excluded.description,
  updated_at=excluded.updated_at;
