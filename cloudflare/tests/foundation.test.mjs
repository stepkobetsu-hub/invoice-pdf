import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashOpaqueToken, isOpaqueToken } from "../src/core/token.js";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const commonMigration = readFileSync(new URL("../migrations/0002_step_common_foundation.sql", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

assert.equal(config.name, "step-invoice-api");
assert.equal(config.vars.PRODUCTION_SEND_APPROVED, "false");
assert.equal(config.vars.TEST_SEND_APPROVED, "false");
assert.equal(config.workers_dev, true);
assert.equal(config.env.production.workers_dev, false);
assert.equal(config.r2_buckets[0].bucket_name, "step-invoice-pdfs");

for (const table of [
  "partners", "invoices", "invoice_items", "deliveries", "download_events",
  "email_templates", "settings", "users", "operation_logs", "send_queue",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE ${table}\\s*\\(`));
}

assert.match(source, /env\.PRODUCTION_SEND_APPROVED === "true"/);
assert.match(source, /env\.TEST_SEND_APPROVED === "true"/);
assert.match(source, /EMAIL_SEND_DISABLED/);
assert.doesNotMatch(source, /brevo|sendinblue|google\.com|drive\.google|script\.google/i);
assert.doesNotMatch(migration, /@gmail\.com|7132[678]|裏横地|表太田|星中山/);

for (const table of ["system_modules", "managed_files", "access_tokens", "audit_events"]) {
  assert.match(commonMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
}

const validToken = "a".repeat(43);
assert.equal(isOpaqueToken(validToken), true);
assert.equal(isOpaqueToken("short"), false);
assert.equal((await hashOpaqueToken(validToken)).length, 64);

console.log("Cloudflare foundation checks passed.");
