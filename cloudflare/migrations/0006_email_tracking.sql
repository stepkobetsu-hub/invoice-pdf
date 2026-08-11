ALTER TABLE deliveries ADD COLUMN provider_message_id TEXT;
ALTER TABLE deliveries ADD COLUMN email_status TEXT;
ALTER TABLE deliveries ADD COLUMN email_opened_at TEXT;
ALTER TABLE deliveries ADD COLUMN last_email_event_at TEXT;

CREATE INDEX idx_deliveries_provider_message ON deliveries(provider_message_id);
CREATE INDEX idx_deliveries_email_opened ON deliveries(email_opened_at);
