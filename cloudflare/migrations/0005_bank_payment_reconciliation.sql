-- Bank CSV payment reconciliation. Bank credentials are never stored.
-- Raw source text is retained for audit; account identifiers are stored only as hashes.
CREATE TABLE bank_import_batches (
  batch_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  account_identifier_hash TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  original_file_name TEXT,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(source_type, account_identifier_hash, file_sha256)
);

CREATE TABLE bank_transactions (
  bank_transaction_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_transaction_id TEXT,
  account_identifier_hash TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL UNIQUE,
  transaction_date TEXT NOT NULL,
  description_raw TEXT NOT NULL,
  payer_name_raw TEXT,
  payer_name_normalized TEXT,
  deposit_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  withdrawal_amount INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  reconciliation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending', 'candidate', 'matched', 'review', 'excluded')),
  excluded_reason TEXT,
  excluded_at TEXT,
  excluded_by TEXT,
  import_batch_id TEXT NOT NULL REFERENCES bank_import_batches(batch_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invoice_payment_matches (
  match_id TEXT PRIMARY KEY,
  bank_transaction_id TEXT NOT NULL REFERENCES bank_transactions(bank_transaction_id),
  invoice_id TEXT NOT NULL REFERENCES invoices(invoice_id),
  matched_amount INTEGER NOT NULL CHECK (matched_amount >= 0),
  match_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (match_status IN ('proposed', 'confirmed', 'cancelled', 'review')),
  confidence_level TEXT NOT NULL DEFAULT 'low' CHECK (confidence_level IN ('high', 'medium', 'low')),
  match_reasons_json TEXT NOT NULL DEFAULT '[]',
  match_method TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_payment_matches_active_transaction
  ON invoice_payment_matches(bank_transaction_id)
  WHERE match_status IN ('confirmed', 'review');
CREATE UNIQUE INDEX idx_payment_matches_active_invoice
  ON invoice_payment_matches(invoice_id)
  WHERE match_status = 'confirmed';

CREATE TABLE payer_aliases (
  alias_id TEXT PRIMARY KEY,
  payer_name_normalized TEXT NOT NULL,
  payer_name_raw TEXT NOT NULL,
  partner_id TEXT NOT NULL REFERENCES partners(partner_id),
  learned_from_match_id TEXT REFERENCES invoice_payment_matches(match_id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(payer_name_normalized, partner_id)
);

CREATE TABLE payment_match_audit_logs (
  audit_id TEXT PRIMARY KEY,
  bank_transaction_id TEXT REFERENCES bank_transactions(bank_transaction_id),
  invoice_id TEXT REFERENCES invoices(invoice_id),
  match_id TEXT REFERENCES invoice_payment_matches(match_id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_bank_transactions_queue
  ON bank_transactions(reconciliation_status, transaction_date DESC, created_at DESC);
CREATE INDEX idx_bank_transactions_payer
  ON bank_transactions(payer_name_normalized, deposit_amount, transaction_date DESC);
CREATE INDEX idx_payment_matches_invoice
  ON invoice_payment_matches(invoice_id, match_status, updated_at DESC);
CREATE INDEX idx_payer_aliases_lookup
  ON payer_aliases(payer_name_normalized, active);
CREATE INDEX idx_payment_audit_transaction
  ON payment_match_audit_logs(bank_transaction_id, occurred_at DESC);
