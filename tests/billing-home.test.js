const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('billing-home.html','utf8');
const js=fs.readFileSync('assets/billing-home.js','utf8');

assert.match(html,/高速ホーム/);
assert.match(html,/閲覧専用/);
assert.match(html,/AKfycbxzkE1tQRyB_Ca4bfPKYWIkpTukIVPMWKf2ETE7yN7qROJk0VyOlvxaJ9GGI5p-6pGb/);
assert.match(js,/\/api\/app\/dashboard/);
assert.match(js,/stepStaffAppAuth/);
assert.match(js,/function latestRows\(/);
assert.doesNotMatch(js,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(js,/localStorage\.setItem/);

class Element{
  constructor(value=''){this.value=value;this.textContent='';this.children=[];this.disabled=false;this.listeners={};this.className='';this.classList={toggle(){},add(){},remove(){}};}
  addEventListener(type,listener){this.listeners[type]=listener;}
  replaceChildren(...children){this.children=children;}
  append(...children){this.children.push(...children);}
}
const elements={
  '#monthSelect':new Element('2026-10'),
  '#kpis':new Element(),
  '#updatedLine':new Element(),
  '#loginPanel':new Element(),
  '#status':new Element(),
  '#reloadButton':new Element(),
  '#userLine':new Element()
};
let pageshow;
const duplicateInvoices=[
  {customerCode:'A',subject:'2026年10月分',subtotal:90,tax:10,total:100,updatedAt:'2026-09-01T00:00:00Z',details:[{amount:91,taxRate:'10%'}]},
  {customerCode:'A',subject:'2026年10月分',subtotal:95,tax:15,total:110,updatedAt:'2026-09-02T00:00:00Z',details:[{amount:95,taxRate:'10%'}]},
  {customerCode:'B',subject:'2026年10月分',subtotal:180,tax:20,total:200,updatedAt:'2026-09-01T00:00:00Z',details:[{amount:182,taxRate:'10%'}]},
  {customerCode:'B',subject:'2026年10月分',subtotal:191,tax:19,total:210,updatedAt:'2026-09-02T00:00:00Z',details:[{amount:191,taxRate:'10%'}]}
];
const context={
  document:{
    querySelector:selector=>elements[selector],
    createElement:()=>new Element()
  },
  window:{addEventListener:(type,listener)=>{if(type==='pageshow')pageshow=listener;}},
  localStorage:{getItem:()=>JSON.stringify({systemPortalSessionToken:'test-token'})},
  fetch:async()=>({ok:true,json:async()=>({ok:true,data:{invoices:duplicateInvoices,user:'test'}})}),
  AbortController,
  Intl,
  Date,
  Number,
  String,
  Set,
  Map,
  Math,
  setTimeout,
  clearTimeout
};
vm.runInNewContext(js,context);
assert.equal(typeof pageshow,'function');

(async()=>{
  await pageshow();
  const values=elements['#kpis'].children.map(card=>card.children[1].textContent);
  assert.equal(values[1],'2名');
  assert.equal(values[2],'管理画面で確認');
  console.log('billing fast home tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
