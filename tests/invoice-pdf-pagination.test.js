const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>');
const window = dom.window;
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'assets', 'invoice-pdf.js'), 'utf8'),
  { window, document: window.document, MutationObserver: window.MutationObserver, console }
);

const invoice = {
  invoiceNumber: '202608127',
  partnerName: '加瀬智子',
  honorific: '様',
  postal: '485-0802',
  prefecture: '愛知県',
  address1: '春日井市',
  address2: '',
  customerCode: '1320',
  invoiceDate: '2026-08-12',
  dueDate: '2026-09-02',
  subject: '2026年8月分',
  subtotal: 17,
  tax: 2,
  total: 19,
  bank: '振込先',
  note: '備考',
  details: Array.from({ length: 17 }, (_, index) => ({
    name: `明細${index + 1}`,
    unitPrice: 1,
    quantity: 1,
    amount: 1
  }))
};

const host = window.document.createElement('div');
host.innerHTML = window.StepInvoicePdf.pageHtml(invoice);
const pages = host.querySelectorAll('.invoice-page');
assert.equal(pages.length, 3);
assert.match(pages[0].textContent, /明細1/);
assert.match(pages[0].textContent, /明細8/);
assert.doesNotMatch(pages[0].textContent, /明細9/);
assert.match(pages[1].textContent, /明細9/);
assert.match(pages[1].textContent, /明細16/);
assert.match(pages[2].textContent, /明細17/);
assert.equal(host.querySelectorAll('.totals').length, 1);
assert.match(pages[0].textContent, /1 \/ 3/);
assert.match(pages[1].textContent, /2 \/ 3/);
assert.match(pages[2].textContent, /3 \/ 3/);

const singlePageHost = window.document.createElement('div');
singlePageHost.innerHTML = window.StepInvoicePdf.pageHtml({ ...invoice, details: invoice.details.slice(0, 8) });
assert.equal(singlePageHost.querySelectorAll('.invoice-page').length, 1);
assert.equal(singlePageHost.querySelectorAll('.totals').length, 1);
assert.match(singlePageHost.textContent, /1 \/ 1/);

let addPageCount = 0;
let addImageCount = 0;
window.html2canvas = async () => ({ toDataURL: () => 'data:image/png;base64,AA==' });
window.jspdf = {
  jsPDF: class {
    addPage() { addPageCount += 1; }
    addImage() { addImageCount += 1; }
    output() { return new window.Blob(['pdf'], { type: 'application/pdf' }); }
  }
};

window.StepInvoicePdf.toBlob(host).then(blob => {
  assert.equal(blob.type, 'application/pdf');
  assert.equal(addPageCount, 2);
  assert.equal(addImageCount, 3);
  console.log('invoice PDF pagination tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
