-- One-time handoff from the billing system to the invoice PDF application.
-- CSV content is intentionally kept as-is and expires quickly.
CREATE TABLE invoice_transfers (
  transfer_id TEXT PRIMARY KEY,
  billing_period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  csv_text TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX idx_invoice_transfers_expiry
  ON invoice_transfers(expires_at, consumed_at);
