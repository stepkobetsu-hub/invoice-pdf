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
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
window.HTMLDialogElement.prototype.close=function(){this.open=false;};
window.print=()=>{};
window.eval(fs.readFileSync(path.join(root, 'assets/core.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(root, 'assets/invoice-pdf.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8'));

async function main(){
  const document=window.document;
  document.querySelector('[data-create-method="single"]').click();
  assert.equal(document.querySelector('#createSinglePane').classList.contains('active'),true);
  assert.match(document.querySelector('[name="invoiceNumber"]').value,/^\d{9}$/);
  assert.equal(document.querySelector('[name="invoiceNumber"]').readOnly,true);
  const invoiceDate=document.querySelector('[name="invoiceDate"]').value;
  const dueDate=document.querySelector('[name="dueDate"]').value;
  assert.equal((new Date(`${dueDate}T00:00:00`)-new Date(`${invoiceDate}T00:00:00`))/86400000,21);

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
  document.querySelector('#previewSingleInvoice').click();
  assert.equal(document.querySelector('#previewDialog').open,true);
  assert.equal(document.querySelectorAll('#previewDialog #printPreview').length,1);
  assert.equal(document.querySelectorAll('#previewDialog #downloadPreview').length,1);
  assert.match(document.querySelector('#invoicePage').getAttribute('style'),/--detail-count:1/);
  const twoLineHtml=window.StepInvoicePdf.pageHtml({...window.StepInvoiceCore.buildManualInvoice({invoiceNumber:'202608999',subject:'2026年8月分',invoiceDate:'2026-08-09',dueDate:'2026-08-30'},[{name:'授業料',unitPrice:25000,quantity:1,taxRate:10},{name:'分譲経費',unitPrice:2500,quantity:1,taxRate:10}],window.StepInvoiceCore.DEMO_PARTNERS[0])});
  assert.match(twoLineHtml,/--detail-count:2/);
  assert.match(twoLineHtml,/愛知県春日井市大留町1丁目23-2/);
  document.querySelector('#previewDialog').close();
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(document.querySelector('#createTable tbody').textContent,/202608501/);
  assert.match(document.querySelector('#createTable tbody').textContent,/ダミー取引先1/);

  document.querySelector('#openPartnerForm').click();
  const partnerForm=document.querySelector('#partnerForm');
  partnerForm.elements.customerCode.value='NEW001';
  partnerForm.elements.name.value='個別入力テスト';
  partnerForm.elements.email.value='new@example.com';
  partnerForm.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(document.querySelector('#partnerTable').textContent,/個別入力テスト/);
  assert.match(document.querySelector('#singlePartner').textContent,/NEW001/);
  const styles=fs.readFileSync(path.join(root,'assets/styles.css'),'utf8');
  assert.ok(styles.lastIndexOf('.invoice-page .issuer{left:520px')>styles.lastIndexOf('.invoice-page .issuer{left:555px'));
  assert.ok(styles.includes('.invoice-page .totals{top:calc(535px + var(--detail-count) * 34px)}'));
  console.log('ui tests passed');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
