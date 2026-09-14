const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('billing-home.html','utf8');

assert.match(html,/高速ホームは調整中です/);
assert.match(html,/正確な請求金額を表示できないため/);
assert.match(html,/正しい請求管理画面を開く/);
assert.match(html,/AKfycbxzkE1tQRyB_Ca4bfPKYWIkpTukIVPMWKf2ETE7yN7qROJk0VyOlvxaJ9GGI5p-6pGb/);
assert.doesNotMatch(html,/billing-home\.js/);
assert.doesNotMatch(html,/Cloudflare D1に保存済みの請求書を読み取り/);
console.log('disabled billing fast home tests passed');
