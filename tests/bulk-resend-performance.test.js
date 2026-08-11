const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../apps-script/Code.gs'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../assets/app.js'), 'utf8');
const enqueue = source.match(/function enqueueSend_\([\s\S]*?\r?\n}\r?\n\r?\nfunction releasePreparedSend_/)[0];
const bulkInvalidate = source.match(/function invalidateByInvoicesBulk_\([\s\S]*?\r?\n}\r?\n/)[0];

assert.doesNotMatch(enqueue, /numbers\.map\([\s\S]*?invalidateByInvoice_\(/, '100件の再送で旧URLを1件ずつ無効化してはいけない');
assert.match(enqueue, /createCloudflareDeliveriesParallel_\([\s\S]*?invalidateByInvoicesBulk_\(numbers,deliverySheet,deliveries\)/, '新URLの一括作成後に旧URLを一括無効化する');
assert.match(bulkInvalidate, /UrlFetchApp\.fetchAll\(requests\)/, 'Cloudflareの無効化は並列実行する');
assert.match(bulkInvalidate, /flushTableRows_\(sh,table\)/, '配信履歴の更新は一括書込みする');
assert.match(app, /\['未送信','無効化','送信失敗'\]\.includes/, '途中失敗で無効化された請求書を再び送信可能にする');

console.log('bulk resend performance checks passed');
