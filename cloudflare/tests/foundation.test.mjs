import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

assert.equal(config.name, "step-invoice-api");
assert.equal(config.vars.PRODUCTION_SEND_APPROVED, "false");
assert.equal(config.vars.TEST_SEND_APPROVED, "false");
assert.equal(config.workers_dev, true);
assert.equal(config.env.production.workers_dev, false);

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

console.log("Cloudflare foundation checks passed.");
