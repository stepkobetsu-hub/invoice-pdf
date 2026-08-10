import { normalizeBankTransaction, normalizePayerName, rankInvoiceCandidates, transactionFingerprint } from "./bank-reconciliation.js";

const actorName = (actor) => String(actor?.name || actor?.email || "staff").slice(0, 200);
const id = (prefix) => `${prefix}:${crypto.randomUUID()}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function audit(env, action, actor, now, transactionId, invoiceId = null, matchId = null, detail = {}) {
  return env.DB.prepare(`INSERT INTO payment_match_audit_logs
    (audit_id, bank_transaction_id, invoice_id, match_id, action, actor, detail_json, occurred_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id("payment-audit"), transactionId, invoiceId, matchId, action, actorName(actor), JSON.stringify(detail), now);
}

export async function importNormalizedBankTransactions(env, input, actor) {
  const sourceType = String(input?.sourceType || "smbc_web21_csv");
  const accountHash = await sha256(input?.accountIdentifier || "smbc:trunk-north:default");
  const fileHash = String(input?.fileSha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(fileHash)) throw new Error("BANK_FILE_HASH_REQUIRED");
  const rows = Array.isArray(input?.transactions) ? input.transactions.slice(0, 5000) : [];
  if (!rows.length) throw new Error("BANK_TRANSACTIONS_REQUIRED");
  const existingBatch = await env.DB.prepare(`SELECT batch_id FROM bank_import_batches
    WHERE source_type=?1 AND account_identifier_hash=?2 AND file_sha256=?3 LIMIT 1`)
    .bind(sourceType, accountHash, fileHash).first();
  if (existingBatch) return { importedCount: 0, duplicateCount: rows.length, ignoredWithdrawalCount: 0, batchId: existingBatch.batch_id };

  const now = new Date().toISOString();
  const batchId = id("bank-batch");
  let importedCount = 0;
  let duplicateCount = 0;
  let ignoredWithdrawalCount = 0;
  const statements = [];
  const fingerprints = new Set();
  for (const raw of rows) {
    const transaction = normalizeBankTransaction(raw);
    if (transaction.depositAmount <= 0) { ignoredWithdrawalCount += 1; continue; }
    const fingerprint = await transactionFingerprint(sourceType, accountHash, transaction);
    if (fingerprints.has(fingerprint)) { duplicateCount += 1; continue; }
    fingerprints.add(fingerprint);
    const duplicate = await env.DB.prepare("SELECT 1 AS found FROM bank_transactions WHERE fingerprint_sha256=?1 LIMIT 1").bind(fingerprint).first();
    if (duplicate) { duplicateCount += 1; continue; }
    importedCount += 1;
    statements.push(env.DB.prepare(`INSERT INTO bank_transactions
      (bank_transaction_id, source_type, source_transaction_id, account_identifier_hash, fingerprint_sha256,
       transaction_date, description_raw, payer_name_raw, payer_name_normalized, deposit_amount, withdrawal_amount,
       currency, reconciliation_status, import_batch_id, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', ?13, ?14, ?14)`)
      .bind(id("bank-transaction"), sourceType, transaction.sourceTransactionId || null, accountHash, fingerprint,
        transaction.transactionDate, transaction.descriptionRaw, transaction.payerNameRaw || null,
        transaction.payerNameNormalized, transaction.depositAmount, transaction.withdrawalAmount,
        transaction.currency, batchId, now));
  }
  const batch = env.DB.prepare(`INSERT INTO bank_import_batches
    (batch_id, source_type, account_identifier_hash, file_sha256, original_file_name, imported_count,
     duplicate_count, imported_by, imported_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(batchId, sourceType, accountHash, fileHash, String(input?.fileName || "").slice(0, 255),
      importedCount, duplicateCount, actorName(actor), now);
  await env.DB.batch([batch, ...statements]);
  return { importedCount, duplicateCount, ignoredWithdrawalCount, batchId };
}

export async function loadBankReconciliation(env) {
  const [transactions, invoices, aliases] = await Promise.all([
    env.DB.prepare(`SELECT * FROM bank_transactions ORDER BY transaction_date DESC, created_at DESC LIMIT 500`).all(),
    env.DB.prepare(`SELECT i.invoice_id, i.invoice_number, i.partner_id, i.customer_code,
      COALESCE(i.partner_name,p.name,'') AS partner_name, COALESCE(p.name_kana,'') AS partner_name_kana,
      i.subject_month, i.issue_date, i.due_date, i.total, i.payment_status
      FROM invoices i JOIN partners p ON p.partner_id=i.partner_id
      WHERE i.deleted_at IS NULL AND i.payment_status='未入金' AND i.invoice_number NOT LIKE 'R%'
      ORDER BY i.due_date DESC`).all(),
    env.DB.prepare("SELECT * FROM payer_aliases WHERE active=1").all(),
  ]);
  const invoiceRows = (invoices.results || []).map((row) => ({
    invoiceId: row.invoice_id, invoiceNumber: row.invoice_number, partnerId: row.partner_id,
    customerCode: row.customer_code, partnerName: row.partner_name, contactName: row.partner_name_kana,
    studentName: "", subject: row.subject_month, invoiceDate: row.issue_date, dueDate: row.due_date,
    total: Number(row.total || 0), paymentStatus: row.payment_status,
  }));
  const aliasRows = (aliases.results || []).map((row) => ({
    payerNameNormalized: row.payer_name_normalized, payerNameRaw: row.payer_name_raw,
    partnerId: row.partner_id, active: Boolean(row.active),
  }));
  return {
    transactions: (transactions.results || []).map((row) => ({
      bankTransactionId: row.bank_transaction_id, transactionDate: row.transaction_date,
      descriptionRaw: row.description_raw, payerNameRaw: row.payer_name_raw || "",
      payerNameNormalized: row.payer_name_normalized || "", depositAmount: Number(row.deposit_amount),
      status: row.reconciliation_status, excludedReason: row.excluded_reason || "",
      candidates: ["pending", "candidate", "review"].includes(row.reconciliation_status)
        ? rankInvoiceCandidates({ ...row, transactionDate: row.transaction_date, payerNameRaw: row.payer_name_raw,
          payerNameNormalized: row.payer_name_normalized, depositAmount: Number(row.deposit_amount) }, invoiceRows, aliasRows)
        : [],
    })),
  };
}

export async function confirmBankMatch(env, transactionId, invoiceNumber, actor) {
  const [transaction, invoice] = await Promise.all([
    env.DB.prepare("SELECT * FROM bank_transactions WHERE bank_transaction_id=?1 LIMIT 1").bind(transactionId).first(),
    env.DB.prepare(`SELECT invoice_id, invoice_number, partner_id, total, payment_status
      FROM invoices WHERE invoice_number=?1 AND deleted_at IS NULL LIMIT 1`).bind(invoiceNumber).first(),
  ]);
  if (!transaction || transaction.reconciliation_status === "matched") throw new Error("BANK_TRANSACTION_NOT_AVAILABLE");
  if (!invoice || invoice.payment_status !== "未入金") throw new Error("INVOICE_NOT_UNPAID");
  if (Number(transaction.deposit_amount) !== Number(invoice.total)) throw new Error("AMOUNT_MISMATCH_REQUIRES_REVIEW");
  const now = new Date().toISOString();
  const matchId = id("payment-match");
  const aliasId = id("payer-alias");
  const actorValue = actorName(actor);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO invoice_payment_matches
      (match_id, bank_transaction_id, invoice_id, matched_amount, match_status, confidence_level,
       match_reasons_json, match_method, confirmed_at, confirmed_by, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, 'confirmed', 'high', ?5, 'bank_csv_manual_match', ?6, ?7, ?6, ?6)`)
      .bind(matchId, transactionId, invoice.invoice_id, Number(transaction.deposit_amount), JSON.stringify(["人による承認", "金額完全一致"]), now, actorValue),
    env.DB.prepare(`UPDATE invoices SET payment_status='入金済', payment_date=?1, payment_amount=?2,
      payment_memo=?3, updated_at=?4, updated_by=?5 WHERE invoice_id=?6 AND payment_status='未入金'`)
      .bind(transaction.transaction_date, Number(transaction.deposit_amount), `銀行CSV消込 ${transaction.payer_name_raw || transaction.description_raw}`, now, actorValue, invoice.invoice_id),
    env.DB.prepare("UPDATE bank_transactions SET reconciliation_status='matched', updated_at=?1 WHERE bank_transaction_id=?2")
      .bind(now, transactionId),
    env.DB.prepare(`INSERT INTO payer_aliases
      (alias_id, payer_name_normalized, payer_name_raw, partner_id, learned_from_match_id, active, created_by, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?7)
      ON CONFLICT(payer_name_normalized, partner_id) DO UPDATE SET payer_name_raw=excluded.payer_name_raw,
       learned_from_match_id=excluded.learned_from_match_id, active=1, updated_at=excluded.updated_at`)
      .bind(aliasId, normalizePayerName(transaction.payer_name_normalized || transaction.payer_name_raw || transaction.description_raw),
        transaction.payer_name_raw || transaction.description_raw, invoice.partner_id, matchId, actorValue, now),
    audit(env, "match_confirmed", actor, now, transactionId, invoice.invoice_id, matchId, { invoiceNumber, amount: transaction.deposit_amount }),
  ]);
  return { matchId, invoiceNumber };
}

