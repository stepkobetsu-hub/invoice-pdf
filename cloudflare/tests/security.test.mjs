import assert from "node:assert/strict";
import worker from "../src/index.js";

const token = "A".repeat(43);

function limiter(success, counts) {
  return { async limit() { counts.limiter += 1; return { success }; } };
}

function createEnv(options = {}) {
  const counts = { first: 0, run: 0, r2: 0, limiter: 0, exactRate: 0 };
  const row = options.row === undefined ? {
    delivery_id: "delivery-test", status: "sent", expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
    download_count: 0, download_day: null, download_day_count: 0,
    invoice_number: "CF-TEST-0001", r2_object_key: "invoices/2026/08/opaque.pdf", partner_name: "架空テスト保護者",
  } : options.row;
  const statement = {
    bind() { return this; },
    async first() { counts.first += 1; return row; },
    async run() { counts.run += 1; return { success: true }; },
  };
  const rateStatement = {
    bind() { return this; },
    async first() {
      counts.exactRate += 1;
      return options.exactRateAllowed === false ? null : { failure_count: 1 };
    },
  };
  const rate = limiter(options.rateSuccess ?? true, counts);
  return { counts, env: {
    TOKEN_PEPPER: "test-pepper", PUBLIC_DOWNLOAD_ENABLED: "true", PDF_UPLOAD_ENABLED: "false",
    ADMIN_API_ENABLED: "false", EMERGENCY_STOP: "false", PRODUCTION_SEND_APPROVED: "false",
    TEST_SEND_APPROVED: "false", PDF_DOWNLOAD_MAX_TOTAL: "20", PDF_DOWNLOAD_MAX_DAILY: "10",
    PAGE_IP_RATE_LIMITER: rate, PAGE_TOKEN_RATE_LIMITER: rate, PDF_IP_RATE_LIMITER: rate, PDF_TOKEN_RATE_LIMITER: rate,
    DB: { prepare(sql) { return sql.includes("INSERT INTO abuse_counters") ? rateStatement : statement; } },
    PDFS: { async get() { counts.r2 += 1; return { body: new Uint8Array([37, 80, 68, 70]), writeHttpMetadata() {} }; } },
  } };
}

{
  const { env, counts } = createEnv({ exactRateAllowed: false });
  const response = await worker.fetch(new Request(`https://example.test/d/${"B".repeat(43)}`), env);
  assert.equal(response.status, 429);
  assert.equal(counts.first, 1);
  assert.equal(counts.exactRate, 1);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv();
  const response = await worker.fetch(new Request("https://example.test/d/short"), env);
  assert.equal(response.status, 404);
  assert.equal(counts.first, 0);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv({ row: null });
  const response = await worker.fetch(new Request(`https://example.test/d/${token}/pdf`), env);
  assert.equal(response.status, 404);
  assert.equal(counts.first, 1);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv({ rateSuccess: false });
  const response = await worker.fetch(new Request(`https://example.test/d/${token}`), env);
  assert.equal(response.status, 429);
  assert.equal(counts.first, 0);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv();
  env.EMERGENCY_STOP = "true";
  const response = await worker.fetch(new Request(`https://example.test/d/${token}`), env);
  assert.equal(response.status, 503);
  assert.equal(counts.limiter, 0);
  assert.equal(counts.first, 0);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv();
  env.EMERGENCY_STOP = "true";
  const response = await worker.fetch(new Request("https://example.test/api/send", { method: "POST" }), env);
  assert.equal(response.status, 503);
  assert.equal(counts.limiter, 0);
  assert.equal(counts.first, 0);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv();
  env.PUBLIC_DOWNLOAD_ENABLED = "false";
  const response = await worker.fetch(new Request(`https://example.test/d/${"C".repeat(43)}`), env);
  assert.equal(response.status, 503);
  assert.equal(counts.limiter, 0);
  assert.equal(counts.first, 0);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv({ row: {
    delivery_id: "delivery-test", status: "sent", expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
    download_count: 20, download_day: null, download_day_count: 0,
    invoice_number: "CF-TEST-0001", r2_object_key: "invoices/2026/08/opaque.pdf", partner_name: "架空テスト保護者",
  } });
  const response = await worker.fetch(new Request(`https://example.test/d/${token}/pdf`), env);
  assert.equal(response.status, 429);
  assert.equal(counts.r2, 0);
}

{
  const { env, counts } = createEnv({ row: { r2_object_key: "invoices/2026/08/opaque.pdf" } });
  env.ADMIN_API_ENABLED = "true";
  env.ADMIN_API_KEY = "admin-test-key";
  const response = await worker.fetch(new Request("https://example.test/api/admin/invoices/invoice-test/pdf", {
    headers: { authorization: "Bearer admin-test-key" },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(counts.r2, 1);
}

{
  const { env } = createEnv();
  env.ADMIN_API_ENABLED = "true";
  env.ADMIN_API_KEY = "admin-test-key";
  env.TEST_SEND_APPROVED = "true";
  const response = await worker.fetch(new Request("https://example.test/api/send", {
    method: "POST",
    headers: { authorization: "Bearer admin-test-key" },
  }), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "EMAIL_SEND_DISABLED");
}

console.log("Cloudflare security checks passed.");
