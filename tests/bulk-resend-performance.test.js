const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../apps-script/Code.gs'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../assets/app.js'), 'utf8');
const enqueue = source.match(/function enqueueSend_\([\s\S]*?\r?\n}\r?\n\r?\nfunction sendOne_/)[0];
const bulkInvalidate = source.match(/function markInvoicesInvalidated_\([\s\S]*?\r?\n}\r?\n/)[0];

assert.doesNotMatch(enqueue, /numbers\.map\([\s\S]*?invalidateByInvoice_\(/, '100件の再送で旧URLを1件ずつ無効化してはいけない');
assert.match(enqueue, /createCloudflareDeliveriesBatch_\([\s\S]*?markInvoicesInvalidated_\(numbers,deliverySheet,deliveries\)/, 'Cloudflare側の一括APIで新URL作成と旧URL無効化を行う');
assert.doesNotMatch(bulkInvalidate, /UrlFetchApp/, 'Apps Script側で旧URLを1件ずつ無効化してはいけない');
assert.match(bulkInvalidate, /getRangeList\(ranges\)\.setValue/, '配信履歴の無効化はRangeListで一括書込みする');
assert.match(app, /\['未送信','無効化','送信失敗'\]\.includes/, '途中失敗で無効化された請求書を再び送信可能にする');
assert.match(app, /await ensurePdfsForSend\(groups\.unsent\);groups=classifyQueueSelection\(groups\.selected\)/, '再送済み請求書のPDFをブラウザで再生成してはいけない');
assert.doesNotMatch(app, /ensurePdfsForSend\(\[\.\.\.groups\.unsent,\.\.\.groups\.resend\]\)/, '100件再送で全PDFを再生成してはいけない');
assert.doesNotMatch(source, /prepareSend:|releasePreparedSend:|function releasePreparedSend_/, '旧テスト送信モードの経路を残してはいけない');
assert.doesNotMatch(source, /subject='【テスト】'|これはテスト送信です/, '通常送信本文をテスト送信へ差し替えてはいけない');

console.log('bulk resend performance checks passed');
