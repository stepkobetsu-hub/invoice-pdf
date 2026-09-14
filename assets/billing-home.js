(function(){
  'use strict';
  const API='https://step-invoice-api.stepkobetsu.workers.dev';
  const AUTH_KEY='stepStaffAppAuth';
  const $=selector=>document.querySelector(selector);
  const yen=value=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(value||0));
  let invoices=[];
  function token(){try{return String(JSON.parse(localStorage.getItem(AUTH_KEY)||'null')?.systemPortalSessionToken||'');}catch(_error){return '';}}
  function monthKey(invoice){
    const subject=String(invoice.subject||'');
    let match=subject.match(/(20\d{2})\D{0,6}(\d{1,2})月/);
    if(!match)match=String(invoice.invoiceDate||'').match(/^(20\d{2})-(\d{1,2})/);
    return match?match[1]+'-'+String(Number(match[2])).padStart(2,'0'):'';
  }
  function monthLabel(key){const parts=String(key).split('-');return parts.length===2?parts[0]+'年'+Number(parts[1])+'月分':key;}
  function uniqueCount(rows,predicate){return new Set(rows.filter(predicate).map(row=>String(row.customerCode||row.invoiceNumber||''))).size;}
  function latestRows(rows){
    const byCustomer=new Map();
    rows.forEach((row,index)=>{
      const key=String(row.customerCode||'').trim()||String(row.customerName||'').trim()||String(row.invoiceNumber||'').trim()||'__row_'+index;
      const previous=byCustomer.get(key);
      const changedAt=value=>{const time=Date.parse(value.updatedAt||value.createdAt||'');return Number.isFinite(time)?time:0;};
      if(!previous||changedAt(row)>=changedAt(previous))byCustomer.set(key,row);
    });
    return [...byCustomer.values()];
  }
  function render(){
    const selected=$('#monthSelect').value;
    const rows=latestRows(invoices.filter(invoice=>monthKey(invoice)===selected));
    const itemText=invoice=>(invoice.details||[]).map(item=>String(item.name||'')).join(' ');
    const paid=rows.filter(row=>row.paymentStatus==='入金済').length;
    const sent=rows.filter(row=>!['','未送信','送信待ち','送信前'].includes(String(row.sendStatus||''))).length;
    const warning=rows.filter(row=>(row.warnings||[]).length>0).length;
    const values=[
      ['対象請求月',monthLabel(selected)],['請求対象人数',rows.length+'名'],
      ['請求合計金額',yen(rows.reduce((sum,row)=>sum+Number(row.total||0),0))],
      ['入金済み',paid+'件'],['未入金',Math.max(0,rows.length-paid)+'件'],['配信済み・進行中',sent+'件'],
      ['兄弟割引対象',uniqueCount(rows,row=>/兄弟姉妹?割引/.test(itemText(row)))+'名'],
      ['教材請求',uniqueCount(rows,row=>/教材/.test(itemText(row)))+'名'],
      ['模試請求',uniqueCount(rows,row=>/模試/.test(itemText(row)))+'名'],
      ['特別調整',uniqueCount(rows,row=>/特別調整/.test(itemText(row)))+'名'],['要確認',warning+'件']
    ];
    const root=$('#kpis');
    root.replaceChildren(...values.map(([label,value])=>{const card=document.createElement('article');card.className='kpi';const name=document.createElement('span');name.textContent=label;const number=document.createElement('strong');number.textContent=value;card.append(name,number);return card;}));
    const latest=rows.map(row=>String(row.updatedAt||row.createdAt||'')).sort().pop();
    $('#updatedLine').textContent='最終更新：'+(latest?new Date(latest).toLocaleString('ja-JP'):'対象月の保存済み請求書はありません');
  }
  async function load(){
    const sessionToken=token();
    $('#loginPanel').classList.toggle('show',!sessionToken);
    if(!sessionToken){$('#status').className='status error';$('#status').textContent='スタッフログインを確認できません。';return;}
    $('#reloadButton').disabled=true;$('#status').className='status busy';$('#status').textContent='Cloudflareから最新状態を読み込んでいます…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(API+'/api/app/dashboard',{headers:{Authorization:'Bearer '+sessionToken},signal:controller.signal});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok)throw new Error(String(result?.error||response.status));
      invoices=Array.isArray(result.data?.invoices)?result.data.invoices:[];
      const months=[...new Set(invoices.map(monthKey).filter(Boolean))].sort().reverse(),select=$('#monthSelect');
      select.replaceChildren(...months.map(key=>{const option=document.createElement('option');option.value=key;option.textContent=monthLabel(key);return option;}));
      select.disabled=!months.length;if(months.length)render();else $('#kpis').replaceChildren();
      $('#userLine').textContent='接続：'+String(result.data?.user||'スタッフ')+'　／　この画面は閲覧専用です。';
      $('#status').className='status ok';$('#status').textContent='読み込み完了';$('#loginPanel').classList.remove('show');
    }catch(error){
      $('#status').className='status error';
      $('#status').textContent=error?.name==='AbortError'?'読み込みが15秒を超えました。再読込してください。':'読み込みに失敗しました：'+String(error?.message||error);
      $('#loginPanel').classList.toggle('show',/STAFF_LOGIN_REQUIRED|ログイン/.test(String(error?.message||error)));
    }finally{clearTimeout(timer);$('#reloadButton').disabled=false;}
  }
  $('#reloadButton').addEventListener('click',load);
  $('#monthSelect').addEventListener('change',render);
  window.addEventListener('pageshow',load);
})();
