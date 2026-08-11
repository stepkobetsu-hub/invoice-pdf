const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const root = path.resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url:'https://stepkobetsu-hub.github.io/invoice-pdf/#invoices',
  runScripts:'outside-only'
});
const {window} = dom;
const actions = [];
const d1Invoices = [];
let legacyInvoices = [];

window.localStorage.setItem('stepStaffAppAuth', JSON.stringify({systemPortalSessionToken:'test-session'}));
window.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
window.HTMLDialogElement.prototype.close = function(){ this.open = false; };
window.HTMLFormElement.prototype.submit = function(){
  const value = name => this.querySelector(`[name="${name}"]`)?.value || '';
  const requestId = value('requestId'), bridgeNonce = value('bridgeNonce'), action = value('action');
  const payload = JSON.parse(value('payload') || '{}');
  actions.push(action);
  let data = {};
  if(action === 'getSupportData') data = {partners:window.StepInvoiceCore.DEMO_PARTNERS};
  if(action === 'saveInvoiceData') legacyInvoices = [{...payload.invoice}];
  if(action === 'savePdf') data = {pdfFileId:'pdf-test',pdfFileName:'test.pdf'};
  if(action === 'processPendingSends'){
    legacyInvoices = legacyInvoices.map(invoice => ({...invoice,sendStatus:'送信済み',sentAt:'2026/08/11 20:00:00'}));
    data = {pending:0,failed:0};
  }
  if(action === 'getDashboard') data = {invoices:legacyInvoices,history:[{timestamp:'2026/08/11 20:00:00',action:'メール送信',invoiceNumber:legacyInvoices[0]?.invoiceNumber,sendStatus:'送信済み'}]};
  window.setTimeout(() => window.dispatchEvent(new window.MessageEvent('message', {
    origin:'https://script.google.com',
    data:{requestId,bridgeNonce,result:{ok:true,data}}
  })), 0);
};
window.print = () => {};
window.fetch = async(url, options={}) => {
  if(String(url).endsWith('/api/app/dashboard')) return {ok:true,json:async()=>({ok:true,data:{invoices:d1Invoices.map(invoice=>({...invoice})),history:[],user:'テスト担当者'}})};
  if(String(url).endsWith('/api/app/invoices') && options.method === 'POST'){
    const invoice = {...JSON.parse(options.body).invoice,sendStatus:'未送信',dlStatus:'未取得',pdfStatus:'未作成',warnings:[]};
    d1Invoices.push(invoice);
    return {ok:true,json:async()=>({ok:true,data:{invoice}})};
  }
  return {ok:true,json:async()=>({results:[]})};
};

window.eval(fs.readFileSync(path.join(root, 'assets/core.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(root, 'assets/invoice-pdf.js'), 'utf8'));
window.StepInvoicePdf.toBlob = async() => new window.Blob(['pdf'], {type:'application/pdf'});
window.eval(fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8'));

(async()=>{
  const document = window.document;
  await new Promise(resolve => window.setTimeout(resolve, 30));
  assert.equal(document.querySelector('#saveAndSendSingleInvoice').classList.contains('hidden'), true);

  document.querySelector('#createDemoInvoiceFromList').click();
  await new Promise(resolve => window.setTimeout(resolve, 30));
  const sendButton = document.querySelector('#saveAndSendSingleInvoice');
  assert.equal(sendButton.classList.contains('hidden'), false);
  assert.equal(sendButton.textContent, '保存して送信');

  document.querySelector('#singlePartnerCombo > button').click();
  document.querySelector('#singlePartnerResults [data-partner-code="DEMO001"]').click();
  const form = document.querySelector('#singleInvoiceForm');
  const submitEvent = new window.Event('submit', {bubbles:true,cancelable:true});
  Object.defineProperty(submitEvent, 'submitter', {value:sendButton});
  form.dispatchEvent(submitEvent);
  await new Promise(resolve => window.setTimeout(resolve, 700));

  for(const action of ['saveInvoiceData','savePdf','enqueueSend','processPendingSends','getDashboard']) assert.ok(actions.includes(action), `${action} was not called`);
  assert.equal(window.StepInvoiceApp.state.invoices.length, 1);
  assert.equal(window.StepInvoiceApp.state.invoices[0].sendStatus, '送信済み');
  assert.match(document.querySelector('#invoiceList').textContent, /送信済み/);
  assert.equal(document.querySelector('#view-invoices').classList.contains('active'), true);
  assert.match(document.querySelector('#globalAlert').textContent, /保存し、メール送信しました/);
  console.log('demo save and send checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

