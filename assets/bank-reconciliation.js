(function(){
  'use strict';
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const yen=value=>`${new Intl.NumberFormat('ja-JP').format(Number(value||0))}円`;
  let loading=false;

  function status(message,type='warning'){
    const element=$('#bankImportStatus');element.textContent=message;element.className=`alert ${type}`;
  }
  function confidence(value){return value==='high'?'高':value==='medium'?'中':'低';}
  function candidateHtml(transaction,candidate){
    const invoice=candidate.invoice;
    return `<article class="bank-candidate"><h3>${esc(invoice.partnerName)} 様</h3><p>${esc(invoice.subject||'請求書')}　請求額：<strong>${yen(invoice.total)}</strong></p><ul>${candidate.reasons.map(reason=>`<li>✓ ${esc(reason)}</li>`).join('')}</ul><p>一致可能性：<strong>${confidence(candidate.confidenceLevel)}</strong></p><button class="button primary" data-bank-match="${esc(transaction.bankTransactionId)}" data-invoice-number="${esc(invoice.invoiceNumber)}" ${candidate.amountExact?'':'disabled'}>この請求書を入金済みにする</button></article>`;
  }
  function transactionHtml(transaction){
    const candidates=transaction.candidates||[];
    return `<section class="bank-transaction-card"><header><div><strong>${esc(transaction.transactionDate)}</strong><br>振込名義：${esc(transaction.payerNameRaw||transaction.descriptionRaw)}</div><strong class="bank-amount">${yen(transaction.depositAmount)}</strong></header><p class="bank-description">摘要：${esc(transaction.descriptionRaw)}</p>${transaction.status==='excluded'?'<p class="payment-pill unset">請求書対象外</p>':transaction.status==='matched'?'<p class="payment-pill paid">入金済み</p>':candidates.length?`<div class="bank-candidates">${candidates.map(candidate=>candidateHtml(transaction,candidate)).join('')}</div>`:'<p class="bank-no-match">該当する請求書候補が見つかりませんでした。</p>'}<div class="bank-card-actions">${transaction.status==='excluded'?`<button class="button secondary" data-bank-unexclude="${esc(transaction.bankTransactionId)}">対象外を解除</button>`:transaction.status==='matched'?`<button class="button secondary" data-bank-cancel="${esc(transaction.bankTransactionId)}">入金消込を取り消す</button>`:`<button class="button secondary" data-bank-exclude="${esc(transaction.bankTransactionId)}">請求書対象外として処理</button>`}</div></section>`;
  }
  function bindActions(){
    document.querySelectorAll('[data-bank-match]').forEach(button=>button.onclick=()=>act(button,'match',{invoiceNumber:button.dataset.invoiceNumber},'入金消込を保存しています…'));
    document.querySelectorAll('[data-bank-exclude]').forEach(button=>button.onclick=()=>act(button,'exclude',{reason:'請求書対象外'},'対象外として保存しています…'));
    document.querySelectorAll('[data-bank-unexclude]').forEach(button=>button.onclick=()=>act(button,'unexclude',{},'対象外を解除しています…'));
    document.querySelectorAll('[data-bank-cancel]').forEach(button=>button.onclick=()=>act(button,'cancel-match',{reason:'管理画面から取消'},'入金消込を取り消しています…'));
  }
  async function act(button,action,body,message){
    if(button.disabled)return;button.disabled=true;status(message,'warning');
    try{await window.StepInvoiceApp.cloudApi(`/api/app/bank-transactions/${encodeURIComponent(button.dataset.bankMatch||button.dataset.bankExclude||button.dataset.bankUnexclude||button.dataset.bankCancel)}/${action}`,{method:'POST',body});status('保存しました。','success');await load();}
    catch(error){status(error.message,'error');}finally{button.disabled=false;}
  }
  async function load(){
    if(loading)return;loading=true;
    try{const data=await window.StepInvoiceApp.cloudApi('/api/app/bank-reconciliation');const rows=data.transactions||[];$('#bankReconciliationList').innerHTML=rows.length?rows.map(transactionHtml).join(''):'<p class="invoice-list-empty">読込済みの入金明細はありません。</p>';bindActions();}
    catch(error){$('#bankReconciliationList').innerHTML=`<p class="alert error">${esc(error.message)}</p>`;}finally{loading=false;}
  }
  function onCsvSelected(event){
    event.target.value='';
    status('このCSVはまだ送信していません。実際のWeb21 CSVのヘッダー・文字コードを確認してから、安全に取込を有効化します。CSVファイルを開発担当へ共有してください。','warning');
  }
  $('#openBankReconciliation').onclick=()=>window.StepInvoiceApp.showView('bank');
  $('#backToInvoices').onclick=()=>window.StepInvoiceApp.showView('invoices');
  $('#bankCsvFile').onchange=onCsvSelected;
  window.StepBankReconciliation={load};
})();
