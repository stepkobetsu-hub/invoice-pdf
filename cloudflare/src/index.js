import { html, json } from "./core/http.js";
import { hashOpaqueToken, isOpaqueToken } from "./core/token.js";

const UNAVAILABLE_REASON = "このURLは利用できません。";
const APP_SCRIPT_ACTIONS = new Set(["getDashboard", "getSupportData", "importPartners", "deletePartner", "findStudentForPartner", "savePdf", "saveInvoiceData", "updatePaymentStatus", "deleteInvoice", "saveReceiptData", "saveReceiptPdf", "deleteReceipt", "enqueueReceiptSend", "enqueueSend", "disableDelivery", "saveSettings", "recoverQueue", "processPendingSends", "getSendBatchStatus", "getDeliveryDiagnostics"]);

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

      if (request.method === "POST" && url.pathname === "/api/transfers") {
        return await createInvoiceTransfer(request, env);
      }

      if (url.pathname.startsWith("/api/app/")) {
        return await serveAppRequest(request, env, url);
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
      if (url.pathname.startsWith("/api/app/") && isAllowedAppOrigin(request, env)) {
        return appJson(request, env, { ok: false, error: "INTERNAL_ERROR" }, 500);
      }
      return url.pathname.startsWith("/api/")
        ? json({ ok: false, error: "INTERNAL_ERROR" }, 500)
        : html(servicePausedPage(), 500);
    }
  },
};

async function serveAppRequest(request, env, url) {
  if (!isAllowedAppOrigin(request, env)) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (request.method === "OPTIONS") return appResponse(request, env, null, 204);

  const auth = await verifyStaffSession(request, env);
  if (!auth.ok) return appJson(request, env, { ok: false, error: auth.error }, auth.status);

  if (request.method === "GET" && url.pathname === "/api/app/dashboard") {
    const data = await loadInvoiceDashboard(env);
    return appJson(request, env, { ok: true, data: { ...data, user: auth.user.name || auth.user.email || "接続済み" } });
  }

  const transferMatch = url.pathname.match(/^\/api\/app\/transfers\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && transferMatch) {
    return await consumeInvoiceTransfer(request, env, transferMatch[1]);
  }

  if (request.method === "POST" && url.pathname === "/api/app/apps-script") {
    const payload = await readJson(request);
    if (!payload.ok) return withAppCors(payload.response, request, env);
    const action = String(payload.value.action || "");
    if (!APP_SCRIPT_ACTIONS.has(action)) return appJson(request, env, { ok: false, error: "APP_SCRIPT_ACTION_NOT_ALLOWED" }, 400);
    if (!env.INVOICE_API_URL) return appJson(request, env, { ok: false, error: "INVOICE_API_UNAVAILABLE" }, 503);
    const authorization = request.headers.get("authorization") || "";
    const sessionToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    let upstream;
    try {
      upstream = await fetch(env.INVOICE_API_URL, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, payload: payload.value.payload || {}, systemPortalSessionToken: sessionToken }),
        redirect: "follow",
      });
    } catch (_error) {
      return appJson(request, env, { ok: false, error: "INVOICE_API_UNAVAILABLE" }, 503);
    }
    let result;
    try { result = await upstream.json(); } catch (_error) { result = null; }
    if (!upstream.ok || !result?.ok) return appJson(request, env, { ok: false, error: String(result?.error || "INVOICE_API_INVALID_RESPONSE") }, upstream.ok ? 400 : 502);
    return appJson(request, env, result);
  }

  if (request.method === "POST" && url.pathname === "/api/app/invoices") {
    const payload = await readJson(request);
    if (!payload.ok) return withAppCors(payload.response, request, env);
    try {
      const requestedNumber = String(payload.value.invoice?.invoiceNumber || "").trim();
      if (payload.value.createOnly === true) {
        const existing = await env.DB.prepare("SELECT invoice_number FROM invoices WHERE invoice_number=?1 LIMIT 1").bind(requestedNumber).first();
        if (existing) throw new Error("同じ請求書番号が既にあります。別の番号を入力してください。");
      }
      const invoice = await saveInvoiceRecord(env, payload.value.invoice || {}, auth.user, "保存");
      return appJson(request, env, { ok: true, data: { invoice } });
    } catch (error) {
      return appJson(request, env, { ok: false, error: String(error.message || "INVALID_INVOICE") }, 400);
    }
  }

  const paymentMatch = url.pathname.match(/^\/api\/app\/invoices\/([^/]+)\/payment$/);
  if (request.method === "POST" && paymentMatch) {
    const payload = await readJson(request);
    if (!payload.ok) return withAppCors(payload.response, request, env);
    try {
      const invoiceNumber = decodeURIComponent(paymentMatch[1]);
      const invoice = await updateInvoicePayment(env, invoiceNumber, payload.value, auth.user);
      return appJson(request, env, { ok: true, data: { invoice } });
    } catch (error) {
      return appJson(request, env, { ok: false, error: String(error.message || "PAYMENT_UPDATE_FAILED") }, 400);
    }
  }

  const deleteMatch = url.pathname.match(/^\/api\/app\/invoices\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    const invoiceNumber = decodeURIComponent(deleteMatch[1]);
    const deleted = await softDeleteInvoice(env, invoiceNumber, auth.user);
    return appJson(request, env, { ok: true, data: { invoiceNumber, deleted } });
  }

  return appJson(request, env, { ok: false, error: "APP_ROUTE_NOT_FOUND" }, 404);
}

