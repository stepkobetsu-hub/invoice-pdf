(function(global){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function pageHtml(inv,options={}){
    const allDetails=Array.isArray(inv.details)&&inv.details.length?inv.details:[{name:'',unitPrice:0,quantity:0,amount:0}];
    const detailPages=[],remaining=allDetails.slice();
    detailPages.push({items:remaining.splice(0,15),continuation:false,blocks:[]});
    while(remaining.length)detailPages.push({items:remaining.splice(0,25),continuation:true,blocks:[]});
    const outputBlocks=[{name:'summary',height:108},{name:'bank',height:112},{name:'note',height:100}];
    const pageBottom=1060,blockGap=10;
    let blockPage=detailPages[detailPages.length-1];
    let blockTop=(blockPage.continuation?72:487)+38+blockPage.items.length*34+12;
    outputBlocks.forEach(block=>{
      if(blockTop+block.height>pageBottom){
        blockPage={items:[],continuation:true,blocks:[]};
        detailPages.push(blockPage);
        blockTop=60;
      }
      blockPage.blocks.push({...block,top:blockTop});
      blockTop+=block.height+blockGap;
    });
    const pageCount=detailPages.length;
    const watermark=options.preview===true?'<div class="preview-watermark" aria-hidden="true">プレビュー</div>':'';
    return detailPages.map((page,pageIndex)=>{
      const detailItems=page.items;
      const details=detailItems.map(d=>`<tr><td></td><td>${esc(d.name)}</td><td class="num">${Number(d.unitPrice).toLocaleString()}</td><td class="num">${Number(d.quantity).toLocaleString()}</td><td class="num">${Number(d.amount).toLocaleString()}</td></tr>`).join('');
      const outputBlocks=page.blocks.map(block=>{
        if(block.name==='summary')return `<div class="invoice-output-block invoice-summary-block" style="top:${block.top}px"><div class="tax-title">税率別内訳</div><table class="tax-table"><tr><th></th><th>税抜金額</th><th>消費税額</th><th>税込金額</th></tr><tr><td>10%</td><td>${Number(inv.subtotal).toLocaleString()}</td><td>${Number(inv.tax).toLocaleString()}</td><td>${Number(inv.total).toLocaleString()}</td></tr></table><table class="totals"><tr><td>小計</td><td class="num">${Number(inv.subtotal).toLocaleString()}</td></tr><tr><td>消費税額合計</td><td class="num">${Number(inv.tax).toLocaleString()}</td></tr><tr><td>合計</td><td class="num">${Number(inv.total).toLocaleString()}</td></tr></table></div>`;
        if(block.name==='bank')return `<div class="invoice-output-block invoice-text-block invoice-bank-block" style="top:${block.top}px"><div class="section-title">振込先</div><div class="section-box">${esc(inv.bank||'')}</div></div>`;
        return `<div class="invoice-output-block invoice-text-block invoice-note-block" style="top:${block.top}px"><div class="section-title">備考</div><div class="section-box">${esc(inv.note||'個別指導ステップ（運営：株式会社エデュクレスト）')}</div></div>`;
      }).join('');
      const header=page.continuation?`<div class="abs continuation-title">${detailItems.length?'請求明細（続き）':'請求内容（続き）'}</div>`:`<div class="abs invoice-title">請求書</div><div class="abs customer">${esc(inv.partnerName)} ${esc(inv.honorific||'様')}</div><div class="abs customer-postal">〒${esc(inv.postal)}</div><div class="abs customer-address">${esc(inv.prefecture)}${esc(inv.address1)}${esc(inv.address2)}</div>
      <img class="logo" src="assets/step-logo.png?v=20260802-logo" alt="STEP"><div class="abs issuer">個別指導ステップ<br><br>〒487-0024<br>愛知県春日井市大留町1丁目23-2<br>TEL: 0568-41-8937<br>${esc(inv.customerCode)}</div>
      <div class="abs invoice-meta">請求書番号：${esc(inv.invoiceNumber)}<br>請求日：　　${esc(inv.invoiceDate)}<br>お支払期限：${esc(inv.dueDate)}</div><div class="abs subject">件名： ${esc(inv.subject)}</div>
      <div class="amount-box"><strong>ご請求金額</strong><span>${Number(inv.total).toLocaleString()} 円</span></div>`;
      const detailTable=detailItems.length||!page.continuation?`<table class="detail"><thead><tr><th>納品日</th><th>品目・納品書番号</th><th class="num">単価</th><th class="num">数量</th><th class="num">価格</th></tr></thead><tbody>${details}</tbody></table>`:'';
      return `<div class="invoice-page${page.continuation?' invoice-continuation-page':''}"${pageIndex===0?' id="invoicePage"':''} style="--detail-count:${detailItems.length}">
      ${watermark}
      ${header}${detailTable}
      ${outputBlocks}<div class="abs page-number">${pageIndex+1} / ${pageCount}</div>
    </div>`;
    }).join('');
  }
  async function toBlob(element){
    if(!global.html2canvas||!global.jspdf)throw new Error('PDF生成ライブラリを読み込めません。通信環境を確認してください。');
    const pages=element.matches?.('.invoice-page,.receipt-page')?[element]:Array.from(element.querySelectorAll('.invoice-page,.receipt-page'));
    if(!pages.length)throw new Error('PDFに出力するページが見つかりません。');
    const pdf=new global.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true});
    for(let index=0;index<pages.length;index+=1){
      const canvas=await global.html2canvas(pages[index],{scale:3,backgroundColor:'#fff',useCORS:true,logging:false});
      if(index>0)pdf.addPage('a4','portrait');
      pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,595.28,841.89,undefined,'FAST');
    }
    return pdf.output('blob');
  }

  function decorateMailButton(){
    const button=document.querySelector('[data-invoice-action="mail"]');
    if(!button)return;
    const current=String(button.textContent||'').trim();
    const resend=current.includes('再送信');
    const label=resend?'メール再送信':'メール送信';
    if(button.dataset.decoratedMailLabel===label)return;
    button.innerHTML='<span aria-hidden="true" style="display:inline-flex;vertical-align:-0.16em;margin-right:7px">'+
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6.5h18v11H3v-11Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m4 8 8 6 8-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'+label;
    button.dataset.decoratedMailLabel=label;
    button.setAttribute('aria-label',label.replace('：',''));
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{
      decorateMailButton();
      const observer=new MutationObserver(decorateMailButton);
      observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    },{once:true});
  }else{
    decorateMailButton();
    const observer=new MutationObserver(decorateMailButton);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  }

  global.StepInvoicePdf={pageHtml,toBlob};
})(window);
