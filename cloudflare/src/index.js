import { html, json } from "./core/http.js";
import { hashOpaqueToken, isOpaqueToken } from "./core/token.js";

const UNAVAILABLE_REASON = "このURLは利用できません。";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "step-invoice-api" });
    }

    if (env.EMERGENCY_STOP === "true") {
      return url.pathname.startsWith("/api/")
        ? json({ ok: false, error: "SERVICE_PAUSED" }, 503)
        : html(servicePausedPage(), 503);
    }

    if (url.pathname.startsWith("/api/admin/")) {
      return serveAdminRequest(request, env, url);
    }

    if (url.pathname === "/api/send") {
      return sendDisabled(request, env);
    }

    const pdfMatch = url.pathname.match(/^\/d\/([^/]+)\/pdf$/);
    if (request.method === "GET" && pdfMatch) {
      return servePdf(request, env, pdfMatch[1]);
    }

    const downloadMatch = url.pathname.match(/^\/d\/([^/]+)$/);
    if (request.method === "GET" && downloadMatch) {
      return serveDownloadPage(request, env, downloadMatch[1]);
    }

    return html(notFoundPage(), 404);
  },
};

async function serveAdminRequest(request, env, url) {
  if (env.EMERGENCY_STOP === "true" || env.ADMIN_API_ENABLED !== "true") {
    return json({ ok: false, error: "ADMIN_API_DISABLED" }, 403);
  }
  if (!isAuthorizedAdmin(request, env)) {
    return json({ ok: false, error: "ADMIN_AUTH_REQUIRED" }, 401);
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

function isAuthorizedAdmin(request, env) {
  if (!env.ADMIN_API_KEY) return false;
  return request.headers.get("authorization") === `Bearer ${env.ADMIN_API_KEY}`;
}

function sendDisabled(request, env) {
  if (env.EMERGENCY_STOP === "true" || env.ADMIN_API_ENABLED !== "true") {
    return json({ ok: false, error: "EMAIL_SEND_DISABLED" }, 403);
  }
  if (!isAuthorizedAdmin(request, env)) {
    return json({ ok: false, error: "ADMIN_AUTH_REQUIRED" }, 401);
  }
  if (env.PRODUCTION_SEND_APPROVED !== "true" || env.TEST_SEND_APPROVED !== "true") {
    return json({ ok: false, error: "EMAIL_SEND_DISABLED" }, 403);
  }
  return json({ ok: false, error: "EMAIL_PROVIDER_NOT_CONFIGURED" }, 503);
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
        status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
        updated_at = ?1
    WHERE delivery_id = ?2
  `).bind(now, delivery.row.delivery_id).run();

  return html(downloadPage({
    token,
    invoiceNumber: delivery.row.invoice_number,
    partnerName: delivery.row.partner_name,
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
           i.invoice_number, i.r2_object_key,
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

function downloadPage({ token, invoiceNumber, partnerName, expiresAt }) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>STEP請求書ダウンロード</title><style>${pageCss()}</style></head>
<body><main class="card"><div class="brand">個別指導ステップ</div>
<h1>請求書ダウンロード</h1>
<p class="lead">${escapeHtml(partnerName)} 様の請求書をご用意しました。</p>
<dl><div><dt>請求書番号</dt><dd>${escapeHtml(invoiceNumber)}</dd></div><div><dt>有効期限</dt><dd>${escapeHtml(formatDate(expiresAt))}</dd></div></dl>
<a class="button" href="/d/${encodeURIComponent(token)}/pdf">請求書PDFを表示・ダウンロード</a>
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
  return `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:32px 16px;background:#f4f7fb;color:#172b4d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif}.card{max-width:680px;margin:5vh auto;background:#fff;border-radius:18px;padding:clamp(24px,6vw,48px);box-shadow:0 16px 50px #17345a1a}.brand{font-weight:800;color:#173e6b;letter-spacing:.04em}h1{font-size:clamp(24px,5vw,34px);margin:22px 0 16px}.lead{font-size:18px;line-height:1.8}dl{margin:28px 0;border:1px solid #dbe4ef;border-radius:12px;overflow:hidden}dl div{display:grid;grid-template-columns:9em 1fr;padding:14px 16px;border-bottom:1px solid #e7edf4}dl div:last-child{border-bottom:0}dt{font-weight:700}dd{margin:0}.button{display:block;text-align:center;padding:16px 20px;border-radius:11px;background:#174a7e;color:#fff;text-decoration:none;font-weight:800}.button:focus{outline:3px solid #ffcc33;outline-offset:3px}.note{margin-top:20px;color:#52677f;font-size:14px;line-height:1.7}@media(max-width:520px){dl div{grid-template-columns:1fr;gap:4px}}`;
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