async function createInvoiceTransfer(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const suppliedSecret = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!env.TRANSFER_INGEST_SECRET || !(await secretsMatch(suppliedSecret, env.TRANSFER_INGEST_SECRET))) {
    return json({ ok: false, error: "TRANSFER_AUTH_FAILED" }, 401);
  }

  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const billingPeriod = String(payload.value.billingPeriod || "").trim();
  const createdAt = String(payload.value.createdAt || "").trim();
  const itemCount = Number(payload.value.itemCount);
  const csvText = String(payload.value.csv || "");
  const createdTime = Date.parse(createdAt);
  const now = Date.now();
  if (!/^\d{4}-\d{2}$/.test(billingPeriod)) return json({ ok: false, error: "INVALID_BILLING_PERIOD" }, 400);
  if (!Number.isFinite(createdTime) || Math.abs(now - createdTime) > 10 * 60 * 1000) return json({ ok: false, error: "INVALID_CREATED_AT" }, 400);
  if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 5000) return json({ ok: false, error: "INVALID_ITEM_COUNT" }, 400);
  if (!csvText || csvText.length > 10 * 1024 * 1024) return json({ ok: false, error: "INVALID_CSV" }, 400);

  const transferId = crypto.randomUUID();
  const expiresAt = new Date(now + 30 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO invoice_transfers (transfer_id, billing_period, created_at, item_count, csv_text, expires_at, consumed_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)
  `).bind(transferId, billingPeriod, createdAt, itemCount, csvText, expiresAt).run();
  return json({ ok: true, transferId, billingPeriod, createdAt, itemCount, expiresAt }, 201);
}

async function consumeInvoiceTransfer(request, env, transferId) {
  const now = new Date().toISOString();
  const claimed = await env.DB.prepare(`
    UPDATE invoice_transfers
    SET consumed_at=?1
    WHERE transfer_id=?2 AND consumed_at IS NULL AND expires_at>?1
  `).bind(now, transferId).run();
  if (Number(claimed.meta?.changes || 0) !== 1) {
    return appJson(request, env, { ok: false, error: "TRANSFER_NOT_FOUND_OR_CONSUMED" }, 410);
  }
  const row = await env.DB.prepare(`
    SELECT transfer_id, billing_period, created_at, item_count, csv_text
    FROM invoice_transfers WHERE transfer_id=?1 AND consumed_at=?2
  `).bind(transferId, now).first();
  if (!row) return appJson(request, env, { ok: false, error: "TRANSFER_NOT_FOUND_OR_CONSUMED" }, 410);
  return appJson(request, env, { ok: true, data: {
    transferId: row.transfer_id,
    billingPeriod: row.billing_period,
    createdAt: row.created_at,
    itemCount: row.item_count,
    csv: row.csv_text,
  } });
}

async function secretsMatch(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right || ""))),
  ]);
  const a = new Uint8Array(leftHash), b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function isAllowedAppOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  return Boolean(origin && env.APP_ORIGIN && origin === env.APP_ORIGIN);
}

function appCorsHeaders(request, env) {
  const headers = new Headers();
  if (isAllowedAppOrigin(request, env)) headers.set("access-control-allow-origin", request.headers.get("origin"));
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("access-control-max-age", "600");
  headers.set("vary", "Origin");
  return headers;
}

function appResponse(request, env, body, status = 200) {
  const headers = appCorsHeaders(request, env);
  headers.set("cache-control", "no-store");
  if (body !== null) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function appJson(request, env, body, status = 200) {
  return appResponse(request, env, body, status);
}

function withAppCors(response, request, env) {
  const headers = new Headers(response.headers);
  appCorsHeaders(request, env).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

async function verifyStaffSession(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token.length > 2048 || !env.STAFF_AUTH_API_URL) return { ok: false, status: 401, error: "STAFF_LOGIN_REQUIRED" };

  const digest = await sha256Hex(new TextEncoder().encode(token));
  const cache = caches.default;
  const cacheKey = new Request(`https://step-auth-cache.invalid/session/${digest}`);
  const cached = await cache.match(cacheKey);
  if (cached) return { ok: true, user: await cached.json() };

  let response;
  try {
    response = await fetch(env.STAFF_AUTH_API_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "verifySystemPortal", systemPortalSessionToken: token }),
    });
  } catch (_error) {
    return { ok: false, status: 503, error: "STAFF_AUTH_UNAVAILABLE" };
  }
  let result;
  try { result = await response.json(); } catch (_error) { result = null; }
  const permissionLevel = String(result?.permissionLevel || result?.data?.permissionLevel || "");
  const success = response.ok && (result?.success === true || result?.ok === true) && ["2", "3", "4"].includes(permissionLevel);
  if (!success) return { ok: false, status: 401, error: "STAFF_LOGIN_REQUIRED" };
  const user = { name: String(result?.name || result?.data?.name || ""), email: String(result?.email || result?.data?.email || ""), permissionLevel };
  await cache.put(cacheKey, new Response(JSON.stringify(user), { headers: { "content-type": "application/json", "cache-control": "max-age=120" } }));
  return { ok: true, user };
}

