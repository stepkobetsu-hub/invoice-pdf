const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.doesNotMatch(html,/src="assets\/lib\/(?:html2canvas|jspdf)[^"]+"/,'PDFライブラリを初期画面で読み込まない');

const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{
  runScripts:'outside-only',
  url:'https://stepkobetsu-hub.github.io/invoice-pdf/'
});
const {window}=dom;
window.eval(fs.readFileSync(path.join(root,'assets','invoice-pdf.js'),'utf8'));

const loading=window.StepInvoicePdf.ensurePdfLibraries();
const scripts=Array.from(window.document.scripts).map(script=>script.src);
assert.deepEqual(scripts,[
  'https://stepkobetsu-hub.github.io/invoice-pdf/assets/lib/html2canvas-1.4.1.min.js',
  'https://stepkobetsu-hub.github.io/invoice-pdf/assets/lib/jspdf-2.5.1.umd.min.js'
]);
window.html2canvas=()=>{};
window.jspdf={jsPDF:class{}};
window.document.scripts[0].dispatchEvent(new window.Event('load'));
window.document.scripts[1].dispatchEvent(new window.Event('load'));

loading.then(async()=>{
  await window.StepInvoicePdf.ensurePdfLibraries();
  assert.equal(window.document.scripts.length,2,'2回目以降は同じライブラリを再利用する');
  console.log('PDF library lazy-loading tests passed');
}).catch(error=>{console.error(error);process.exitCode=1;});
