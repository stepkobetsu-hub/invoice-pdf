import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0008_complete_invoice_integration.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../../assets/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

for (const table of ["billing_adjustments", "receipts", "receipt_items", "delivery_jobs", "delivery_job_items", "delivery_events", "migration_runs"]) {
  assert.match(migration, new RegExp(`CREATE TABLE ${table}\\b`), `${table} must be authoritative in D1`);
}
assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/);
assert.match(migration, /idx_adjustments_unapplied/);
assert.match(migration, /idx_invoices_payment_due/);
assert.match(migration, /GOOGLE_COMPATIBILITY_MIRROR/);
assert.match(source, /\/api\/app\/partners/);
assert.match(source, /\/api\/app\/settings/);
assert.match(source, /\/api\/app\/adjustments/);
assert.match(source, /\/api\/app\/migrations\/dry-run/);
assert.match(source, /isAdministrator\(auth\.user\)/);
assert.match(source, /wroteBusinessData: false/);
assert.match(app, /cloudApi\('\/api\/app\/partners'/);
assert.match(app, /cloudApi\('\/api\/app\/settings'/);
assert.match(html, /料金特別調整/);
assert.equal(config.vars.PRODUCTION_SEND_APPROVED, "false");
assert.equal(config.vars.TEST_SEND_APPROVED, "false");
assert.equal(config.d1_databases[0].database_name, "step-invoice-db");
assert.equal(config.r2_buckets[0].bucket_name, "step-invoice-pdfs");

console.log("Cloudflare complete integration checks passed.");
