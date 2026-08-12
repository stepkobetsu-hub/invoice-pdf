import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __test } from "../src/index.js";

const migration = readFileSync(new URL("../migrations/0004_invoice_workspace.sql", import.meta.url), "utf8");
const openLevelMigration = readFileSync(new URL("../migrations/0007_invoice_open_levels.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

for (const column of ["partner_name", "payment_status", "payment_date", "payment_amount", "payment_memo", "deleted_at"]) {
  assert.match(migration, new RegExp(`ALTER TABLE invoices ADD COLUMN ${column}\\b`));
}
assert.match(source, /\/api\/app\/dashboard/);
assert.match(source, /pdfStatus: row\.r2_object_key \? "PDF作成済み" : "未作成"/, "an existing R2 PDF is ready regardless of invoice lifecycle status");
assert.match(source, /url\.pathname === "\/api\/app\/apps-script"/, "authenticated app clients can call the Apps Script proxy");
assert.match(source, /APP_SCRIPT_ACTIONS\.has\(action\)/, "Apps Script proxy actions are allowlisted");
const appRoutes = source.match(/async function serveAppRequest\([\s\S]*?\r?\n}\r?\n\r?\nfunction isAllowedAppOrigin/)[0];
const adminRoutes = source.match(/async function serveAdminRequest\([\s\S]*?\r?\n}\r?\n\r?\nasync function isAuthorizedAdmin/)[0];
assert.match(appRoutes, /url\.pathname === "\/api\/app\/apps-script"/, "Apps Script proxy is inside app routes");
assert.doesNotMatch(adminRoutes, /\/api\/app\/apps-script/, "Apps Script proxy is not misplaced in admin routes");
assert.match(source, /\/api\/app\/invoices/);
assert.match(source, /\/api\/admin\/migrations\/invoices/);
assert.match(source, /authorization/);
assert.match(source, /payload\.value\.createOnly === true/);
assert.match(source, /assignAvailableInvoiceNumber/);
assert.match(source, /if \(!\/\^\\d\+\$\/\.test\(invoiceNumber\)\)/);
assert.match(source, /created_at=excluded\.created_at, updated_at=excluded\.updated_at/, "reimported invoice batches move to the top of the invoice list");
assert.match(source, /APP_ORIGIN/);
assert.match(openLevelMigration, /ALTER TABLE invoices ADD COLUMN app_downloaded_at TEXT/);
assert.match(source, /appDownloadMatch/);
assert.match(source, /appDownloadedAt: row\.app_downloaded_at/);

const invoice = __test.normalizeInvoice({
  invoiceNumber: "202608001", customerCode: "1320", partnerName: "ダミー取引先", invoiceDate: "2026-08-10",
  subtotal: 0, tax: 0, total: 0, paymentStatus: "未入金",
  details: [
    { name: "テスト", unitPrice: 100, quantity: 1, amount: 100, taxRate: "10%" },
    { name: "テスト割引", unitPrice: -100, quantity: 1, amount: -100, taxRate: "10%" },
  ],
});
assert.equal(invoice.details[1].unitPrice, -100);
assert.equal(invoice.details[0].taxRate, 0.1);
assert.equal(__test.positiveTaxRate("10%"), 0.1);
assert.equal(__test.nextMonthlyInvoiceNumber("2026-08-12", []), "202608001");
assert.equal(__test.nextMonthlyInvoiceNumber("2026-08-12", ["202608001", "202608007", "202609999"]), "202608008");
assert.equal(__test.nextMonthlyInvoiceNumber("2026-09-01", [{ invoice_number: "202609002" }, { invoice_number: "202608999" }]), "202609003");
assert.deepEqual(__test.deliveryState("downloaded"), { sendStatus: "送信済み", dlStatus: "PDF表示済み" });

console.log("Cloudflare invoice workspace checks passed.");