async function loadInvoiceDashboard(env) {
  const invoiceQuery = env.DB.prepare(`
    SELECT i.*,
      COALESCE(i.customer_code, p.customer_code, '') AS resolved_customer_code,
      COALESCE(i.partner_name, p.name, '') AS resolved_partner_name,
      COALESCE(i.honorific, p.honorific, '様') AS resolved_honorific,
      COALESCE(i.postal_code, p.postal_code, '') AS resolved_postal_code,
      COALESCE(i.prefecture, p.prefecture, '') AS resolved_prefecture,
      COALESCE(i.address1, p.address1, '') AS resolved_address1,
      COALESCE(i.address2, p.address2, '') AS resolved_address2,
      COALESCE(i.email, p.email, '') AS resolved_email,
      COALESCE(i.cc_email, p.cc_email, '') AS resolved_cc_email,
      d.delivery_id, d.status AS delivery_status, d.updated_at AS delivery_updated_at,
      d.first_opened_at, d.downloaded_at, d.expires_at,
      it.line_number, it.service_date, it.description, it.unit_price, it.quantity, it.unit, it.amount, it.tax_rate
    FROM invoices i
    JOIN partners p ON p.partner_id = i.partner_id
    LEFT JOIN deliveries d ON d.delivery_id = (
      SELECT d2.delivery_id FROM deliveries d2 WHERE d2.invoice_id = i.invoice_id ORDER BY d2.updated_at DESC LIMIT 1
    )
    LEFT JOIN invoice_items it ON it.invoice_id = i.invoice_id
    WHERE i.deleted_at IS NULL AND i.invoice_number NOT LIKE 'R%'
    ORDER BY i.created_at DESC, i.invoice_number DESC, it.line_number ASC
  `).all();
  const deliveryHistoryQuery = env.DB.prepare(`
    SELECT d.updated_at AS timestamp,
      CASE WHEN d.resend_count > 0 THEN '再送' ELSE '初回送信' END AS action,
      i.invoice_number, COALESCE(i.partner_name, p.name, '') AS name,
      d.delivery_id, d.status, d.downloaded_at, d.first_opened_at
    FROM deliveries d
    JOIN invoices i ON i.invoice_id = d.invoice_id
    JOIN partners p ON p.partner_id = i.partner_id
    WHERE i.deleted_at IS NULL AND i.invoice_number NOT LIKE 'R%'
    ORDER BY d.updated_at DESC LIMIT 300
  `).all();
  const operationHistoryQuery = env.DB.prepare(`
    SELECT occurred_at AS timestamp, action, target_id AS invoice_number, result, detail_json
    FROM operation_logs WHERE target_type = 'invoice' ORDER BY occurred_at DESC LIMIT 300
  `).all();
  const [rows, deliveryHistory, operationHistory] = await Promise.all([invoiceQuery, deliveryHistoryQuery, operationHistoryQuery]);
  const byNumber = new Map();
  for (const row of rows.results || []) {
    const number = String(row.invoice_number);
    if (!byNumber.has(number)) byNumber.set(number, invoiceRowToClient(row));
    if (row.line_number != null) byNumber.get(number).details.push({
      deliveryDate: row.service_date || "", name: row.description || "", itemCode: "",
      unitPrice: Number(row.unit_price || 0), quantity: Number(row.quantity || 0), unit: row.unit || "",
      amount: Number(row.amount || 0), taxRate: `${Math.round(Number(row.tax_rate || 0) * 100)}%`,
    });
  }
  const deliveryEvents = (deliveryHistory.results || []).map(row => {
    const state = deliveryState(row.status, row.first_opened_at, row.downloaded_at);
    return { timestamp: row.timestamp || "", action: row.action || "初回送信", invoiceNumber: row.invoice_number || "", name: row.name || "", deliveryId: maskIdentifier(row.delivery_id), sendStatus: state.sendStatus, urlStatus: state.dlStatus, result: "正常" };
  });
  const operationEvents = (operationHistory.results || []).map(row => ({ timestamp: row.timestamp || "", action: row.action || "更新", invoiceNumber: row.invoice_number || "", name: "", deliveryId: "", sendStatus: "", urlStatus: "", result: row.result || "正常" }));
  return {
    invoices: [...byNumber.values()],
    history: deliveryEvents.concat(operationEvents).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 300),
  };
}

