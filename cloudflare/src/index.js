import { html, json } from "./core/http.js";
import { hashOpaqueToken, isOpaqueToken } from "./core/token.js";

const UNAVAILABLE_REASON = "このURLは利用できません。";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "step-invoice-api", storage: "cloudflare-r2" });
      }

      if (env.EMERGENCY_STOP === "true") {
        return url.pathname.startsWith("/api/")
          ? json({ ok: false, error: "SERVICE_PAUSED" }, 503)
          : html(servicePausedPage(), 503);
      }

      if (url.pathname.startsWith("/api/admin/")) {
        return await serveAdminRequest(request, env, ctx, url);
      }

      if (url.pathname === "/api/send") {
        return await sendDisabled(request, env);
      }

      const pdfMatch = url.pathname.match(/^\/d\/([^/]+)\/pdf$/);
      if (request.method === "GET" && pdfMatch) {
        return await servePdf(request, env, pdfMatch[1]);
      }

      const downloadMatch = url.pathname.match(/^\/d\/([^/]+)$/);
      if (request.method === "GET" && downloadMatch) {
        return await serveDownloadPage(request, env, downloadMatch[1]);
      }

      return html(notFoundPage(), 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", path: url.pathname, method: request.method, error: String(error?.message || error) }));
      return url.pathname.startsWith("/api/")
        ? json({ ok: false, error: "INTERNAL_ERROR" }, 500)
        : html(servicePausedPage(), 500);
    }
  },
};

async function serveAdminRequest(request, env, ctx, url) {
  if (env.EMERGENCY_STOP === "true" || env.ADMIN_API_ENABLED !== "true") {
    return json({ ok: false, error: "ADMIN_API_DISABLED" }, 403);
  }
  if (!(await isAuthorizedAdmin(request, env))) {
    return json({ ok: false, error: "ADMIN_AUTH_REQUIRED" }, 401);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/invoices") {
    return uploadInvoice(request, env, ctx);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/deliveries") {
    return createDelivery(request, env, url);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/deliveries/status") {
    return deliveryStatuses(request, env);
  }

  const rotateMatch = url.pathname.match(/^\/api\/admin\/deliveries\/([^/]+)\/rotate$/);
  if (request.method === "POST" && rotateMatch) {
    return rotateDelivery(request, env, url, rotateMatch[1]);
  }

  const revokeMatch = url.pathname.match(/^\/api\/admin\/deliveries\/([^/]+)\/revoke$/);
  if (request.method === "POST" && revokeMatch) {
    return revokeDelivery(env, revokeMatch[1]);
  }

  const sentMatch = url.pathname.match(/^\/api\/admin\/deliveries\/([^/]+)\/sent$/);
  if (request.method === "POST" && sentMatch) {
    return markDeliverySent(env, sentMatch[1]);
  }

  const match = url.pathname.match(/^\/api\/admin\/invoices\/([^/]+)\/pdf$/);
  if (request.method !== "GET" || !match) {
    return json({ ok: false, error: "ADMIN_ROUTE_NOT_FOUND" }, 404);
  }

  const row = await env.DB.prepare(`
    SELECT r2_object_key FROM invoices WHERE invoice_id = ?1 LIMIT 1
  `).bind(match[1]).first();
  if (!row?.r2_object_key) return json({ ok: false, error: "PDF_NOT_FOUND" }, 404);

  const object = await env.PDFS.get(row.r2_object_key);
  if (!object) return json({ ok: false, error: "PDF_NOT_FOUND" }, 404);
  return pdfResponse(object);
}

