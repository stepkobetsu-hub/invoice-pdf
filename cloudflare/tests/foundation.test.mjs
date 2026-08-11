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
assert.equal(config.r2_buckets[0].bucket_name, "step-invoice-pdfs");
assert.equal(config.d1_databases[0].binding, "DB");
assert.equal(config.d1_databases[0].database_name, "step-invoice-db");
assert.match(config.d1_databases[0].database_id, /^[0-9a-f-]{36}$/);
assert.equal(config.vars.PUBLIC_DOWNLOAD_ENABLED, "true");
assert.equal(config.vars.PDF_UPLOAD_ENABLED, "true");
assert.equal(config.vars.ADMIN_API_ENABLED, "true");
assert.equal(config.vars.EMERGENCY_STOP, "false");
assert.equal(config.vars.PARENT_LINK_TTL_DAYS, "180");
assert.equal(config.ratelimits.length, 4);

for (const table of [
  "partners", "invoices", "invoice_items", "deliveries", "download_events",
  "email_templates", "settings", "users", "operation_logs", "send_queue",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE ${table}\\s*\\(`));
}

assert.match(source, /env\.PRODUCTION_SEND_APPROVED !== "true"/);
assert.match(source, /env\.TEST_SEND_APPROVED !== "true"/);
assert.match(source, /EMAIL_SEND_DISABLED/);
assert.match(source, /env\.PDFS\.put/);
assert.match(source, /\/api\/admin\/deliveries/);
assert.match(source, /\/api\/admin\/deliveries\/batch/);
assert.match(source, /async function createDeliveryBatch/);
assert.match(source, /env\.DB\.batch\(statements\)/);
assert.match(source, /const statements = prepared\.map/);
assert.match(source, /json_each\(\?2\)[\s\S]*json_each\(\?3\)/);
assert.match(source, /items\.slice\(0, 100\)/);
assert.doesNotMatch(source, /brevo|sendinblue|google\.com|drive\.google|script\.google/i);
assert.doesNotMatch(migration, /@gmail\.com|7132[678]|裏横地|表太田|星中山/);
assert.match(source, /ご請求金額/);
assert.match(source, /label=isReceipt\?"領収書":"請求書"/);
assert.match(source, /<dt>お支払期限<\/dt>/);
assert.match(source, /ダウンロード期限：/);
assert.match(source, /font-size:clamp\(20px,4\.5vw,26px\);font-weight:400/);
assert.doesNotMatch(source, /<dt>請求日<\/dt>/);

for (const table of ["system_modules", "managed_files", "access_tokens", "audit_events"]) {
  assert.match(commonMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
}

const validToken = "a".repeat(43);
assert.equal(isOpaqueToken(validToken), true);
assert.equal(isOpaqueToken("short"), false);
assert.equal((await hashOpaqueToken(validToken)).length, 64);

console.log("Cloudflare foundation checks passed.");
