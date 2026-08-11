const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../apps-script/Code.gs'), 'utf8');
const enqueue = source.match(/function enqueueSend_\([\s\S]*?\r?\n}\r?\n\r?\nfunction sendOne_/)[0];
const receiptEnqueue = source.match(/function enqueueReceiptSend_\([\s\S]*?\r?\n}\r?\n\r?\nfunction replaceReceiptDetails_/)[0];

assert.match(enqueue, /createCloudflareDeliveriesBatch_\([\s\S]*?\),false\)/,
  'a resend must issue a new URL without revoking prior email links');
assert.doesNotMatch(enqueue, /markInvoicesInvalidated_\(/,
  'invoice resend must not invalidate prior email links');
assert.doesNotMatch(receiptEnqueue, /invalidateByInvoice_\(/,
  'receipt resend must not invalidate prior email links');
assert.match(source, /function deleteInvoice_[\s\S]*?invalidateByInvoice_\(number\)/,
  'deleting an invoice must still revoke its links');
assert.match(source, /function disableDelivery_[\s\S]*?invalidateByInvoice_\(String\(invoiceNumber\)\)/,
  'explicit disable must still revoke invoice links');

console.log('resend link retention checks passed');