async function isAuthorizedAdmin(request, env) {
  if (!env.ADMIN_API_KEY) return false;
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.ADMIN_API_KEY}`;
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const a = new Uint8Array(suppliedHash);
  const b = new Uint8Array(expectedHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function sendDisabled(request, env) {
  if (env.EMERGENCY_STOP === "true" || env.ADMIN_API_ENABLED !== "true") {
    return json({ ok: false, error: "EMAIL_SEND_DISABLED" }, 403);
  }
  if (!(await isAuthorizedAdmin(request, env))) {
    return json({ ok: false, error: "ADMIN_AUTH_REQUIRED" }, 401);
  }
  if (env.PRODUCTION_SEND_APPROVED !== "true" || env.TEST_SEND_APPROVED !== "true") {
    return json({ ok: false, error: "EMAIL_SEND_DISABLED" }, 403);
  }
  return json({ ok: false, error: "EMAIL_PROVIDER_NOT_CONFIGURED" }, 503);
}

async function uploadInvoice(request, env, ctx) {
  if (env.PDF_UPLOAD_ENABLED !== "true") return json({ ok: false, error: "PDF_UPLOAD_DISABLED" }, 403);
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > 14 * 1024 * 1024) return json({ ok: false, error: "PDF_TOO_LARGE" }, 413);

  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const invoice = payload.value.invoice || {};
  const invoiceNumber = String(invoice.invoiceNumber || "").trim();
  const customerCode = String(invoice.customerCode || "").trim();
  const partnerName = String(invoice.partnerName || "").trim();
  if (!/^\d{9}$/.test(invoiceNumber) || !customerCode || !partnerName) {
    return json({ ok: false, error: "INVALID_INVOICE" }, 400);
  }

  let pdfBytes;
  try {
    pdfBytes = decodeBase64Pdf(payload.value.pdfBase64);
  } catch (_error) {
    return json({ ok: false, error: "INVALID_PDF" }, 400);
  }
  if (pdfBytes.byteLength > 10 * 1024 * 1024) return json({ ok: false, error: "PDF_TOO_LARGE" }, 413);

  const now = new Date().toISOString();
  const partnerId = `partner:${customerCode}`;
  const invoiceId = `invoice:${invoiceNumber}`;
  const objectKey = `invoices/${invoiceNumber.slice(0, 4)}/${invoiceNumber.slice(4, 6)}/${invoiceNumber}-${crypto.randomUUID()}.pdf`;
  const old = await env.DB.prepare("SELECT r2_object_key FROM invoices WHERE invoice_number = ?1 LIMIT 1").bind(invoiceNumber).first();
  const pdfHash = await sha256Hex(pdfBytes);
  const items = Array.isArray(invoice.details) ? invoice.details.slice(0, 100) : [];

  await env.PDFS.put(objectKey, pdfBytes, {
    httpMetadata: { contentType: "application/pdf", contentDisposition: "inline; filename=invoice.pdf", cacheControl: "private, no-store" },
    customMetadata: { invoiceNumber, sha256: pdfHash },
  });

  const statements = [
    env.DB.prepare(`
      INSERT INTO partners (partner_id, customer_code, name, name_kana, honorific, postal_code, prefecture, address1, address2, phone, email, cc_email, created_at, updated_at)
      VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8, '', ?9, ?10, ?11, ?11)
      ON CONFLICT(customer_code) DO UPDATE SET name=excluded.name, honorific=excluded.honorific, postal_code=excluded.postal_code,
        prefecture=excluded.prefecture, address1=excluded.address1, address2=excluded.address2, email=excluded.email,
        cc_email=excluded.cc_email, updated_at=excluded.updated_at
    `).bind(partnerId, customerCode, partnerName, String(invoice.honorific || "様"), String(invoice.postal || ""), String(invoice.prefecture || ""), String(invoice.address1 || ""), String(invoice.address2 || ""), String(invoice.email || ""), String(invoice.cc || ""), now),
    env.DB.prepare(`
      INSERT INTO invoices (invoice_id, invoice_number, partner_id, subject_month, issue_date, due_date, subtotal, tax, total, status, r2_object_key, pdf_sha256, pdf_size, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'ready', ?10, ?11, ?12, ?13, ?13)
      ON CONFLICT(invoice_number) DO UPDATE SET partner_id=excluded.partner_id, subject_month=excluded.subject_month,
        issue_date=excluded.issue_date, due_date=excluded.due_date, subtotal=excluded.subtotal, tax=excluded.tax,
        total=excluded.total, status='ready', r2_object_key=excluded.r2_object_key, pdf_sha256=excluded.pdf_sha256,
        pdf_size=excluded.pdf_size, updated_at=excluded.updated_at
    `).bind(invoiceId, invoiceNumber, partnerId, String(invoice.subject || ""), String(invoice.invoiceDate || ""), String(invoice.dueDate || ""), positiveMoney(invoice.subtotal), positiveMoney(invoice.tax), positiveMoney(invoice.total), objectKey, pdfHash, pdfBytes.byteLength, now),
    env.DB.prepare("DELETE FROM invoice_items WHERE invoice_id = ?1").bind(invoiceId),
  ];
  items.forEach((item, index) => statements.push(env.DB.prepare(`
    INSERT INTO invoice_items (item_id, invoice_id, line_number, service_date, description, unit_price, quantity, unit, amount, tax_rate)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `).bind(`${invoiceId}:item:${index + 1}`, invoiceId, index + 1, String(item.deliveryDate || ""), String(item.name || ""), signedMoney(item.unitPrice), positiveQuantity(item.quantity), String(item.unit || ""), signedMoney(item.amount), positiveTaxRate(item.taxRate))));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    await env.PDFS.delete(objectKey);
    throw error;
  }
  if (old?.r2_object_key && old.r2_object_key !== objectKey) {
    const cleanup = env.PDFS.delete(old.r2_object_key);
    if (ctx?.waitUntil) ctx.waitUntil(cleanup);
    else await cleanup;
  }
  return json({ ok: true, invoiceId, invoiceNumber, objectKey, fileName: `${invoiceNumber}_${safeFileName(partnerName)}様.pdf` });
}

async function createDelivery(request, env, url) {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const input = payload.value;
  const invoiceNumber = String(input.invoiceNumber || "").trim();
  const deliveryId = String(input.deliveryId || crypto.randomUUID()).trim();
  const invoice = await env.DB.prepare("SELECT invoice_id FROM invoices WHERE invoice_number = ?1 LIMIT 1").bind(invoiceNumber).first();
  if (!invoice?.invoice_id) return json({ ok: false, error: "INVOICE_NOT_FOUND" }, 404);
  const token = createOpaqueToken();
  const tokenHash = await hashOpaqueToken(token);
  const now = new Date().toISOString();
  const expiresAt = validFutureDate(input.expiresAt) || new Date(Date.now() + positiveInt(env.PARENT_LINK_TTL_DAYS, 60) * 86400000).toISOString();
  await env.DB.prepare(`
    INSERT INTO deliveries (delivery_id, invoice_id, recipient_email, cc_email, token_hash, issued_at, expires_at, status, created_by, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?6, ?6)
    ON CONFLICT(delivery_id) DO UPDATE SET token_hash=excluded.token_hash, issued_at=excluded.issued_at,
      expires_at=excluded.expires_at, status='pending', revoked_at=NULL, updated_at=excluded.updated_at
  `).bind(deliveryId, invoice.invoice_id, String(input.recipientEmail || ""), String(input.ccEmail || ""), tokenHash, now, expiresAt, String(input.createdBy || "apps-script")).run();
  return json({ ok: true, deliveryId, expiresAt, downloadUrl: `${url.origin}/d/${token}` });
}

async function rotateDelivery(request, env, url, deliveryId) {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const existing = await env.DB.prepare("SELECT delivery_id FROM deliveries WHERE delivery_id = ?1 LIMIT 1").bind(deliveryId).first();
  if (!existing) return json({ ok: false, error: "DELIVERY_NOT_FOUND" }, 404);
  const token = createOpaqueToken();
  const tokenHash = await hashOpaqueToken(token);
  const now = new Date().toISOString();
  const expiresAt = validFutureDate(payload.value.expiresAt) || new Date(Date.now() + positiveInt(env.PARENT_LINK_TTL_DAYS, 60) * 86400000).toISOString();
  await env.DB.prepare(`UPDATE deliveries SET token_hash=?1, issued_at=?2, expires_at=?3, revoked_at=NULL,
    status='pending', first_opened_at=NULL, last_opened_at=NULL, downloaded_at=NULL, open_count=0,
    download_count=0, download_day=NULL, download_day_count=0, updated_at=?2 WHERE delivery_id=?4`)
    .bind(tokenHash, now, expiresAt, deliveryId).run();
  return json({ ok: true, deliveryId, expiresAt, downloadUrl: `${url.origin}/d/${token}` });
}

async function revokeDelivery(env, deliveryId) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE deliveries SET status='revoked', revoked_at=?1, updated_at=?1 WHERE delivery_id=?2").bind(now, deliveryId).run();
  return json({ ok: true, deliveryId, revoked: Number(result.meta?.changes || 0) });
}

async function markDeliverySent(env, deliveryId) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE deliveries SET status=CASE WHEN status='pending' THEN 'sent' ELSE status END, updated_at=?1 WHERE delivery_id=?2").bind(now, deliveryId).run();
  return json({ ok: true, deliveryId, updated: Number(result.meta?.changes || 0) });
}

async function deliveryStatuses(request, env) {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const ids = [...new Set((Array.isArray(payload.value.deliveryIds) ? payload.value.deliveryIds : []).map(String).filter(Boolean))].slice(0, 100);
  if (!ids.length) return json({ ok: true, items: [] });
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(",");
  const result = await env.DB.prepare(`SELECT delivery_id, status, first_opened_at, last_opened_at, downloaded_at, open_count, download_count, expires_at, revoked_at FROM deliveries WHERE delivery_id IN (${placeholders})`).bind(...ids).all();
  return json({ ok: true, items: result.results || [] });
}

async function serveDownloadPage(request, env, token) {
  const gate = await publicDownloadGate(request, env, token, "page");
  if (!gate.ok) return gate.response;

  const delivery = await validateDelivery(env, token);
  if (!delivery.ok) return html(unavailablePage(UNAVAILABLE_REASON), delivery.status);

  const exactRate = await enforceKnownDeliveryRate(request, env, token, "page");
  if (!exactRate.ok) return html(rateLimitedPage(), 429);

  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE deliveries
    SET first_opened_at = COALESCE(first_opened_at, ?1),
        last_opened_at = ?1,
        open_count = open_count + 1,
        status = CASE WHEN status IN ('pending', 'sent') THEN 'opened' ELSE status END,
        updated_at = ?1
    WHERE delivery_id = ?2
  `).bind(now, delivery.row.delivery_id).run();

  return html(downloadPage({
    token,
    total: delivery.row.total,
    invoiceNumber: delivery.row.invoice_number,
    partnerName: delivery.row.partner_name,
    dueDate: delivery.row.due_date,
    expiresAt: delivery.row.expires_at,
  }));
}

