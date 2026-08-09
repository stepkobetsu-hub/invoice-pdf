const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const root = path.resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url: 'https://stepkobetsu-hub.github.io/invoice-pdf/',
  runScripts: 'outside-only'
});
const {window} = dom;
window.localStorage.setItem('stepStaffAppAuth', JSON.stringify({systemPortalSessionToken:'test-session'}));
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
window.HTMLDialogElement.prototype.close=function(){this.open=false;};
window.HTMLFormElement.prototype.submit=function(){
  const value=name=>this.querySelector(`[name="${name}"]`)?.value||'';
  const action=value('action'),requestId=value('requestId'),bridgeNonce=value('bridgeNonce');
  const invoices=[
    {invoiceNumber:'202608102',partnerName:'最新の取引先',honorific:'様',subject:'2026年9月分',invoiceDate:'2026/08/10',dueDate:'2026/08/31',createdAt:'2026/08/10',updatedAt:'2026/08/10 12:30:00',memo:'中2',tags:'神領',paymentStatus:'未入金',subtotal:10000,tax:1000,total:11000,email:'new@example.com',cc:'',postal:'487-0024',prefecture:'愛知県',address1:'春日井市大留町1丁目23-2',address2:'',details:[{name:'夏期講習',unitPrice:10000,quantity:1,amount:10000,taxRate:'10%'}],pdfStatus:'PDF作成済み',sendStatus:'未送信',dlStatus:'未取得',warnings:[]},
    {invoiceNumber:'202608101',partnerName:'以前の取引先',honorific:'様',subject:'2026年8月分',invoiceDate:'2026/08/09',dueDate:'2026/08/30',createdAt:'2026/08/09',updatedAt:'2026/08/09 11:00:00',memo:'中1',tags:'大手',paymentStatus:'入金済',subtotal:9000,tax:900,total:9900,email:'old@example.com',cc:'',postal:'487-0024',prefecture:'愛知県',address1:'春日井市大留町1丁目23-2',address2:'',details:[{name:'授業料',unitPrice:9000,quantity:1,amount:9000,taxRate:'10%'}],pdfStatus:'PDF作成済み',sendStatus:'送信済み',dlStatus:'未アクセス',warnings:[]}
  ];
  const data=action==='getDashboard'?{user:'テスト担当者',invoices,history:[{timestamp:'2026/08/10 10:00:00',action:'請求書作成',invoiceNumber:'202608102',sendStatus:'未送信',urlStatus:'',result:'正常'}]}:{ok:true};
  window.setTimeout(()=>window.dispatchEvent(new window.MessageEvent('message',{origin:'https://script.google.com',data:{requestId,bridgeNonce,result:{ok:true,data}}})),0);
};
window.print=()=>{};
window.confirm=()=>true;
window.fetch=async()=>({ok:true,json:async()=>({results:[]})});
window.eval(fs.readFileSync(path.join(root,'assets/core.js'),'utf8'));
window.eval(fs.readFileSync(path.join(root,'assets/invoice-pdf.js'),'utf8'));
window.eval(fs.readFileSync(path.join(root,'assets/app.js'),'utf8'));

