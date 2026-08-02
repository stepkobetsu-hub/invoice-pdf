const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "step-invoice-api",
        environment: env.APP_ENV || "development",
        productionSendApproved: false,
        testSendApproved: false,
        emailProviderConfigured: false,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/send") {
      return sendDisabled(env);
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

function sendDisabled(env) {
  const productionApproved = env.PRODUCTION_SEND_APPROVED === "true";
  const testApproved = env.TEST_SEND_APPROVED === "true";
  if (!productionApproved || !testApproved) {
    return json({
      ok: false,
      error: "EMAIL_SEND_DISABLED",
      message: "メール送信は管理者の二重承認がないため無効です。",
    }, 403);
  }
  return json({
    ok: false,
    error: "EMAIL_PROVIDER_NOT_CONFIGURED",
    message: "第1段階ではメール送信プロバイダーを構成していません。",
  }, 503);
}

async function serveDownloadPage(request, env, token) {
  const delivery = await validateDelivery(env, token);
  if (!delivery.ok) return html(unavailablePage(delivery.reason), delivery.status);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE deliveries
      SET first_opened_at = COALESCE(first_opened_at, ?1),
          last_opened_at = ?1,
          open_count = open_count + 1,
          status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
      WHERE delivery_id = ?2
    `).bind(now, delivery.row.delivery_id),
    env.DB.prepare(`
      INSERT INTO download_events
        (event_id, delivery_id, event_type, occurred_at, user_agent_present, ip_stored)
      VALUES (?1, ?2, 'open', ?3, ?4, 0)
    `).bind(crypto.randomUUID(), delivery.row.delivery_id, now, request.headers.has("user-agent") ? 1 : 0),
  ]);

  return html(downloadPage({
    token,
    invoiceNumber: delivery.row.invoice_number,
    partnerName: delivery.row.partner_name,
    expiresAt: delivery.row.expires_at,
  }));
}

async function servePdf(request, env, token) {
  const delivery = await validateDelivery(env, token);
  if (!delivery.ok) return html(unavailablePage(delivery.reason), delivery.status);

  const object = await env.PDFS.get(delivery.row.r2_object_key);
  if (!object) return html(unavailablePage("PDFが見つかりません。"), 404);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE deliveries
      SET downloaded_at = COALESCE(downloaded_at, ?1),
          download_count = download_count + 1,
          status = 'downloaded'
      WHERE delivery_id = ?2
    `).bind(now, delivery.row.delivery_id),
    env.DB.prepare(`
      INSERT INTO download_events
        (event_id, delivery_id, event_type, occurred_at, user_agent_present, ip_stored)
      VALUES (?1, ?2, 'download', ?3, ?4, 0)
    `).bind(crypto.randomUUID(), delivery.row.delivery_id, now, request.headers.has("user-agent") ? 1 : 0),
  ]);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", "application/pdf");
  headers.set("content-disposition", "inline; filename=invoice.pdf");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

async function validateDelivery(env, token) {
  if (!env.DB || !env.PDFS) {
    return { ok: false, status: 503, reason: "テスト環境の保存領域を準備中です。" };
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    return { ok: false, status: 404, reason: "このURLは利用できません。" };
  }

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT d.delivery_id, d.status, d.expires_at, d.revoked_at,
           i.invoice_number, i.r2_object_key,
           p.name AS partner_name
    FROM deliveries d
    JOIN invoices i ON i.invoice_id = d.invoice_id
    JOIN partners p ON p.partner_id = i.partner_id
    WHERE d.token_hash = ?1
    LIMIT 1
  `).bind(tokenHash).first();

  if (!row) return { ok: false, status: 404, reason: "このURLは利用できません。" };
  if (row.revoked_at || row.status === "revoked") {
    return { ok: false, status: 410, reason: "このURLは利用できません。最新の案内をご確認ください。" };
  }
  if (!row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, status: 410, reason: "このURLの有効期限が切れています。" };
  }
  return { ok: true, row };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
<p class="note">PDFは非公開ストレージから安全に取得されます。Google Driveには移動しません。</p>
</main></body></html>`;
}

function unavailablePage(reason) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ダウンロードURLをご利用いただけません</title><style>${pageCss()}</style></head>
<body><main class="card"><div class="brand">個別指導ステップ</div><h1>このダウンロードURLは現在ご利用いただけません。</h1>
<p class="lead">${escapeHtml(reason)}</p><p>最新の案内をご確認いただくか、個別指導ステップまでお問い合わせください。</p></main></body></html>`;
}

function notFoundPage() {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>STEP請求書</title><style>${pageCss()}</style></head><body><main class="card"><div class="brand">個別指導ステップ</div><h1>ページが見つかりません。</h1></main></body></html>`;
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

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", ...SECURITY_HEADERS },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
  });
}