async function servePdf(request, env, token) {
  const gate = await publicDownloadGate(request, env, token, "pdf");
  if (!gate.ok) return gate.response;

  const delivery = await validateDelivery(env, token);
  if (!delivery.ok) return html(unavailablePage(UNAVAILABLE_REASON), delivery.status);

  const exactRate = await enforceKnownDeliveryRate(request, env, token, "pdf");
  if (!exactRate.ok) return html(rateLimitedPage(), 429);

  const today = new Date().toISOString().slice(0, 10);
  const maxTotal = positiveInt(env.PDF_DOWNLOAD_MAX_TOTAL, 20);
  const maxDaily = positiveInt(env.PDF_DOWNLOAD_MAX_DAILY, 10);
  const dailyCount = delivery.row.download_day === today ? Number(delivery.row.download_day_count || 0) : 0;
  if (Number(delivery.row.download_count || 0) >= maxTotal || dailyCount >= maxDaily) {
    return html(downloadLimitPage(), 429);
  }

  const object = await env.PDFS.get(delivery.row.r2_object_key);
  if (!object) return html(unavailablePage(UNAVAILABLE_REASON), 404);

  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE deliveries
    SET downloaded_at = COALESCE(downloaded_at, ?1),
        download_count = download_count + 1,
        download_day = ?2,
        download_day_count = CASE WHEN download_day = ?2 THEN download_day_count + 1 ELSE 1 END,
        status = 'downloaded',
        updated_at = ?1
    WHERE delivery_id = ?3
  `).bind(now, today, delivery.row.delivery_id).run();

  return pdfResponse(object);
}

async function publicDownloadGate(request, env, token, routeKind) {
  if (env.EMERGENCY_STOP === "true") {
    return { ok: false, response: html(servicePausedPage(), 503) };
  }
  if (env.PUBLIC_DOWNLOAD_ENABLED !== "true") {
    return { ok: false, response: html(servicePausedPage(), 503) };
  }
  if (!env.TOKEN_PEPPER) {
    return { ok: false, response: html(servicePausedPage(), 503) };
  }

  const rate = await enforceRateLimit(request, env, token, routeKind);
  if (!rate.ok) {
    return { ok: false, response: html(rateLimitedPage(), 429) };
  }
  return { ok: true };
}

async function enforceRateLimit(request, env, token, routeKind) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const [ipKey, tokenKey] = await Promise.all([
    hashOpaqueToken(`${env.TOKEN_PEPPER}|ip|${ip}`),
    hashOpaqueToken(`${env.TOKEN_PEPPER}|token|${String(token).slice(0, 128)}`),
  ]);

  const ipLimiter = routeKind === "pdf" ? env.PDF_IP_RATE_LIMITER : env.PAGE_IP_RATE_LIMITER;
  const tokenLimiter = routeKind === "pdf" ? env.PDF_TOKEN_RATE_LIMITER : env.PAGE_TOKEN_RATE_LIMITER;
  if (!ipLimiter?.limit || !tokenLimiter?.limit) return { ok: false };

  const [ipResult, tokenResult] = await Promise.all([
    ipLimiter.limit({ key: ipKey }),
    tokenLimiter.limit({ key: tokenKey }),
  ]);
  return { ok: ipResult.success && tokenResult.success };
}

async function enforceKnownDeliveryRate(request, env, token, routeKind) {
  const now = new Date();
  const bucket = now.toISOString().slice(0, 16);
  const expiresAt = new Date(now.getTime() + 120_000).toISOString();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const tokenLimit = routeKind === "pdf" ? 5 : 10;
  const ipLimit = routeKind === "pdf" ? 10 : 30;
  const [tokenSubject, ipSubject] = await Promise.all([
    hashOpaqueToken(`${env.TOKEN_PEPPER}|exact-token|${token}`),
    hashOpaqueToken(`${env.TOKEN_PEPPER}|exact-ip|${ip}`),
  ]);

  // Count only known, valid deliveries. Unknown-token attacks do not create rows.
  const tokenAllowed = await incrementMinuteCounter(env, routeKind, "token", tokenSubject, bucket, expiresAt, tokenLimit);
  if (!tokenAllowed) return { ok: false };
  const ipAllowed = await incrementMinuteCounter(env, routeKind, "ip", ipSubject, bucket, expiresAt, ipLimit);
  return { ok: ipAllowed };
}

async function incrementMinuteCounter(env, routeKind, subjectKind, subjectHash, bucket, expiresAt, limit) {
  const counterKey = `${routeKind}:${subjectKind}:${subjectHash}`;
  const result = await env.DB.prepare(`
    INSERT INTO abuse_counters (
      counter_key, time_bucket, category, subject_hash,
      failure_count, last_seen_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, 1, datetime('now'), ?5)
    ON CONFLICT(counter_key) DO UPDATE SET
      time_bucket = excluded.time_bucket,
      failure_count = CASE
        WHEN abuse_counters.time_bucket = excluded.time_bucket THEN abuse_counters.failure_count + 1
        ELSE 1
      END,
      last_seen_at = datetime('now'),
      expires_at = excluded.expires_at
    WHERE abuse_counters.time_bucket != excluded.time_bucket
       OR abuse_counters.failure_count < ?6
    RETURNING failure_count
  `).bind(counterKey, bucket, `${routeKind}:${subjectKind}`, subjectHash, expiresAt, limit).first();
  return Boolean(result && Number(result.failure_count) <= limit);
}

async function validateDelivery(env, token) {
  if (!env.DB || !env.PDFS || !isOpaqueToken(token)) {
    return { ok: false, status: 404 };
  }

  const tokenHash = await hashOpaqueToken(token);
  const row = await env.DB.prepare(`
    SELECT d.delivery_id, d.status, d.expires_at, d.revoked_at,
           d.download_count, d.download_day, d.download_day_count,
           i.invoice_number, i.issue_date, i.due_date, i.total, i.r2_object_key,
           p.name AS partner_name
    FROM deliveries d
    JOIN invoices i ON i.invoice_id = d.invoice_id
    JOIN partners p ON p.partner_id = i.partner_id
    WHERE d.token_hash = ?1
    LIMIT 1
  `).bind(tokenHash).first();

  if (!row || row.revoked_at || row.status === "revoked" || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, status: 404 };
  }
  return { ok: true, row };
}

function pdfResponse(object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", "application/pdf");
  headers.set("content-disposition", "inline; filename=invoice.pdf");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJson(request) {
  try {
    const text = await request.text();
    if (text.length > 14 * 1024 * 1024) return { ok: false, response: json({ ok: false, error: "REQUEST_TOO_LARGE" }, 413) };
    return { ok: true, value: JSON.parse(text || "{}") };
  } catch (_error) {
    return { ok: false, response: json({ ok: false, error: "INVALID_JSON" }, 400) };
  }
}

function decodeBase64Pdf(value) {
  const base64 = String(value || "").replace(/^data:application\/pdf;base64,/, "").replace(/\s+/g, "");
  if (!base64 || base64.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("INVALID_BASE64");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("INVALID_PDF");
  return bytes;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeFileName(value) {
  return String(value || "invoice").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

function positiveMoney(value) {
  const number = Math.round(Number(value || 0));
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function signedMoney(value) {
  const number = Math.round(Number(value || 0));
  return Number.isFinite(number) ? number : 0;
}

function positiveQuantity(value) {
  const number = Number(value == null ? 1 : value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function positiveTaxRate(value) {
  const number = Number(value == null ? 0.1 : value);
  if (!Number.isFinite(number) || number < 0) return 0.1;
  return number > 1 ? number / 100 : number;
}

function validFutureDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) && time > Date.now() ? new Date(time).toISOString() : "";
}

function downloadPage({ token, total, invoiceNumber, partnerName, dueDate, expiresAt }) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>STEP請求書ダウンロード</title><style>${pageCss()}</style></head>
<body><main class="card"><div class="brand">個別指導ステップ</div>
<h1>請求書ダウンロード</h1>
<p class="lead">${escapeHtml(partnerName)} 様の請求書をご用意しました。</p>
<dl><div class="invoice-total"><dt>ご請求金額</dt><dd>${escapeHtml(formatMoney(total))}</dd></div><div><dt>請求書番号</dt><dd>${escapeHtml(invoiceNumber)}</dd></div><div><dt>お支払期限</dt><dd>${escapeHtml(formatDate(dueDate))}</dd></div></dl>
<a class="button" href="/d/${encodeURIComponent(token)}/pdf">請求書PDFを表示・ダウンロード</a>
<p class="download-expiry">ダウンロード期限：${escapeHtml(formatDate(expiresAt))}</p>
<p class="note">PDFはSTEPの保護された配信経路から取得されます。</p>
</main></body></html>`;
}

