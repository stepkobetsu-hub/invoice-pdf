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

  const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validEmail=value=>EMAIL.test(String(value||'').trim());
  function appState(){return window.StepInvoiceApp?.state||null;}
  function partnerForCode(code){return appState()?.partners?.find(item=>String(item?.['顧客コード']||'')===String(code||''))||null;}
  function updatePartnerLabel(partner){
    const hidden=document.querySelector('#singlePartner'),search=document.querySelector('#singlePartnerSearch');
    if(!partner||!hidden||!search||String(hidden.value)!==String(partner['顧客コード']))return;
    search.value=`${partner['顧客コード']}　${partner['名称']}（${partner['メールアドレス']||'メール未登録'}）`;
  }
  function persistPartnersLocally(){
    const state=appState();
    if(state?.partners)localStorage.setItem('stepInvoicePartners',JSON.stringify(state.partners));
  }
  async function persistPartnerToD1(partner){
    try{
      const token=String(JSON.parse(localStorage.getItem('stepStaffAppAuth')||'null')?.systemPortalSessionToken||'');
      if(!token)return;
      const response=await fetch('https://step-invoice-api.stepkobetsu.workers.dev/api/app/partners',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({partners:[partner]})});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok)throw new Error(String(result?.error||response.status));
    }catch(error){console.warn('生徒マスタから補完したメールアドレスのD1保存に失敗しました。',error);}
  }
  async function hydratePartnerEmail(code){
    const app=window.StepInvoiceApp,partner=partnerForCode(code);
    if(!app||!partner||validEmail(partner['メールアドレス']))return partner;
    const student=await app.api('findStudentForPartner',{studentCode:String(code||'')});
    const email=String(student?.email||'').trim();
    if(!validEmail(email))throw new Error('生徒マスタにも有効なメールアドレスが登録されていません。');
    partner['メールアドレス']=email;
    persistPartnersLocally();
    updatePartnerLabel(partner);
    await persistPartnerToD1(partner);
    return partner;
  }
  async function hydrateInvoiceRecipient(invoice){
    const app=window.StepInvoiceApp;
    if(!app||!invoice||validEmail(invoice.email))return validEmail(invoice?.email);
    const partner=await hydratePartnerEmail(invoice.customerCode);
    if(!partner||!validEmail(partner['メールアドレス']))return false;
    invoice.email=String(partner['メールアドレス']).trim();
    if(!invoice.cc&&partner['CCメールアドレス'])invoice.cc=String(partner['CCメールアドレス']).trim();
    await app.api('saveInvoiceData',{invoice});
    const to=document.querySelector('#mailTo'),cc=document.querySelector('#mailCc');
    if(to)to.textContent=invoice.email;
    if(cc)cc.textContent=invoice.cc||'なし';
    app.renderInvoices?.();
    return true;
  }
  function installInvoiceRecipientRecovery(){
    document.addEventListener('click',event=>{
      const option=event.target.closest?.('#singlePartnerResults [data-partner-code]');
      if(!option)return;
      setTimeout(()=>{void hydratePartnerEmail(option.dataset.partnerCode).catch(error=>window.StepInvoiceApp?.alert?.(`メールアドレスを生徒マスタから読み込めませんでした：${error.message}`,'error'));},0);
    });
    document.addEventListener('submit',event=>{
      const form=event.target;
      if(form?.id!=='singleInvoiceForm')return;
      if(form.dataset.skipEmailHydration==='1'){delete form.dataset.skipEmailHydration;return;}
      const code=String(form.elements?.partnerCode?.value||''),partner=partnerForCode(code);
      if(!partner||validEmail(partner['メールアドレス']))return;
      const submitter=event.submitter,sendAfterSave=submitter?.id==='saveAndSendSingleInvoice';
      event.preventDefault();
      event.stopImmediatePropagation();
      const status=document.querySelector('#singleSaveStatus');
      if(status){status.textContent='生徒マスタからメールアドレスを確認しています…';status.className='mail-submit-status working';}
      void hydratePartnerEmail(code).then(()=>form.requestSubmit(submitter||undefined)).catch(error=>{
        if(status){status.textContent=`メールアドレスを読み込めませんでした：${error.message}`;status.className='mail-submit-status error';}
        if(!sendAfterSave){form.dataset.skipEmailHydration='1';form.requestSubmit(submitter||undefined);}
        else window.StepInvoiceApp?.alert?.(`送信できません。${error.message}`,'error');
      });
    },true);
    const dialog=document.querySelector('#invoiceMailDialog');
    if(!dialog)return;
    new MutationObserver(()=>{
      if(!dialog.open)return;
      const invoice=appState()?.preview;
      if(!invoice||validEmail(invoice.email))return;
      const status=document.querySelector('#invoiceMailStatus'),button=document.querySelector('#confirmInvoiceMail'),wasDisabled=Boolean(button?.disabled);
      if(status){status.textContent='生徒マスタから宛先メールアドレスを確認しています…';status.className='mail-submit-status working';}
      if(button)button.disabled=true;
      void hydrateInvoiceRecipient(invoice).then(ok=>{
        if(status){status.textContent=ok?'生徒マスタから宛先メールアドレスを読み込みました。':'宛先メールアドレスを確認できませんでした。';status.className=ok?'mail-submit-status working':'mail-submit-status error';}
        if(button)button.disabled=wasDisabled||!ok;
      }).catch(error=>{
        if(status){status.textContent=`宛先メールアドレスを読み込めませんでした：${error.message}`;status.className='mail-submit-status error';}
        if(button)button.disabled=true;
      });
    }).observe(dialog,{attributes:true,attributeFilter:['open']});
  }

  window.StepReceiptPdf={pageHtml,toBlob:(element)=>window.StepInvoicePdf.toBlob(element)};
  document.addEventListener('DOMContentLoaded',()=>{
    const singleButton=document.querySelector('[data-create-method="single"]');
    if(singleButton)singleButton.textContent='1個ずつ作成';
    installInvoiceRecipientRecovery();
  });
})();
