import assert from "node:assert/strict";
import { normalizeBankTransaction, normalizePayerName, rankInvoiceCandidates, transactionFingerprint } from "../src/bank-reconciliation.js";

assert.equal(normalizePayerName("振込 ｱｵｷ ｱｷｺ"), "アオキアキコ");
assert.equal(normalizePayerName("ふりこみ　あおき あきこ"), "アオキアキコ");

const transaction = normalizeBankTransaction({
  transactionDate: "2026-08-10", descriptionRaw: "振込 ヤマダ ハナコ", payerNameRaw: "ﾔﾏﾀﾞ ﾊﾅｺ", depositAmount: 31275,
});
assert.equal(transaction.payerNameNormalized, "ヤマダハナコ");
assert.equal(transaction.withdrawalAmount, 0);

const invoices = [
  { invoiceNumber: "202608001", customerCode: "1001", partnerName: "山田 太郎", total: 31275, paymentStatus: "未入金", invoiceDate: "2026-08-01", dueDate: "2026-08-31" },
  { invoiceNumber: "202608002", customerCode: "1002", partnerName: "別人", total: 30000, paymentStatus: "未入金", invoiceDate: "2026-08-01", dueDate: "2026-08-31" },
];
const aliases = [{ payerNameNormalized: "ヤマダハナコ", customerCode: "1001", active: true }];
const ranked = rankInvoiceCandidates(transaction, invoices, aliases);
assert.equal(ranked[0].invoiceNumber, "202608001");
assert.equal(ranked[0].amountExact, true);
assert.equal(ranked[0].confidenceLevel, "high");
assert.match(ranked[0].reasons.join(","), /過去に承認した/);

const first = await transactionFingerprint("smbc_web21_csv", "account-hash", transaction);
const second = await transactionFingerprint("smbc_web21_csv", "account-hash", { ...transaction });
assert.equal(first, second);
assert.equal(first.length, 64);

console.log("Bank reconciliation domain checks passed.");