function maskIdentifier(value) {
  const text = String(value || "");
  return text.length <= 8 ? text : `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function invoiceRowToClient(row) {
  const delivery = deliveryState(row.delivery_status, row.first_opened_at, row.downloaded_at);
  return {
    invoiceNumber: String(row.invoice_number || ""), customerCode: row.resolved_customer_code || "",
    partnerName: row.resolved_partner_name || "", honorific: row.resolved_honorific || "様",
    subject: row.subject_month || "", invoiceDate: row.issue_date || "", dueDate: row.due_date || "",
    postal: row.resolved_postal_code || "", prefecture: row.resolved_prefecture || "", address1: row.resolved_address1 || "", address2: row.resolved_address2 || "",
    memo: row.memo || "", tags: row.tags || "", paymentStatus: row.payment_status || "未入金",
    paymentDate: row.payment_date || "", paymentAmount: row.payment_amount == null ? "" : Number(row.payment_amount), paymentMemo: row.payment_memo || "",
    bank: row.bank || "", note: row.note || "", subtotal: Number(row.subtotal || 0), tax: Number(row.tax || 0), total: Number(row.total || 0),
    email: row.resolved_email || "", cc: row.resolved_cc_email || "", pdfStatus: row.r2_object_key ? "PDF作成済み" : "未作成",
    pdfFileId: row.r2_object_key || "", pdfFileName: "", createdAt: row.created_at || "", updatedAt: row.updated_at || "",
    sendStatus: delivery.sendStatus, sentAt: row.delivery_updated_at || "", dlStatus: delivery.dlStatus,
    downloadedAt: row.downloaded_at || "", expiresAt: row.expires_at || "", details: [], warnings: [],
  };
}

function deliveryState(status, openedAt, downloadedAt) {
  if (downloadedAt || status === "downloaded") return { sendStatus: "送信済み", dlStatus: "DL済" };
  if (openedAt || status === "opened") return { sendStatus: "送信済み", dlStatus: "URLアクセス済み" };
  if (status === "sent") return { sendStatus: "送信済み", dlStatus: "未アクセス" };
  if (status === "revoked") return { sendStatus: "無効化", dlStatus: "無効化" };
  if (status === "pending") return { sendStatus: "送信待ち", dlStatus: "送信前" };
  return { sendStatus: "未送信", dlStatus: "未取得" };
}

async function saveInvoiceRecord(env, rawInvoice, actor = {}, action = "保存") {
  const invoice = normalizeInvoice(rawInvoice);
  const now = new Date().toISOString();
  const actorName = String(actor.name || actor.email || "staff").slice(0, 200);
  const partnerId = `partner:${invoice.customerCode}`;
  const invoiceId = `invoice:${invoice.invoiceNumber}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO partners (partner_id, customer_code, name, name_kana, honorific, postal_code, prefecture, address1, address2, phone, email, cc_email, created_at, updated_at)
      VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8, '', ?9, ?10, ?11, ?11)
      ON CONFLICT(customer_code) DO UPDATE SET name=excluded.name, honorific=excluded.honorific,
        postal_code=excluded.postal_code, prefecture=excluded.prefecture, address1=excluded.address1,
        address2=excluded.address2, email=excluded.email, cc_email=excluded.cc_email, updated_at=excluded.updated_at
    `).bind(partnerId, invoice.customerCode, invoice.partnerName, invoice.honorific, invoice.postal, invoice.prefecture, invoice.address1, invoice.address2, invoice.email, invoice.cc, now),
    env.DB.prepare(`
      INSERT INTO invoices (
        invoice_id, invoice_number, partner_id, subject_month, issue_date, due_date,
        subtotal, tax, total, status, created_at, updated_at,
        customer_code, partner_name, honorific, postal_code, prefecture, address1, address2,
        email, cc_email, memo, tags, payment_status, payment_date, payment_amount,
        payment_memo, bank, note, deleted_at, created_by, updated_by
      ) VALUES (
        ?1, ?2, (SELECT partner_id FROM partners WHERE customer_code=?3), ?4, ?5, ?6, ?7, ?8, ?9, 'draft', ?10, ?11,
        ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
        ?26, ?27, ?28, NULL, ?29, ?29
      )
      ON CONFLICT(invoice_number) DO UPDATE SET
        partner_id=excluded.partner_id, subject_month=excluded.subject_month, issue_date=excluded.issue_date,
        due_date=excluded.due_date, subtotal=excluded.subtotal, tax=excluded.tax, total=excluded.total,
        status='draft',
        updated_at=excluded.updated_at, customer_code=excluded.customer_code, partner_name=excluded.partner_name,
        honorific=excluded.honorific, postal_code=excluded.postal_code, prefecture=excluded.prefecture,
        address1=excluded.address1, address2=excluded.address2, email=excluded.email, cc_email=excluded.cc_email,
        memo=excluded.memo, tags=excluded.tags, payment_status=excluded.payment_status,
        payment_date=excluded.payment_date, payment_amount=excluded.payment_amount, payment_memo=excluded.payment_memo,
        bank=excluded.bank, note=excluded.note, deleted_at=NULL, updated_by=excluded.updated_by
    `).bind(
      invoiceId, invoice.invoiceNumber, invoice.customerCode, invoice.subject, invoice.invoiceDate, invoice.dueDate,
      invoice.subtotal, invoice.tax, invoice.total, invoice.createdAt || now, now,
      invoice.customerCode, invoice.partnerName, invoice.honorific, invoice.postal, invoice.prefecture,
      invoice.address1, invoice.address2, invoice.email, invoice.cc, invoice.memo, invoice.tags,
      invoice.paymentStatus, invoice.paymentDate || null, invoice.paymentAmount === "" ? null : invoice.paymentAmount,
      invoice.paymentMemo, invoice.bank, invoice.note, actorName,
    ),
    env.DB.prepare("DELETE FROM invoice_items WHERE invoice_id = (SELECT invoice_id FROM invoices WHERE invoice_number = ?1)").bind(invoice.invoiceNumber),
  ];
  invoice.details.forEach((item, index) => statements.push(env.DB.prepare(`
    INSERT INTO invoice_items (item_id, invoice_id, line_number, service_date, description, unit_price, quantity, unit, amount, tax_rate)
    VALUES (?1, (SELECT invoice_id FROM invoices WHERE invoice_number = ?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `).bind(`${invoiceId}:item:${index + 1}`, invoice.invoiceNumber, index + 1, item.deliveryDate, item.name, item.unitPrice, item.quantity, item.unit, item.amount, item.taxRate)));
  statements.push(operationLogStatement(env, actorName, action, invoice.invoiceNumber, now, { total: invoice.total }));
  await env.DB.batch(statements);
  return loadInvoiceByNumber(env, invoice.invoiceNumber);
}

function normalizeInvoice(raw) {
  const invoiceNumber = String(raw.invoiceNumber || "").trim();
  const customerCode = String(raw.customerCode || "").trim();
  const partnerName = String(raw.partnerName || "").trim();
  const invoiceDate = String(raw.invoiceDate || raw.issueDate || "").trim();
  if (!/^\d+$/.test(invoiceNumber)) throw new Error("請求書番号は数字で入力してください。");
  if (!customerCode || !partnerName) throw new Error("取引先を選択してください。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) throw new Error("請求日を入力してください。");
  const details = (Array.isArray(raw.details) ? raw.details : []).slice(0, 100).map((item, index) => {
    const name = String(item.name || "").trim();
    const unitPrice = strictMoney(item.unitPrice);
    const quantity = Number(item.quantity == null ? 1 : item.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) throw new Error(`明細${index + 1}を正しく入力してください。`);
    return { deliveryDate: String(item.deliveryDate || ""), name, unitPrice, quantity, unit: String(item.unit || ""), amount: strictMoney(item.amount == null ? unitPrice * quantity : item.amount), taxRate: positiveTaxRate(item.taxRate) };
  });
  if (!details.length) throw new Error("請求明細を1行以上入力してください。");
  const subtotal = strictNonNegativeMoney(raw.subtotal);
  const tax = strictNonNegativeMoney(raw.tax);
  const total = strictNonNegativeMoney(raw.total);
  if (subtotal + tax !== total) throw new Error("税抜小計と消費税額の合計が請求金額と一致しません。");
  const paymentStatus = ["未設定", "未入金", "入金済"].includes(String(raw.paymentStatus)) ? String(raw.paymentStatus) : "未入金";
  const paymentAmount = paymentStatus === "入金済" ? strictNonNegativeMoney(raw.paymentAmount === "" || raw.paymentAmount == null ? total : raw.paymentAmount) : "";
  return {
    invoiceNumber, customerCode, partnerName, invoiceDate, details, subtotal, tax, total, paymentStatus, paymentAmount,
    subject: String(raw.subject || ""), dueDate: String(raw.dueDate || ""), honorific: String(raw.honorific || "様"),
    postal: String(raw.postal || ""), prefecture: String(raw.prefecture || ""), address1: String(raw.address1 || ""), address2: String(raw.address2 || ""),
    email: String(raw.email || ""), cc: String(raw.cc || ""), memo: String(raw.memo || ""), tags: String(raw.tags || ""),
    paymentDate: paymentStatus === "入金済" ? String(raw.paymentDate || "") : "", paymentMemo: paymentStatus === "入金済" ? String(raw.paymentMemo || "") : "",
    bank: String(raw.bank || ""), note: String(raw.note || ""), createdAt: String(raw.createdAt || ""),
  };
}

function strictMoney(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) throw new Error("金額を半角数字で入力してください。");
  return number;
}

function strictNonNegativeMoney(value) {
  const number = strictMoney(value);
  if (number < 0) throw new Error("請求額合計は0円以上にしてください。");
  return number;
}

function operationLogStatement(env, actor, action, invoiceNumber, now, detail = {}) {
  return env.DB.prepare(`INSERT INTO operation_logs (log_id, actor_user_id, action, target_type, target_id, result, detail_json, occurred_at)
    VALUES (?1, NULL, ?2, 'invoice', ?3, '成功', ?4, ?5)`)
    .bind(crypto.randomUUID(), String(action), String(invoiceNumber), JSON.stringify({ actor, ...detail }), now);
}

async function loadInvoiceByNumber(env, invoiceNumber) {
  const rows = await env.DB.prepare(`
    SELECT i.*,
      COALESCE(i.customer_code, p.customer_code, '') AS resolved_customer_code,
      COALESCE(i.partner_name, p.name, '') AS resolved_partner_name,
      COALESCE(i.honorific, p.honorific, '様') AS resolved_honorific,
      COALESCE(i.postal_code, p.postal_code, '') AS resolved_postal_code,
      COALESCE(i.prefecture, p.prefecture, '') AS resolved_prefecture,
      COALESCE(i.address1, p.address1, '') AS resolved_address1,
      COALESCE(i.address2, p.address2, '') AS resolved_address2,
      COALESCE(i.email, p.email, '') AS resolved_email,
      COALESCE(i.cc_email, p.cc_email, '') AS resolved_cc_email,
      d.status AS delivery_status, d.updated_at AS delivery_updated_at, d.first_opened_at, d.downloaded_at, d.expires_at,
      it.line_number, it.service_date, it.description, it.unit_price, it.quantity, it.unit, it.amount, it.tax_rate
    FROM invoices i JOIN partners p ON p.partner_id=i.partner_id
    LEFT JOIN deliveries d ON d.delivery_id=(SELECT d2.delivery_id FROM deliveries d2 WHERE d2.invoice_id=i.invoice_id ORDER BY d2.updated_at DESC LIMIT 1)
    LEFT JOIN invoice_items it ON it.invoice_id=i.invoice_id
    WHERE i.invoice_number=?1 AND i.deleted_at IS NULL ORDER BY it.line_number ASC
  `).bind(invoiceNumber).all();
  const first = rows.results?.[0];
  const invoice = first ? invoiceRowToClient(first) : null;
  for (const row of rows.results || []) if (row.line_number != null) invoice.details.push({
    deliveryDate: row.service_date || "", name: row.description || "", itemCode: "", unitPrice: Number(row.unit_price || 0),
    quantity: Number(row.quantity || 0), unit: row.unit || "", amount: Number(row.amount || 0), taxRate: `${Math.round(Number(row.tax_rate || 0) * 100)}%`,
  });
  if (!invoice) throw new Error("請求書が見つかりません。");
  return invoice;
}

async function updateInvoicePayment(env, invoiceNumber, input, actor) {
  if (!/^\d+$/.test(String(invoiceNumber))) throw new Error("請求書番号が不正です。");
  const status = String(input.paymentStatus || "未入金");
  if (!["未設定", "未入金", "入金済"].includes(status)) throw new Error("入金状態が不正です。");
  const date = status === "入金済" ? String(input.paymentDate || "") : "";
  if (status === "入金済" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("入金日を入力してください。");
  const amount = status === "入金済" ? strictNonNegativeMoney(input.paymentAmount) : null;
  const now = new Date().toISOString();
  const actorName = String(actor.name || actor.email || "staff").slice(0, 200);
  const update = env.DB.prepare(`UPDATE invoices SET payment_status=?1, payment_date=?2, payment_amount=?3,
    payment_memo=?4, updated_at=?5, updated_by=?6 WHERE invoice_number=?7 AND deleted_at IS NULL`)
    .bind(status, date || null, amount, status === "入金済" ? String(input.paymentMemo || "") : "", now, actorName, invoiceNumber);
  const result = await env.DB.batch([update, operationLogStatement(env, actorName, `入金状態を${status}に更新`, invoiceNumber, now, { paymentDate: date, paymentAmount: amount })]);
  if (!Number(result[0]?.meta?.changes || 0)) throw new Error("請求書が見つかりません。");
  return loadInvoiceByNumber(env, invoiceNumber);
}

async function softDeleteInvoice(env, invoiceNumber, actor) {
  if (!/^\d+$/.test(String(invoiceNumber))) return 0;
  const now = new Date().toISOString();
  const actorName = String(actor.name || actor.email || "staff").slice(0, 200);
  const invoice = await env.DB.prepare("SELECT invoice_id FROM invoices WHERE invoice_number=?1 AND deleted_at IS NULL LIMIT 1").bind(invoiceNumber).first();
  if (!invoice) return 0;
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE invoices SET deleted_at=?1, updated_at=?1, updated_by=?2 WHERE invoice_id=?3").bind(now, actorName, invoice.invoice_id),
    env.DB.prepare("UPDATE deliveries SET status='revoked', revoked_at=?1, updated_at=?1 WHERE invoice_id=?2 AND status!='revoked'").bind(now, invoice.invoice_id),
    operationLogStatement(env, actorName, "削除", invoiceNumber, now),
  ]);
  return Number(results[0]?.meta?.changes || 0);
}

async function importInvoices(request, env) {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const invoices = Array.isArray(payload.value.invoices) ? payload.value.invoices.slice(0, 100) : [];
  if (!invoices.length) return json({ ok: false, error: "NO_INVOICES" }, 400);
  const imported = [];
  for (const invoice of invoices) {
    const saved = await saveInvoiceRecord(env, invoice, { name: "apps-script-migration" }, "D1移行");
    imported.push(saved.invoiceNumber);
  }
  return json({ ok: true, imported, count: imported.length });
}

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

  if (request.method === "POST" && url.pathname === "/api/admin/migrations/invoices") {
    return importInvoices(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/deliveries") {
    return createDelivery(request, env, url);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/deliveries/batch") {
    return createDeliveryBatch(request, env, url);
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
  const invoice = payload.value.invoice || payload.value.receipt || {};
  const documentType = String(invoice.documentType || payload.value.documentType || "invoice") === "receipt" ? "receipt" : "invoice";
  const displayNumber = String(documentType === "receipt" ? invoice.receiptNumber : invoice.invoiceNumber || "").trim();
  const invoiceNumber = documentType === "receipt" ? `R${displayNumber}` : displayNumber;
  const customerCode = String(invoice.customerCode || "").trim();
  const partnerName = String(invoice.partnerName || "").trim();
  const validDocumentNumber = documentType === "receipt" ? /^\d{9}$/.test(displayNumber) : /^\d+$/.test(displayNumber);
  if (!validDocumentNumber || !customerCode || !partnerName) {
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
  const objectKey = `${documentType === "receipt" ? "receipts" : "invoices"}/${displayNumber.slice(0, 4)}/${displayNumber.slice(4, 6)}/${invoiceNumber}-${crypto.randomUUID()}.pdf`;
  const old = await env.DB.prepare("SELECT r2_object_key FROM invoices WHERE invoice_number = ?1 LIMIT 1").bind(invoiceNumber).first();
  const pdfHash = await sha256Hex(pdfBytes);
  const items = Array.isArray(invoice.details) ? invoice.details.slice(0, 100) : [];

  await env.PDFS.put(objectKey, pdfBytes, {
    httpMetadata: { contentType: "application/pdf", contentDisposition: "inline; filename=invoice.pdf", cacheControl: "private, no-store" },
    customMetadata: { invoiceNumber: displayNumber, documentType, sha256: pdfHash },
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
    `).bind(invoiceId, invoiceNumber, partnerId, String(invoice.subject || ""), String(invoice.invoiceDate || invoice.issueDate || ""), String(invoice.dueDate || ""), positiveMoney(invoice.subtotal), positiveMoney(invoice.tax), positiveMoney(invoice.total), objectKey, pdfHash, pdfBytes.byteLength, now),
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
  return json({ ok: true, invoiceId, invoiceNumber: displayNumber, documentType, objectKey, fileName: `${displayNumber}_${safeFileName(partnerName)}様_${documentType === "receipt" ? "領収書" : "請求書"}.pdf` });
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
  const expiresAt = validFutureDate(input.expiresAt) || new Date(Date.now() + positiveInt(env.PARENT_LINK_TTL_DAYS, 180) * 86400000).toISOString();
  await env.DB.prepare(`
    INSERT INTO deliveries (delivery_id, invoice_id, recipient_email, cc_email, token_hash, issued_at, expires_at, status, created_by, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?6, ?6)
    ON CONFLICT(delivery_id) DO UPDATE SET token_hash=excluded.token_hash, issued_at=excluded.issued_at,
      expires_at=excluded.expires_at, status='pending', revoked_at=NULL, updated_at=excluded.updated_at
  `).bind(deliveryId, invoice.invoice_id, String(input.recipientEmail || ""), String(input.ccEmail || ""), tokenHash, now, expiresAt, String(input.createdBy || "apps-script")).run();
  return json({ ok: true, deliveryId, expiresAt, downloadUrl: `${url.origin}/d/${token}` });
}

