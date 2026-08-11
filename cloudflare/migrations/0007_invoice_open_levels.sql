-- Keep staff-side PDF downloads separate from recipient activity.
ALTER TABLE invoices ADD COLUMN app_downloaded_at TEXT;
