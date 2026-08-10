(function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const yen=value=>`${Math.round(Number(value)||0).toLocaleString('ja-JP')} 円`;
  const date=value=>{const raw=String(value||'');if(!raw)return '―';const normalized=raw.replace(/\//g,'-').slice(0,10),parts=normalized.split('-');return parts.length===3?`${parts[0]}/${parts[1]}/${parts[2]}`:raw;};
  function pageHtml(receipt){
    const details=receipt.details||[],taxGroups=new Map();details.forEach(item=>{const rate=Number(String(item.taxRate??10).replace('%',''))||0,amount=Number(item.amount??Number(item.unitPrice||0)*Number(item.quantity||0));taxGroups.set(rate,(taxGroups.get(rate)||0)+amount);});
    const taxRows=[...taxGroups.entries()].sort((a,b)=>b[0]-a[0]).map(([rate,amount])=>`<div><span>${rate}%対象</span><span>${yen(amount)}（消費税 ${yen(Math.round(amount*rate/100))}）</span></div>`).join('');
    const itemRows=details.map(item=>`<div class="receipt-item"><span>${esc(item.name||'')}</span><span>${yen(item.amount??Number(item.unitPrice||0)*Number(item.quantity||0))}</span></div>`).join('');
    const purpose=receipt.purpose||receipt.subject||'';
    return `<article class="receipt-page"><h1>領収書</h1><section class="receipt-customer"><strong>${esc(receipt.partnerName||'')} ${esc(receipt.honorific||'様')}</strong><span>〒${esc(receipt.postal||'')}</span><span>${esc(receipt.prefecture||'')}${esc(receipt.address1||'')}${esc(receipt.address2||'')}</span></section><section class="receipt-meta"><span>発行日：　${esc(date(receipt.issueDate))}</span><span>領収書番号：${esc(receipt.receiptNumber||'')}</span></section><div class="receipt-total"><span>合計金額</span><strong>${esc(yen(receipt.total))}</strong></div><section class="receipt-breakdown"><div class="receipt-sums"><div><span>小計</span><span>${esc(yen(receipt.subtotal))}</span></div><div><span>消費税</span><span>${esc(yen(receipt.tax))}</span></div><p>（内訳）</p>${taxRows}${itemRows}</div><div class="receipt-issuer"><img src="assets/step-logo.png" alt="個別指導ステップ"><strong>${esc(receipt.businessName||'個別指導ステップ')}</strong><span>〒${esc(receipt.businessPostal||'487-0024')}</span><span>${esc(receipt.businessAddress||'愛知県春日井市大留町1丁目23-2')}</span><span>TEL: ${esc(receipt.businessPhone||'0568-41-8937')}</span></div></section>${purpose?`<p class="receipt-purpose">但し　${esc(purpose)}</p>`:''}${receipt.note?`<p class="receipt-note">${esc(receipt.note)}</p>`:''}<span class="receipt-page-number">1 / 1</span></article>`;
  }
  window.StepReceiptPdf={pageHtml,toBlob:(element)=>window.StepInvoicePdf.toBlob(element)};
})();