async function createDeliveryBatch(request, env, url) {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const inputs = Array.isArray(payload.value.items) ? payload.value.items.slice(0, 100) : [];
  if (!inputs.length) return json({ ok: false, error: "NO_DELIVERIES" }, 400);
  const invoiceNumbers = [...new Set(inputs.map(item => String(item.invoiceNumber || "").trim()).filter(Boolean))];
  if (invoiceNumbers.length !== inputs.length) return json({ ok: false, error: "INVALID_OR_DUPLICATE_INVOICE_NUMBER" }, 400);
  const placeholders = invoiceNumbers.map(() => "?").join(",");
  const invoiceRows = await env.DB.prepare(`SELECT invoice_id, invoice_number FROM invoices WHERE invoice_number IN (${placeholders})`).bind(...invoiceNumbers).all();
  const invoiceByNumber = new Map((invoiceRows.results || []).map(row => [String(row.invoice_number), String(row.invoice_id)]));
  const missing = invoiceNumbers.filter(number => !invoiceByNumber.has(number));
  if (missing.length) return json({ ok: false, error: "INVOICE_NOT_FOUND", invoiceNumbers: missing }, 404);
  const now = new Date().toISOString();
  const prepared = await Promise.all(inputs.map(async input => {
    const invoiceNumber = String(input.invoiceNumber || "").trim();
    const deliveryId = String(input.deliveryId || crypto.randomUUID()).trim();
    const token = createOpaqueToken();
    const tokenHash = await hashOpaqueToken(token);
    const expiresAt = validFutureDate(input.expiresAt) || new Date(Date.now() + positiveInt(env.PARENT_LINK_TTL_DAYS, 180) * 86400000).toISOString();
    return { input, invoiceNumber, invoiceId: invoiceByNumber.get(invoiceNumber), deliveryId, token, tokenHash, expiresAt };
  }));
  const statements = prepared.map(item => env.DB.prepare(`
    INSERT INTO deliveries (delivery_id, invoice_id, recipient_email, cc_email, token_hash, issued_at, expires_at, status, created_by, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?6, ?6)
    ON CONFLICT(delivery_id) DO UPDATE SET token_hash=excluded.token_hash, issued_at=excluded.issued_at,
      expires_at=excluded.expires_at, status='pending', revoked_at=NULL, updated_at=excluded.updated_at
  `).bind(item.deliveryId, item.invoiceId, String(item.input.recipientEmail || ""), String(item.input.ccEmail || ""), item.tokenHash, now, item.expiresAt, String(item.input.createdBy || "apps-script")));
  await env.DB.batch(statements);
  if (payload.value.revokeExisting === true) {
    const ids = prepared.map(item => item.invoiceId);
    const newDeliveryIds = prepared.map(item => item.deliveryId);
    await env.DB.prepare(`
      UPDATE deliveries SET status='revoked', revoked_at=?1, updated_at=?1
      WHERE invoice_id IN (SELECT value FROM json_each(?2))
        AND delivery_id NOT IN (SELECT value FROM json_each(?3))
        AND status!='revoked'
    `).bind(now, JSON.stringify(ids), JSON.stringify(newDeliveryIds)).run();
  }
  return json({ ok: true, items: prepared.map(item => ({ deliveryId: item.deliveryId, invoiceNumber: item.invoiceNumber, expiresAt: item.expiresAt, downloadUrl: `${url.origin}/d/${item.token}` })) });
}

