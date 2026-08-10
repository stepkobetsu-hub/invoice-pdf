export function normalizePayerName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/(?:振込|振込み|振り込み|フリコミ|FURIKOMI|入金)/g, "")
    .replace(/[\s　・･._\-ー（）()\[\]【】]/g, "")
    .trim();
}

export function normalizeBankTransaction(input) {
  const transactionDate = String(input?.transactionDate || "").trim();
  const descriptionRaw = String(input?.descriptionRaw || "").trim();
  const payerNameRaw = String(input?.payerNameRaw || "").trim();
  const depositAmount = Math.round(Number(input?.depositAmount || 0));
  const withdrawalAmount = Math.round(Number(input?.withdrawalAmount || 0));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) throw new Error("BANK_TRANSACTION_DATE_INVALID");
  if (!descriptionRaw) throw new Error("BANK_TRANSACTION_DESCRIPTION_REQUIRED");
  if (!Number.isFinite(depositAmount) || depositAmount < 0 || !Number.isFinite(withdrawalAmount) || withdrawalAmount < 0) {
    throw new Error("BANK_TRANSACTION_AMOUNT_INVALID");
  }
  return {
    sourceTransactionId: String(input?.sourceTransactionId || "").trim(),
    transactionDate,
    descriptionRaw,
    payerNameRaw,
    payerNameNormalized: normalizePayerName(payerNameRaw || descriptionRaw),
    depositAmount,
    withdrawalAmount,
    currency: String(input?.currency || "JPY").trim().toUpperCase() || "JPY",
  };
}

export async function transactionFingerprint(sourceType, accountIdentifierHash, transaction) {
  const stable = [
    String(sourceType || ""),
    String(accountIdentifierHash || ""),
    transaction.sourceTransactionId || "",
    transaction.transactionDate,
    transaction.depositAmount,
    transaction.withdrawalAmount,
    transaction.descriptionRaw.normalize("NFKC"),
  ].join("\u001f");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dateDistanceDays(a, b) {
  const left = Date.parse(String(a || ""));
  const right = Date.parse(String(b || ""));
  return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) / 86400000 : Infinity;
}

export function scoreInvoiceCandidate(transaction, invoice, aliases = []) {
  let score = 0;
  const reasons = [];
  const amountExact = Number(transaction.depositAmount) === Number(invoice.total);
  if (amountExact) { score += 70; reasons.push("金額完全一致"); }
  else {
    const difference = Math.abs(Number(transaction.depositAmount) - Number(invoice.total));
    const ratio = Number(invoice.total) > 0 ? difference / Number(invoice.total) : 1;
    if (ratio <= 0.05) { score += 15; reasons.push("金額が近い（要確認）"); }
    else reasons.push("金額不一致");
  }
  const payer = normalizePayerName(transaction.payerNameNormalized || transaction.payerNameRaw);
  const names = [invoice.partnerName, invoice.contactName, invoice.studentName].map(normalizePayerName).filter(Boolean);
  if (payer && names.includes(payer)) { score += 20; reasons.push("振込名義と氏名が一致"); }
  const aliasHit = aliases.some((alias) => alias.active !== false && normalizePayerName(alias.payerNameNormalized || alias.payerNameRaw) === payer
    && String(alias.partnerId || alias.customerCode) === String(invoice.partnerId || invoice.customerCode));
  if (aliasHit) { score += 25; reasons.push("過去に承認した振込名義"); }
  const dueDistance = dateDistanceDays(transaction.transactionDate, invoice.dueDate);
  const issueDistance = dateDistanceDays(transaction.transactionDate, invoice.invoiceDate);
  if (dueDistance <= 31 || issueDistance <= 62) { score += 5; reasons.push("請求期間が近い"); }
  return {
    invoiceNumber: invoice.invoiceNumber,
    score,
    confidenceLevel: amountExact && (aliasHit || names.includes(payer)) ? "high" : amountExact ? "medium" : "low",
    amountExact,
    reasons,
    requiresManualReview: !amountExact,
  };
}

export function rankInvoiceCandidates(transaction, invoices, aliases = [], limit = 5) {
  return (Array.isArray(invoices) ? invoices : [])
    .filter((invoice) => String(invoice.paymentStatus || "") === "未入金")
    .map((invoice) => ({ invoice, ...scoreInvoiceCandidate(transaction, invoice, aliases) }))
    .filter((candidate) => candidate.score >= 20)
    .sort((a, b) => b.score - a.score || String(a.invoice.dueDate || "").localeCompare(String(b.invoice.dueDate || "")))
    .slice(0, limit);
}
