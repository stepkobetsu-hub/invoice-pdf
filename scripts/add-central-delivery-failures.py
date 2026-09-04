from pathlib import Path

path = Path('cloudflare/src/index.js')
text = path.read_text(encoding='utf-8')

route_anchor = '''  if (request.method === "GET" && url.pathname === "/api/app/support") {
    return appJson(request, env, { ok: true, data: await loadCloudSupportData(env) });
  }
'''
route = '''
  if (request.method === "GET" && url.pathname === "/api/app/delivery-failures") {
    return appJson(request, env, { ok: true, data: await listCentralDeliveryFailures(env, url) });
  }
'''
if route not in text:
    if route_anchor not in text:
        raise SystemExit('support route anchor not found')
    text = text.replace(route_anchor, route_anchor + route, 1)

helper_anchor = 'async function loadCloudSupportData(env) {'
helper = '''const CENTRAL_DELIVERY_FAILURE_EVENTS = new Set([
  "hard_bounce", "soft_bounce", "deferred", "blocked", "invalid_email", "spam", "error"
]);

function normalizeCentralDeliveryFailureEvent(value) {
  const key = String(value || "").trim().replace(/[\\s-]/g, "_").toLowerCase();
  const aliases = {
    hardbounce: "hard_bounce",
    softbounce: "soft_bounce",
    invalid: "invalid_email",
    invalidemail: "invalid_email",
    complaint: "spam",
  };
  return aliases[key] || key;
}

function centralDeliveryFailureState(event) {
  return ({
    hard_bounce: "恒久不達",
    soft_bounce: "一時エラー",
    deferred: "一時エラー",
    blocked: "ブロック",
    invalid_email: "無効アドレス",
    spam: "迷惑メール報告",
    error: "送信エラー",
  })[event] || "送信エラー";
}

async function listCentralDeliveryFailures(env, url) {
  const requested = Number.parseInt(url.searchParams.get("limit") || "200", 10);
  const limit = Math.min(Math.max(Number.isInteger(requested) ? requested : 200, 1), 500);
  const result = await env.DB.prepare(`
    SELECT
      d.delivery_id,
      d.recipient_email,
      d.email_status,
      d.last_email_event_at,
      d.status AS delivery_status,
      d.resend_count,
      d.first_opened_at,
      d.downloaded_at,
      d.open_count,
      d.download_count,
      d.revoked_at,
      d.updated_at AS delivery_updated_at,
      i.invoice_number,
      COALESCE(i.customer_code, p.customer_code, '') AS customer_code,
      COALESCE(i.partner_name, p.name, '') AS partner_name,
      COALESCE(i.subject_month, '') AS subject_month,
      COALESCE(p.classroom, '') AS school,
      COALESCE(p.delivery_suspended, 0) AS delivery_suspended
    FROM deliveries d
    JOIN invoices i ON i.invoice_id = d.invoice_id
    JOIN partners p ON p.partner_id = i.partner_id
    WHERE d.email_status IS NOT NULL
      AND d.revoked_at IS NULL
      AND i.deleted_at IS NULL
    ORDER BY COALESCE(d.last_email_event_at, d.updated_at) DESC
    LIMIT 500
  `).all();
  const failures = (result.results || []).map(row => {
    const event = normalizeCentralDeliveryFailureEvent(row.email_status);
    return { row, event };
  }).filter(item => CENTRAL_DELIVERY_FAILURE_EVENTS.has(item.event)).slice(0, limit).map(({ row, event }) => ({
    sourceSystem: "INVOICE_PDF",
    deliveryId: String(row.delivery_id || ""),
    email: String(row.recipient_email || ""),
    event,
    state: centralDeliveryFailureState(event),
    occurredAt: String(row.last_email_event_at || row.delivery_updated_at || ""),
    reason: centralDeliveryFailureState(event),
    invoiceNumber: String(row.invoice_number || ""),
    customerCode: String(row.customer_code || ""),
    partnerName: String(row.partner_name || ""),
    studentNames: String(row.partner_name || ""),
    school: String(row.school || ""),
    subjectMonth: String(row.subject_month || ""),
    deliveryStatus: String(row.delivery_status || ""),
    resendCount: Number(row.resend_count || 0),
    firstOpenedAt: row.first_opened_at || null,
    downloadedAt: row.downloaded_at || null,
    openCount: Number(row.open_count || 0),
    downloadCount: Number(row.download_count || 0),
    deliverySuspended: Number(row.delivery_suspended || 0) === 1,
  }));
  return { failures, count: failures.length, sourceSystem: "INVOICE_PDF" };
}

'''
if helper not in text:
    if helper_anchor not in text:
        raise SystemExit('loadCloudSupportData anchor not found')
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

path.write_text(text, encoding='utf-8')