function unavailablePage(reason) {
  return messagePage("このダウンロードURLは現在ご利用いただけません。", reason);
}

function downloadLimitPage() {
  return messagePage("ダウンロード回数の上限に達しました。", "この請求書はダウンロード回数の上限に達しました。個別指導ステップまでお問い合わせください。");
}

function rateLimitedPage() {
  return messagePage("短時間にアクセスが集中しています。", "しばらく待ってから、もう一度お試しください。");
}

function servicePausedPage() {
  return messagePage("現在、請求書配信サービスを一時停止しています。", "お急ぎの場合は個別指導ステップまでお問い合わせください。");
}

function messagePage(title, message) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${pageCss()}</style></head><body><main class="card"><div class="brand">個別指導ステップ</div>
<h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(message)}</p></main></body></html>`;
}

function notFoundPage() {
  return messagePage("ページが見つかりません。", "URLをご確認ください。");
}

function pageCss() {
  return `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:32px 16px;background:#f4f7fb;color:#172b4d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif}.card{max-width:680px;margin:5vh auto;background:#fff;border-radius:18px;padding:clamp(24px,6vw,48px);box-shadow:0 16px 50px #17345a1a}.brand{font-weight:800;color:#173e6b;letter-spacing:.04em}h1{font-size:clamp(24px,5vw,34px);margin:22px 0 16px}.lead{font-size:18px;line-height:1.8}dl{margin:28px 0;border:1px solid #dbe4ef;border-radius:12px;overflow:hidden}dl div{display:grid;grid-template-columns:9em 1fr;padding:14px 16px;border-bottom:1px solid #e7edf4}dl div:last-child{border-bottom:0}dt{font-weight:700}dd{margin:0}.invoice-total{background:#f4f8fd}.invoice-total dd{font-size:clamp(22px,5vw,30px);font-weight:800;color:#173e6b}.button{display:block;text-align:center;padding:16px 20px;border-radius:11px;background:#174a7e;color:#fff;text-decoration:none;font-weight:800}.button:focus{outline:3px solid #ffcc33;outline-offset:3px}.download-expiry{margin:9px 0 0;text-align:center;color:#66788d;font-size:12px}.note{margin-top:20px;color:#52677f;font-size:14px;line-height:1.7}@media(max-width:520px){dl div{grid-template-columns:1fr;gap:4px}}`;
}

function formatMoney(value) {
  const amount = Math.round(Number(value || 0));
  return `${Number.isFinite(amount) ? amount.toLocaleString("ja-JP") : "0"}円`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