async function rotateDelivery(request, env, url, deliveryId) {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const existing = await env.DB.prepare("SELECT delivery_id FROM deliveries WHERE delivery_id = ?1 LIMIT 1").bind(deliveryId).first();
  if (!existing) return json({ ok: false, error: "DELIVERY_NOT_FOUND" }, 404);
  const token = createOpaqueToken();
  const tokenHash = await hashOpaqueToken(token);
  const now = new Date().toISOString();
  const expiresAt = validFutureDate(payload.value.expiresAt) || new Date(Date.now() + positiveInt(env.PARENT_LINK_TTL_DAYS, 180) * 86400000).toISOString();
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
    invoiceNumber: String(delivery.row.invoice_number).replace(/^R/, ""),
    documentType: String(delivery.row.invoice_number).startsWith("R") ? "receipt" : "invoice",
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
  headers.set("content-disposition", `inline; filename=${object.customMetadata?.documentType === "receipt" ? "receipt" : "invoice"}.pdf`);
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
  const raw = String(value == null ? "0.1" : value).trim();
  const number = Number(raw.replace(/%$/, ""));
  if (!Number.isFinite(number) || number < 0) return 0.1;
  return raw.endsWith("%") || number > 1 ? number / 100 : number;
}

function validFutureDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) && time > Date.now() ? new Date(time).toISOString() : "";
}

