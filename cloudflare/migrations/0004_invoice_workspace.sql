-- Staff invoice workspace fields.  The partner fields are snapshots so an
-- already-issued invoice does not change when the partner master is edited.
ALTER TABLE invoices ADD COLUMN customer_code TEXT;
ALTER TABLE invoices ADD COLUMN partner_name TEXT;
ALTER TABLE invoices ADD COLUMN honorific TEXT NOT NULL DEFAULT '様';
ALTER TABLE invoices ADD COLUMN postal_code TEXT;
ALTER TABLE invoices ADD COLUMN prefecture TEXT;
ALTER TABLE invoices ADD COLUMN address1 TEXT;
ALTER TABLE invoices ADD COLUMN address2 TEXT;
ALTER TABLE invoices ADD COLUMN email TEXT;
ALTER TABLE invoices ADD COLUMN cc_email TEXT;
ALTER TABLE invoices ADD COLUMN memo TEXT;
ALTER TABLE invoices ADD COLUMN tags TEXT;
ALTER TABLE invoices ADD COLUMN payment_status TEXT NOT NULL DEFAULT '未入金'
  CHECK (payment_status IN ('未設定', '未入金', '入金済'));
ALTER TABLE invoices ADD COLUMN payment_date TEXT;
ALTER TABLE invoices ADD COLUMN payment_amount INTEGER;
ALTER TABLE invoices ADD COLUMN payment_memo TEXT;
ALTER TABLE invoices ADD COLUMN bank TEXT;
ALTER TABLE invoices ADD COLUMN note TEXT;
ALTER TABLE invoices ADD COLUMN deleted_at TEXT;
ALTER TABLE invoices ADD COLUMN created_by TEXT;
ALTER TABLE invoices ADD COLUMN updated_by TEXT;

UPDATE invoices
SET customer_code = COALESCE(customer_code, (SELECT customer_code FROM partners WHERE partners.partner_id = invoices.partner_id)),
    partner_name = COALESCE(partner_name, (SELECT name FROM partners WHERE partners.partner_id = invoices.partner_id)),
    honorific = COALESCE(honorific, (SELECT honorific FROM partners WHERE partners.partner_id = invoices.partner_id), '様'),
    postal_code = COALESCE(postal_code, (SELECT postal_code FROM partners WHERE partners.partner_id = invoices.partner_id)),
    prefecture = COALESCE(prefecture, (SELECT prefecture FROM partners WHERE partners.partner_id = invoices.partner_id)),
    address1 = COALESCE(address1, (SELECT address1 FROM partners WHERE partners.partner_id = invoices.partner_id)),
    address2 = COALESCE(address2, (SELECT address2 FROM partners WHERE partners.partner_id = invoices.partner_id)),
    email = COALESCE(email, (SELECT email FROM partners WHERE partners.partner_id = invoices.partner_id)),
    cc_email = COALESCE(cc_email, (SELECT cc_email FROM partners WHERE partners.partner_id = invoices.partner_id));

CREATE INDEX idx_invoices_workspace_list ON invoices(deleted_at, created_at DESC, invoice_number DESC);
CREATE INDEX idx_invoices_workspace_issue ON invoices(deleted_at, issue_date DESC);
CREATE INDEX idx_invoices_workspace_due ON invoices(deleted_at, due_date DESC);
CREATE INDEX idx_invoices_workspace_updated ON invoices(deleted_at, updated_at DESC);
