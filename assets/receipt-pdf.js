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
  const SYNC_FRESH_MS=30000;
  const syncPromises=new Map();
  const syncedAt=new Map();
  const STUDENT_SYNC_FIELDS=['名称','名称(カナ)','郵便番号','都道府県','住所1','住所2','メールアドレス','学年','教室'];

  function appState(){return window.StepInvoiceApp?.state||null;}
  function partnerForCode(code){return appState()?.partners?.find(item=>String(item?.['顧客コード']||'')===String(code||''))||null;}
  function normalizePostal(value){
    const text=String(value??'').trim(),digits=text.replace(/\D/g,'');
    return digits.length===7?`${digits.slice(0,3)}-${digits.slice(3)}`:text;
  }
  function splitJapaneseAddress(value){
    const text=String(value||'').trim(),match=text.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)(.*)$/);
    return match?{prefecture:match[1],rest:match[2]}:{prefecture:'',rest:text};
  }
  function normalizeCampus(value){
    const text=String(value||'').trim();
    if(text.includes('神領'))return '神領';
    if(text.includes('大手'))return '大手';
    return '';
  }
  function mergeStudentIntoPartner(current,student){
    const next={...current};
    const first=splitJapaneseAddress(student?.addressU);
    next['顧客コード']=String(student?.studentCode||current?.['顧客コード']||'').trim();
    next['名称']=String(student?.name||'').trim();
    next['名称(カナ)']=String(student?.kana||'').trim();
    next['郵便番号']=normalizePostal(student?.postal);
    next['都道府県']=first.prefecture;
    next['住所1']=`${first.rest}${String(student?.addressV||'').trim()}`;
    next['住所2']=String(student?.addressW||'').trim();
    next['メールアドレス']=String(student?.email||'').trim();
    next['学年']=String(student?.grade||'').trim();
    const campus=normalizeCampus(student?.classroom||student?.campus);
    if(campus)next['教室']=campus;
    return next;
  }
  function changedStudentFields(before,after){
    return STUDENT_SYNC_FIELDS.filter(field=>String(before?.[field]||'')!==String(after?.[field]||''));
  }
  function persistPartnersLocally(){
    const state=appState();
    if(state?.partners)localStorage.setItem('stepInvoicePartners',JSON.stringify(state.partners));
  }
  function updatePartnerLabel(partner){
    const hidden=document.querySelector('#singlePartner'),search=document.querySelector('#singlePartnerSearch');
    if(!partner||!hidden||!search||String(hidden.value)!==String(partner['顧客コード']))return;
    search.value=`${partner['顧客コード']}　${partner['名称']}（${partner['メールアドレス']||'メール未登録'}）`;
  }
  function updateSingleFormDefaults(before,partner){
    const form=document.querySelector('#singleInvoiceForm'),hidden=document.querySelector('#singlePartner');
    if(!form||!hidden||String(hidden.value)!==String(partner?.['顧客コード']||''))return;
    const memo=form.elements.memo,tags=form.elements.tags;
    if(memo&&(!memo.value||memo.value===String(before?.['学年']||'')))memo.value=String(partner['学年']||'');
    const beforeCampus=normalizeCampus(before?.['教室']),afterCampus=normalizeCampus(partner?.['教室']);
    if(tags&&afterCampus&&(!tags.value||tags.value===beforeCampus))tags.value=afterCampus;
    form.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function updatePartnerEditForm(partner){
    const dialog=document.querySelector('#partnerDialog'),form=document.querySelector('#partnerForm');
    if(!dialog?.open||!form||String(form.elements.customerCode?.value||'')!==String(partner?.['顧客コード']||''))return;
    const values={name:partner['名称'],kana:partner['名称(カナ)'],postal:partner['郵便番号'],prefecture:partner['都道府県'],address1:partner['住所1'],address2:partner['住所2'],email:partner['メールアドレス'],grade:partner['学年']};
    Object.entries(values).forEach(([name,value])=>{if(form.elements[name])form.elements[name].value=String(value||'');});
    const campus=normalizeCampus(partner['教室']);
    if(campus&&form.elements.campus)form.elements.campus.value=campus;
  }
  function updatePartnerTableRow(partner){
    const rows=[...document.querySelectorAll('#partnerTable tbody tr')];
    const row=rows.find(item=>String(item.cells?.[0]?.textContent||'').trim()===String(partner?.['顧客コード']||''));
    if(!row||row.cells.length<9)return;
    row.cells[1].textContent=partner['名称']||'';
    row.cells[3].textContent=partner['郵便番号']||'';
    row.cells[4].textContent=`${partner['都道府県']||''}${partner['住所1']||''}${partner['住所2']||''}`;
    row.cells[6].textContent=partner['メールアドレス']||'';
  }
  async function persistPartnerToD1(partner){
    const token=String(JSON.parse(localStorage.getItem('stepStaffAppAuth')||'null')?.systemPortalSessionToken||'');
    if(!token)throw new Error('スタッフログインが必要です。');
    const response=await fetch('https://step-invoice-api.stepkobetsu.workers.dev/api/app/partners',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({partners:[partner]})});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.ok)throw new Error(String(result?.error||response.status));
  }
  async function mirrorPartnersToAppsScript(){
    const app=window.StepInvoiceApp,state=appState();
    if(!app||!Array.isArray(state?.partners)||!state.partners.length)return;
    await app.api('importPartners',{partners:state.partners});
  }
  async function syncPartnerFromStudentMaster(code,{force=false,notify=false}={}){
    const app=window.StepInvoiceApp,state=appState(),normalized=String(code||'').trim();
    if(!app||!state)throw new Error('請求書システムの読み込みが完了していません。');
    if(!normalized)throw new Error('生徒コードがありません。');
    const current=partnerForCode(normalized);
    if(!current)throw new Error('取引先マスタに対象生徒が見つかりません。');
    if(!force&&Date.now()-(syncedAt.get(normalized)||0)<SYNC_FRESH_MS)return current;
    if(syncPromises.has(normalized))return syncPromises.get(normalized);
    const promise=(async()=>{
      const student=await app.api('findStudentForPartner',{studentCode:normalized});
      const before=partnerForCode(normalized)||current,next=mergeStudentIntoPartner(before,student),changes=changedStudentFields(before,next);
      if(changes.length){
        await persistPartnerToD1(next);
        const index=state.partners.findIndex(item=>String(item?.['顧客コード']||'')===normalized);
        if(index>=0)state.partners[index]=next;
        persistPartnersLocally();
        updatePartnerLabel(next);
        updateSingleFormDefaults(before,next);
        updatePartnerEditForm(next);
        updatePartnerTableRow(next);
      }else{
        updatePartnerLabel(before);
        updatePartnerEditForm(before);
      }
      if(changes.length||notify)await mirrorPartnersToAppsScript();
      syncedAt.set(normalized,Date.now());
      const result=partnerForCode(normalized)||next;
      if(notify)app.alert?.(changes.length?`${result['名称']}を生徒マスタの最新情報で更新しました（${changes.join('・')}）。`:`${result['名称']}は生徒マスタと一致しています。`,'success');
      return result;
    })().finally(()=>syncPromises.delete(normalized));
    syncPromises.set(normalized,promise);
    return promise;
  }
  async function hydrateInvoiceRecipient(invoice){
    const app=window.StepInvoiceApp;
    if(!app||!invoice)return false;
    const partner=await syncPartnerFromStudentMaster(invoice.customerCode,{force:true});
    if(!partner||!validEmail(partner['メールアドレス']))return false;
    invoice.email=String(partner['メールアドレス']).trim();
    if(!invoice.cc&&partner['CCメールアドレス'])invoice.cc=String(partner['CCメールアドレス']).trim();
    await mirrorPartnersToAppsScript();
    await app.api('saveInvoiceData',{invoice});
    const to=document.querySelector('#mailTo'),cc=document.querySelector('#mailCc');
    if(to)to.textContent=invoice.email;
    if(cc)cc.textContent=invoice.cc||'なし';
    app.renderInvoices?.();
    return true;
  }
  function installPartnerUpdateButtons(){
    const tbody=document.querySelector('#partnerTable tbody');
    if(!tbody)return;
    const inject=()=>{
      [...tbody.querySelectorAll('tr')].forEach(row=>{
        const code=String(row.cells?.[0]?.textContent||'').trim(),cell=row.cells?.[9];
        if(!code||!cell||cell.querySelector('[data-sync-partner]'))return;
        const button=document.createElement('button');
        button.type='button';
        button.className='button secondary compact';
        button.dataset.syncPartner=code;
        button.textContent='生徒マスタ更新';
        button.title='氏名・フリガナ・郵便番号・住所・メール・学年を生徒マスタの最新情報に更新';
        const deleteButton=cell.querySelector('[data-delete-partner]');
        if(deleteButton)cell.insertBefore(button,deleteButton);
        else cell.appendChild(button);
        cell.insertBefore(document.createTextNode(' '),button.nextSibling);
      });
    };
    inject();
    new MutationObserver(inject).observe(tbody,{childList:true,subtree:true});
  }
  function installPartnerDialogUpdateButton(){
    const form=document.querySelector('#partnerForm'),actions=form?.querySelector('.dialog-actions');
    if(!form||!actions||document.querySelector('#syncPartnerFromStudent'))return;
    const button=document.createElement('button');
    button.id='syncPartnerFromStudent';
    button.className='button secondary';
    button.type='button';
    button.textContent='生徒マスタから更新';
    const save=document.querySelector('#savePartnerButton');
    actions.insertBefore(button,save||null);
    const refreshVisibility=()=>{button.hidden=!form.elements.customerCode?.readOnly;};
    refreshVisibility();
    const dialog=document.querySelector('#partnerDialog');
    new MutationObserver(refreshVisibility).observe(dialog,{attributes:true,attributeFilter:['open']});
  }
  function installStudentMasterSync(){
    installPartnerUpdateButtons();
    installPartnerDialogUpdateButton();
    document.addEventListener('click',event=>{
      const option=event.target.closest?.('#singlePartnerResults [data-partner-code]');
      if(option){
        setTimeout(()=>{
          const status=document.querySelector('#singleSaveStatus');
          if(status){status.textContent='生徒マスタの最新情報を確認しています…';status.className='mail-submit-status working';}
          void syncPartnerFromStudentMaster(option.dataset.partnerCode,{force:true}).then(partner=>{
            if(status){status.textContent=`${partner['名称']}の氏名・住所・メール等を生徒マスタと照合しました。`;status.className='mail-submit-status working';}
          }).catch(error=>{
            if(status){status.textContent=`生徒マスタの確認に失敗しました：${error.message}`;status.className='mail-submit-status error';}
            window.StepInvoiceApp?.alert?.(`生徒マスタの確認に失敗しました：${error.message}`,'error');
          });
        },0);
        return;
      }
      const update=event.target.closest?.('[data-sync-partner]');
      if(update){
        const original=update.textContent;
        update.disabled=true;update.textContent='更新中…';
        void syncPartnerFromStudentMaster(update.dataset.syncPartner,{force:true,notify:true}).catch(error=>window.StepInvoiceApp?.alert?.(`更新できませんでした：${error.message}`,'error')).finally(()=>{update.disabled=false;update.textContent=original;});
        return;
      }
      if(event.target.closest?.('#syncPartnerFromStudent')){
        const form=document.querySelector('#partnerForm'),code=String(form?.elements.customerCode?.value||'').trim(),button=event.target.closest('#syncPartnerFromStudent'),original=button.textContent;
        if(!code)return;
        button.disabled=true;button.textContent='更新中…';
        void syncPartnerFromStudentMaster(code,{force:true,notify:true}).catch(error=>window.StepInvoiceApp?.alert?.(`更新できませんでした：${error.message}`,'error')).finally(()=>{button.disabled=false;button.textContent=original;});
      }
    });
    document.addEventListener('submit',event=>{
      const form=event.target;
      if(form?.id!=='singleInvoiceForm')return;
      if(form.dataset.skipStudentMasterSync==='1'){delete form.dataset.skipStudentMasterSync;return;}
      const code=String(form.elements?.partnerCode?.value||''),partner=partnerForCode(code);
      if(!partner)return;
      const submitter=event.submitter,sendAfterSave=submitter?.id==='saveAndSendSingleInvoice';
      const fresh=Date.now()-(syncedAt.get(code)||0)<SYNC_FRESH_MS;
      if(fresh&&!syncPromises.has(code)){
        if(sendAfterSave&&!validEmail(partner['メールアドレス'])){
          event.preventDefault();event.stopImmediatePropagation();
          window.StepInvoiceApp?.alert?.('生徒マスタに有効なメールアドレスが登録されていないため送信できません。','error');
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const status=document.querySelector('#singleSaveStatus');
      if(status){status.textContent='保存前に生徒マスタの最新情報を確認しています…';status.className='mail-submit-status working';}
      void syncPartnerFromStudentMaster(code,{force:true}).then(updated=>{
        if(sendAfterSave&&!validEmail(updated['メールアドレス']))throw new Error('生徒マスタに有効なメールアドレスが登録されていません。');
        form.requestSubmit(submitter||undefined);
      }).catch(error=>{
        if(status){status.textContent=`生徒マスタを確認できませんでした：${error.message}`;status.className='mail-submit-status error';}
        if(!sendAfterSave){
          form.dataset.skipStudentMasterSync='1';
          form.requestSubmit(submitter||undefined);
        }else window.StepInvoiceApp?.alert?.(`送信できません。${error.message}`,'error');
      });
    },true);
    const dialog=document.querySelector('#invoiceMailDialog');
    if(!dialog)return;
    new MutationObserver(()=>{
      if(!dialog.open)return;
      const invoice=appState()?.preview;
      if(!invoice)return;
      const status=document.querySelector('#invoiceMailStatus'),button=document.querySelector('#confirmInvoiceMail'),wasDisabled=Boolean(button?.disabled);
      if(status){status.textContent='生徒マスタから最新の宛先メールアドレスを確認しています…';status.className='mail-submit-status working';}
      if(button)button.disabled=true;
      void hydrateInvoiceRecipient(invoice).then(ok=>{
        if(status){status.textContent=ok?'生徒マスタの最新メールアドレスを宛先に反映しました。':'生徒マスタに有効なメールアドレスが登録されていません。';status.className=ok?'mail-submit-status working':'mail-submit-status error';}
        if(button)button.disabled=wasDisabled||!ok;
      }).catch(error=>{
        if(status){status.textContent=`宛先メールアドレスを確認できませんでした：${error.message}`;status.className='mail-submit-status error';}
        if(button)button.disabled=true;
      });
    }).observe(dialog,{attributes:true,attributeFilter:['open']});
  }

  window.StepReceiptPdf={pageHtml,toBlob:(element)=>window.StepInvoicePdf.toBlob(element)};
  document.addEventListener('DOMContentLoaded',()=>{
    const singleButton=document.querySelector('[data-create-method="single"]');
    if(singleButton)singleButton.textContent='1個ずつ作成';
    installStudentMasterSync();
  });
})();
