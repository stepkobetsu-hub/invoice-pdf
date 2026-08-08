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
window.eval(fs.readFileSync(path.join(root, 'assets/core.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8'));

async function main(){
  const document=window.document;
  document.querySelector('[data-create-method="single"]').click();
  assert.equal(document.querySelector('#createSinglePane').classList.contains('active'),true);

  document.querySelector('#loadDemoPartners').click();
  await new Promise(resolve=>window.setTimeout(resolve,0));
  assert.equal(document.querySelectorAll('#partnerTable tbody tr').length,4);
  assert.equal(document.querySelectorAll('#singlePartner option').length,5);
  assert.match(document.querySelector('#partnerTable').textContent,/mintcocoajasmine@gmail\.com/);
  assert.match(document.querySelector('#partnerTable').textContent,/kk8989892000@yahoo\.co\.jp/);
  assert.match(document.querySelector('#partnerTable').textContent,/skase\.days@gmail\.com/);
  assert.match(document.querySelector('#partnerTable').textContent,/chloeandnina1@gmail\.com/);

  const form=document.querySelector('#singleInvoiceForm');
  form.elements.partnerCode.value='DEMO001';
  form.elements.invoiceNumber.value='202608501';
  form.elements.subject.value='2026年8月分';
  form.elements.invoiceDate.value='2026-08-09';
  form.elements.dueDate.value='2026-08-31';
  document.querySelector('[name="detailName"]').value='授業料';
  document.querySelector('[name="detailUnitPrice"]').value='25000';
  document.querySelector('[name="detailQuantity"]').value='1';
  document.querySelector('[name="detailUnitPrice"]').dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.equal(document.querySelector('#singleTotal').textContent,'27,500円');
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(document.querySelector('#createTable tbody').textContent,/202608501/);
  assert.match(document.querySelector('#createTable tbody').textContent,/ダミー取引先1/);
  console.log('ui tests passed');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