function downloadPage({ token, total, invoiceNumber, partnerName, dueDate, expiresAt, documentType="invoice" }) {
  const isReceipt=documentType==="receipt",label=isReceipt?"領収書":"請求書";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>STEP${label}ダウンロード</title><style>${pageCss()}</style></head>
<body><main class="card"><div class="brand">個別指導ステップ</div>
<h1>${label}ダウンロード</h1>
<p class="lead">${escapeHtml(partnerName)} 様の${label}をご用意しました。</p>
<dl><div class="invoice-total"><dt>${isReceipt?"領収金額":"ご請求金額"}</dt><dd>${escapeHtml(formatMoney(total))}</dd></div><div><dt>${label}番号</dt><dd>${escapeHtml(invoiceNumber)}</dd></div>${isReceipt?"":`<div><dt>お支払期限</dt><dd>${escapeHtml(formatDate(dueDate))}</dd></div>`}</dl>
<a class="button" href="/d/${encodeURIComponent(token)}/pdf">${label}PDFを表示・ダウンロード</a>
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
  return `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:32px 16px;background:#f4f7fb;color:#172b4d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif}.card{max-width:680px;margin:5vh auto;background:#fff;border-radius:18px;padding:clamp(24px,6vw,48px);box-shadow:0 16px 50px #17345a1a}.brand{font-weight:800;color:#173e6b;letter-spacing:.04em}h1{font-size:clamp(24px,5vw,34px);margin:22px 0 16px}.lead{font-size:18px;line-height:1.8}dl{margin:28px 0;border:1px solid #dbe4ef;border-radius:12px;overflow:hidden}dl div{display:grid;grid-template-columns:9em 1fr;padding:14px 16px;border-bottom:1px solid #e7edf4}dl div:last-child{border-bottom:0}dt{font-size:clamp(18px,4vw,22px);font-weight:700}dd{margin:0;font-size:clamp(20px,4.5vw,26px);font-weight:400}.invoice-total{background:#f4f8fd}.invoice-total dd{font-size:clamp(20px,4.5vw,26px);font-weight:400;color:#172b4d}.button{display:block;text-align:center;padding:16px 20px;border-radius:11px;background:#174a7e;color:#fff;text-decoration:none;font-weight:800}.button:focus{outline:3px solid #ffcc33;outline-offset:3px}.download-expiry{margin:9px 0 0;text-align:center;color:#66788d;font-size:12px}.note{margin-top:20px;color:#52677f;font-size:14px;line-height:1.7}@media(max-width:520px){dl div{grid-template-columns:1fr;gap:4px}}`;
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

export const __test = { normalizeInvoice, deliveryState, positiveTaxRate };
