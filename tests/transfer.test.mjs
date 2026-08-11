import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/src/index.js";

const require = createRequire(import.meta.url);
const C = require("../assets/core.js");
const appSource = readFileSync(new URL("../assets/app.js",import.meta.url),"utf8");
const indexSource = readFileSync(new URL("../index.html",import.meta.url),"utf8");
assert.match(appSource,/importInvoiceCsvText\(decoded\.text,decoded\.encoding\)/);
assert.match(appSource,/importInvoiceCsvText\(transfer\.csv,'UTF-8',transfer\)/);
assert.match(appSource,/invoiceCsvFromList.*onInvoiceCsv/);
assert.match(indexSource,/CSV一括追加/);
assert.match(indexSource,/id="transferNotice"/);
const records = new Map();

class Statement {
  constructor(sql) { this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async run() {
    if (this.sql.includes("INSERT INTO invoice_transfers")) {
      const [transferId,billingPeriod,createdAt,itemCount,csvText,expiresAt] = this.args;
      records.set(transferId,{ transfer_id:transferId,billing_period:billingPeriod,created_at:createdAt,item_count:itemCount,csv_text:csvText,expires_at:expiresAt,consumed_at:null });
      return { meta:{ changes:1 } };
    }
    if (this.sql.includes("UPDATE invoice_transfers")) {
      const [now,transferId] = this.args, row = records.get(transferId);
      if (!row || row.consumed_at || row.expires_at <= now) return { meta:{ changes:0 } };
      row.consumed_at = now;
      return { meta:{ changes:1 } };
    }
    throw new Error(`Unexpected run: ${this.sql}`);
  }
  async first() {
    if (!this.sql.includes("FROM invoice_transfers")) throw new Error(`Unexpected first: ${this.sql}`);
    const [transferId,consumedAt] = this.args, row = records.get(transferId);
    return row?.consumed_at === consumedAt ? row : null;
  }
}

globalThis.caches = { default:{ match:async()=>null, put:async()=>{} } };
globalThis.fetch = async()=>new Response(JSON.stringify({ ok:true, permissionLevel:"3", name:"test staff" }),{ status:200, headers:{ "content-type":"application/json" } });

const env = {
  DB:{ prepare:sql=>new Statement(sql) },
  TRANSFER_INGEST_SECRET:"test-transfer-secret",
  APP_ORIGIN:"https://stepkobetsu-hub.github.io",
  STAFF_AUTH_API_URL:"https://auth.invalid/exec",
  EMERGENCY_STOP:"false",
};
const csv = [
  '"取引先名称","件名","請求日","お支払期限","請求書番号","小計","消費税","合計金額"',
  '"ダミー取引先","2026年9月分","2026/08/10","2026/08/27","202609001","1000","100","1100"',
].join("\r\n");
const createdAt = new Date().toISOString();

const createResponse = await worker.fetch(new Request("https://worker.invalid/api/transfers",{
  method:"POST",
  headers:{ authorization:"Bearer test-transfer-secret", "content-type":"application/json" },
  body:JSON.stringify({ billingPeriod:"2026-09", createdAt, itemCount:1, csv }),
}),env,{});
assert.equal(createResponse.status,201);
const created = await createResponse.json();
assert.match(created.transferId,/^[0-9a-f-]{36}$/i);

const consumeRequest = ()=>new Request(`https://worker.invalid/api/app/transfers/${created.transferId}`,{
  headers:{ origin:env.APP_ORIGIN, authorization:"Bearer staff-session" },
});
const firstResponse = await worker.fetch(consumeRequest(),env,{});
assert.equal(firstResponse.status,200);
const first = await firstResponse.json();
assert.equal(first.data.transferId,created.transferId);
assert.equal(first.data.billingPeriod,"2026-09");
assert.equal(first.data.createdAt,createdAt);
assert.equal(first.data.itemCount,1);
assert.equal(C.parseInvoiceRows(C.parseCsv(first.data.csv)).length,1);

const secondResponse = await worker.fetch(consumeRequest(),env,{});
assert.equal(secondResponse.status,410);
assert.equal((await secondResponse.json()).error,"TRANSFER_NOT_FOUND_OR_CONSUMED");

console.log("invoice transfer checks passed");
