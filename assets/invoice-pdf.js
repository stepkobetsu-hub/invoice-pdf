(function(global){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value||0).toLocaleString();
  const rowHtml=d=>`<tr><td></td><td>${esc(d.name)}</td><td class="num">${number(d.unitPrice)}</td><td class="num">${number(d.quantity)}</td><td class="num">${number(d.amount)}</td></tr>`;
  function paginate(details){
    const items=details.length?details:[{name:'',unitPrice:0,quantity:0,amount:0}];
    // A4を有効に使い、通常の請求書はできるだけ1ページに収める。
    // 集計欄を含む最終ページと、明細だけの継続ページでは収容量を分ける。
    const singlePageCapacity=8,firstPageCapacity=21,finalContinuationCapacity=8,fullContinuationCapacity=34;
    if(items.length<=singlePageCapacity)return [items];
    // 明細が1ページ目に収まる場合は、明細を途中で1行だけ次ページへ送らず、
    // 明細を連続表示した後に集計専用ページを付ける。
    if(items.length<=firstPageCapacity)return [items,[]];
    const pages=[items.slice(0,firstPageCapacity)];
    let remaining=items.slice(pages[0].length);
    while(remaining.length>fullContinuationCapacity){
      pages.push(remaining.slice(0,fullContinuationCapacity));
      remaining=remaining.slice(fullContinuationCapacity);
    }
    if(remaining.length<=finalContinuationCapacity)pages.push(remaining);
    else{pages.push(remaining);pages.push([]);}
    return pages;
  }
  function headerHtml(inv){
    return `<div class="abs invoice-title">請求書</div><div class="abs customer">${esc(inv.partnerName)} ${esc(inv.honorific||'様')}</div><div class="abs customer-postal">〒${esc(inv.postal)}</div><div class="abs customer-address">${esc(inv.prefecture)}${esc(inv.address1)}${esc(inv.address2)}</div>
      <img class="logo" src="assets/step-logo.png?v=20260802-logo" alt="STEP"><div class="abs issuer">個別指導ステップ<br><br>〒487-0024<br>愛知県春日井市大留町1丁目23-2<br>TEL: 0568-41-8937<br>${esc(inv.customerCode)}</div>
      <div class="abs invoice-meta">請求書番号：${esc(inv.invoiceNumber)}<br>請求日：　　${esc(inv.invoiceDate)}<br>お支払期限：${esc(inv.dueDate)}</div><div class="abs subject">件名： ${esc(inv.subject)}</div>
      <div class="amount-box"><strong>ご請求金額</strong><span>${number(inv.total)} 円</span></div>`;
  }
  function summaryHtml(inv){
    return `<div class="abs tax-title">税率別内訳</div><table class="tax-table"><tr><th></th><th>税抜金額</th><th>消費税額</th><th>税込金額</th></tr><tr><td>10%</td><td>${number(inv.subtotal)}</td><td>${number(inv.tax)}</td><td>${number(inv.total)}</td></tr></table>
      <table class="totals"><tr><td>小計</td><td class="num">${number(inv.subtotal)}</td></tr><tr><td>消費税額合計</td><td class="num">${number(inv.tax)}</td></tr><tr><td>合計</td><td class="num">${number(inv.total)}</td></tr></table>
      <div class="abs section-title bank-title">振込先</div><div class="section-box bank-box">${esc(inv.bank||'')}</div><div class="abs section-title note-title">備考</div><div class="section-box note-box">${esc(inv.note||'個別指導ステップ（運営：株式会社エデュクレスト）')}</div>`;
  }
  function pageHtml(inv,options={}){
    const pages=paginate(inv.details||[]),totalPages=pages.length;
    return pages.map((detailItems,index)=>{
      const finalPage=index===totalPages-1;
      const details=detailItems.map(rowHtml).join('');
      const watermark=options.preview===true?'<div class="preview-watermark" aria-hidden="true">プレビュー</div>':'';
      const firstPage=index===0,hasDetails=detailItems.length>0;
      const summaryTop=hasDetails?(firstPage?527:100)+(detailItems.length*26):60;
      const pageClasses=['invoice-page',firstPage?'invoice-first-page':'invoice-following-page',finalPage?'invoice-final-page':'invoice-continuation-page'].join(' ');
      return `<div class="${pageClasses}" ${firstPage?'id="invoicePage"':''} style="--detail-count:${Math.max(1,detailItems.length)};--summary-top:${summaryTop}px">
        ${watermark}${firstPage?headerHtml(inv):''}
        ${hasDetails?`<table class="detail"><thead><tr><th>納品日</th><th>品目・納品書番号</th><th class="num">単価</th><th class="num">数量</th><th class="num">価格</th></tr></thead><tbody>${details}</tbody></table>`:''}
        ${finalPage?summaryHtml(inv):''}
        <footer class="invoice-footer" aria-label="ページ番号">${index+1} / ${totalPages}</footer>
      </div>`;
    }).join('');
  }
  async function toBlob(element,{scale=3}={}){
    if(!global.html2canvas||!global.jspdf)throw new Error('PDF生成ライブラリを読み込めません。通信環境を確認してください。');
    const pages=element.matches&&element.matches('.invoice-page')?[element]:Array.from(element.querySelectorAll('.invoice-page'));
    if(!pages.length)throw new Error('PDFにする請求書ページが見つかりません。');
    const pdf=new global.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true});
    for(let index=0;index<pages.length;index++){
      const canvas=await global.html2canvas(pages[index],{scale,backgroundColor:'#fff',useCORS:true,logging:false});
      if(index>0)pdf.addPage('a4','portrait');
      pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,595.28,841.89,undefined,'FAST');
    }
    return pdf.output('blob');
  }
  global.StepInvoicePdf={pageHtml,toBlob};
})(window);
