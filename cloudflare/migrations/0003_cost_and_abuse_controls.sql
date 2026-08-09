PRAGMA foreign_keys = ON;

ALTER TABLE deliveries ADD COLUMN download_day TEXT;
ALTER TABLE deliveries ADD COLUMN download_day_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS abuse_counters (
  counter_key TEXT PRIMARY KEY,
  time_bucket TEXT NOT NULL,
  category TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_alerts (
  alert_id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  metric_value REAL,
  threshold_value REAL,
  status TEXT NOT NULL DEFAULT 'open',
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_abuse_counters_expiry ON abuse_counters(expires_at);
CREATE INDEX IF NOT EXISTS idx_security_alerts_status ON security_alerts(status, last_detected_at);

INSERT OR REPLACE INTO settings(setting_key, setting_value, description, is_secret, updated_at) VALUES
  ('PUBLIC_DOWNLOAD_ENABLED', 'true', '保護者向けダウンロード有効', 0, datetime('now')),
  ('PDF_UPLOAD_ENABLED', 'false', 'PDF作成・アップロード有効', 0, datetime('now')),
  ('ADMIN_API_ENABLED', 'false', '管理API有効', 0, datetime('now')),
  ('EMERGENCY_STOP', 'false', '請求書配信緊急停止', 0, datetime('now')),
  ('PDF_DOWNLOAD_MAX_TOTAL', '20', '1トークンのPDF取得上限', 0, datetime('now')),
  ('PDF_DOWNLOAD_MAX_DAILY', '10', '1トークンの1日PDF取得上限', 0, datetime('now')),
  ('BULK_SEND_MAX', '100', '1回の一括送信上限', 0, datetime('now')),
  ('DAILY_SEND_MAX', '200', '1日送信上限', 0, datetime('now')),
  ('BUDGET_ALERT_IS_INFORMATIONAL_ONLY', 'true', '予算警告は利用を自動停止しない', 0, datetime('now'));