(async()=>{
  await new Promise(resolve=>window.setTimeout(resolve,20));
  const document=window.document;
  assert.equal(document.querySelector('#view-invoices').classList.contains('active'),true);
  assert.equal(document.querySelectorAll('.app-shell > .sidebar').length,1);
  assert.equal(document.querySelectorAll('#invoiceList .invoice-list-item').length,2);
  assert.match(document.querySelector('#invoiceList .invoice-list-item:first-child').textContent,/最新の取引先/);
  assert.equal(document.querySelector('#invoiceList .invoice-list-item:first-child').classList.contains('active'),true);
  assert.match(document.querySelector('#invoiceDetailPanel').textContent,/最新の取引先/);
  assert.match(document.querySelector('.invoice-detail-column').textContent,/CSV一括追加/);
  assert.match(document.querySelector('.invoice-detail-column').textContent,/請求書を作成/);
  assert.match(document.querySelector('#invoiceDetailPanel').textContent,/編集/);
  assert.match(document.querySelector('#invoiceDetailPanel').textContent,/複製／変換/);
  assert.match(document.querySelector('#invoiceDetailPanel').textContent,/PDF／印刷/);
  assert.equal(document.querySelector('#selectedPaymentStatus summary').textContent,'未入金');
  assert.equal(document.querySelectorAll('[data-payment-value]').length,3);
  assert.ok(document.querySelector('#paymentDateDialog'));
  assert.ok(document.querySelector('[name="defaultBank"]'));
  assert.ok(document.querySelector('[name="defaultNote"]'));
  assert.ok(document.querySelector('.advanced-settings [name="apiUrl"]'));
  assert.doesNotMatch(document.querySelector('#view-invoices').textContent,/新しい請求書から順に表示しています/);
  assert.deepEqual([...document.querySelectorAll('#invoiceDateField option')].map(option=>option.textContent),['作成日','請求日','最終更新日','お支払期限日']);
  const today=new Date(),expectedFrom=`${today.getFullYear()-1}-${String(today.getMonth()+1).padStart(2,'0')}-01`,periodEnd=new Date(today.getFullYear(),today.getMonth()+2,0),expectedTo=`${periodEnd.getFullYear()}-${String(periodEnd.getMonth()+1).padStart(2,'0')}-${String(periodEnd.getDate()).padStart(2,'0')}`;
  assert.equal(document.querySelector('#invoiceDateFrom').value,expectedFrom);
  assert.equal(document.querySelector('#invoiceDateTo').value,expectedTo);
  document.querySelector('#invoiceFreeSearch').value='夏期講習';
  document.querySelector('#invoiceFreeSearch').dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.equal(document.querySelectorAll('#invoiceList .invoice-list-item').length,1);
  assert.match(document.querySelector('#invoiceList').textContent,/最新の取引先/);
  document.querySelector('#clearInvoiceSearch').click();
  assert.equal(document.querySelector('#invoiceFreeSearch').value,'');
  assert.equal(document.querySelector('#invoiceDateFrom').value,expectedFrom);
  assert.equal(document.querySelector('#invoiceDateTo').value,expectedTo);
  document.querySelector('#invoiceDateField').value='invoiceDate';
  document.querySelector('#invoiceDateFrom').value='2026-08-09';
  document.querySelector('#invoiceDateTo').value='2026-08-09';
  document.querySelector('#invoiceDateTo').dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(document.querySelectorAll('#invoiceList .invoice-list-item').length,1);
  assert.match(document.querySelector('#invoiceList').textContent,/以前の取引先/);
  document.querySelector('#clearInvoiceSearch').click();
  assert.equal(document.querySelector('#invoiceDateFrom').value,'2026-08-09');
  assert.equal(document.querySelector('#invoiceDateTo').value,'2026-08-09');
  document.querySelector('#invoiceDateField').value='createdAt';
  document.querySelector('#invoiceDateFrom').value=expectedFrom;
  document.querySelector('#invoiceDateTo').value=expectedTo;
  document.querySelector('#invoiceDateTo').dispatchEvent(new window.Event('change',{bubbles:true}));
  const manualUnitPrice=document.querySelector('[name="detailUnitPrice"]');manualUnitPrice.value='-10000';assert.equal(manualUnitPrice.checkValidity(),true);
  document.querySelector('[data-invoice-action="edit"]').click();
  const editUnitPrice=document.querySelector('[name="editDetailUnitPrice"]');editUnitPrice.value='-10000';assert.equal(editUnitPrice.checkValidity(),true);
  document.querySelector('#editInvoiceDialog').close();
  document.querySelector('#invoiceList .invoice-list-item:first-child').click();
  document.querySelector('[data-invoice-tab="history"]').click();
  assert.match(document.querySelector('#invoiceDetailPanel').textContent,/請求書作成/);
  document.querySelector('[data-invoice-action="mail"]').click();
  assert.equal(document.querySelector('#invoiceMailDialog').open,true);
  assert.match(document.querySelector('#invoiceMailDialog').textContent,/請求書メールの確認/);
  const worker=fs.readFileSync(path.join(root,'cloudflare/src/index.js'),'utf8');
  assert.match(worker,/ご請求金額<\/dt>/);
  assert.match(worker,/請求書番号<\/dt>/);
  assert.match(worker,/お支払期限<\/dt>/);
  assert.match(worker,/ダウンロード期限：/);
  assert.doesNotMatch(worker,/請求日<\/dt>/);
  console.log('invoice workspace tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