export async function cancelBankMatch(env, transactionId, reason, actor) {
  const match = await env.DB.prepare(`SELECT m.*, i.invoice_number FROM invoice_payment_matches m
    JOIN invoices i ON i.invoice_id=m.invoice_id WHERE m.bank_transaction_id=?1 AND m.match_status='confirmed' LIMIT 1`)
    .bind(transactionId).first();
  if (!match) throw new Error("CONFIRMED_MATCH_NOT_FOUND");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE invoice_payment_matches SET match_status='cancelled', cancelled_at=?1,
      cancelled_by=?2, cancellation_reason=?3, updated_at=?1 WHERE match_id=?4`)
      .bind(now, actorName(actor), String(reason || "取消").slice(0, 500), match.match_id),
    env.DB.prepare(`UPDATE invoices SET payment_status='未入金', payment_date=NULL, payment_amount=NULL,
      payment_memo='', updated_at=?1, updated_by=?2 WHERE invoice_id=?3`).bind(now, actorName(actor), match.invoice_id),
    env.DB.prepare("UPDATE bank_transactions SET reconciliation_status='pending', updated_at=?1 WHERE bank_transaction_id=?2").bind(now, transactionId),
    env.DB.prepare("UPDATE payer_aliases SET active=0, updated_at=?1 WHERE learned_from_match_id=?2").bind(now, match.match_id),
    audit(env, "match_cancelled", actor, now, transactionId, match.invoice_id, match.match_id, { reason: String(reason || "取消") }),
  ]);
  return { invoiceNumber: match.invoice_number };
}

export async function setBankTransactionExcluded(env, transactionId, excluded, reason, actor) {
  const row = await env.DB.prepare("SELECT reconciliation_status FROM bank_transactions WHERE bank_transaction_id=?1 LIMIT 1").bind(transactionId).first();
  if (!row || row.reconciliation_status === "matched") throw new Error("BANK_TRANSACTION_NOT_AVAILABLE");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE bank_transactions SET reconciliation_status=?1, excluded_reason=?2,
      excluded_at=?3, excluded_by=?4, updated_at=?3 WHERE bank_transaction_id=?5`)
      .bind(excluded ? "excluded" : "pending", excluded ? String(reason || "請求書対象外").slice(0, 500) : null,
        now, excluded ? actorName(actor) : null, transactionId),
    audit(env, excluded ? "transaction_excluded" : "transaction_unexcluded", actor, now, transactionId, null, null, { reason }),
  ]);
}
