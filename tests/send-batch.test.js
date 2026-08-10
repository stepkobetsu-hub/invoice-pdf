const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const context = vm.createContext({console});
vm.runInContext(source, context, {filename:'Code.gs'});

const prepared = Array.from({length:100}, (_, index) => ({version:{
  to:[{email:`dummy-${String(index + 1).padStart(3, '0')}@example.com`, name:`ダミー取引先${index + 1}`}],
  subject:`【テスト】請求書 ${index + 1}`,
  htmlContent:`<html><body>ダミー請求書 ${index + 1}</body></html>`,
}}));
const started = process.hrtime.bigint();
const payload = vm.runInContext('buildBrevoBatchPayload_', context)(prepared, {
  senderEmail:'invoice@step-edu.net', senderName:'個別指導ステップ【請求書】', replyTo:'stepkobetsu@gmail.com'
}, '11111111-2222-4333-8444-555555555555', true);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

assert.equal(payload.messageVersions.length, 100);
assert.equal(new Set(payload.messageVersions.map(item => item.to[0].email)).size, 100);
assert.equal(payload.headers.idempotencyKey, '11111111-2222-4333-8444-555555555555');
assert.equal(payload.headers['X-Sib-Sandbox'], 'drop');
assert.equal(payload.sender.email, 'invoice@step-edu.net');
assert.ok(elapsedMs < 1000, `100件のバッチ構築が遅すぎます: ${elapsedMs.toFixed(1)}ms`);

const limited = vm.runInContext('buildBrevoBatchPayload_', context)(prepared.concat(prepared), {}, 'batch-limit', false);
assert.equal(limited.messageVersions.length, 100);
assert.equal(limited.headers['X-Sib-Sandbox'], undefined);
assert.match(source, /attempts<3/);
assert.match(source, /getSendBatchStatus_/);
assert.match(source, /idempotencyKey/);

console.log(`100-message Brevo sandbox batch checks passed in ${elapsedMs.toFixed(1)}ms.`);
