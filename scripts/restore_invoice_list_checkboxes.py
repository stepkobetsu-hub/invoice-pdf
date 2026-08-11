from pathlib import Path

# index.html: add bulk-selection toolbar above invoice workspace
p=Path('index.html')
s=p.read_text(encoding='utf-8')
needle='''        <div class="invoice-workspace">\n          <aside class="invoice-list-pane" aria-label="請求書一覧"><div class="invoice-list-head"><strong id="invoiceListCount">0件</strong><span>最新順</span></div><div id="invoiceList" class="invoice-list"><p class="invoice-list-empty">請求書がありません。</p></div></aside>'''
replacement='''        <div class="invoice-bulk-toolbar" aria-label="請求書の一括操作"><label class="invoice-select-all"><input id="invoiceSelectAllVisible" type="checkbox"> 表示中をすべて選択</label><span id="invoiceSelectedCount">0件選択</span><button id="invoiceClearSelection" class="button secondary compact" type="button">選択解除</button><button id="invoiceSendSelected" class="button success compact" type="button" disabled>選択した請求書を送信</button></div>\n        <div class="invoice-workspace">\n          <aside class="invoice-list-pane" aria-label="請求書一覧"><div class="invoice-list-head"><strong id="invoiceListCount">0件</strong><span>最新順</span></div><div id="invoiceList" class="invoice-list"><p class="invoice-list-empty">請求書がありません。</p></div></aside>'''
if needle not in s:
    raise SystemExit('MISSING:invoice-workspace-anchor')
s=s.replace(needle,replacement,1)
s=s.replace('assets/styles.css?v=20260811-ui-restored','assets/styles.css?v=20260811-invoice-checkboxes')
s=s.replace('assets/app.js?v=20260811-invoice-home','assets/app.js?v=20260811-invoice-checkboxes')
s=s.replace('assets/app.js?v=20260811-brand-link','assets/app.js?v=20260811-invoice-checkboxes')
p.write_text(s,encoding='utf-8')

# app.js: render checkbox per invoice and bulk controls
p=Path('assets/app.js')
s=p.read_text(encoding='utf-8')
old="""    $('#invoiceList').innerHTML=ordered.length?ordered.map(invoice=>{const payment=invoice.paymentStatus||'未入金';return `<button class=\"invoice-list-item ${String(invoice.invoiceNumber)===String(state.selectedInvoiceNumber)?'active':''}\" type=\"button\" data-invoice-select=\"${esc(invoice.invoiceNumber)}\"><span class=\"invoice-list-meta\"><span>${esc(invoice.createdAt||invoice.invoiceDate||'')}</span><span>No. ${esc(invoice.invoiceNumber)}</span></span><span class=\"invoice-list-name\">${esc(invoice.partnerName||'取引先未設定')}</span><span class=\"invoice-list-subject\">${esc(invoice.subject||'件名未設定')}</span><span class=\"invoice-list-statuses\"><span class=\"payment-pill ${paymentClass(payment)}\">${esc(payment)}</span><span class=\"status ${statusClass(invoice.sendStatus)}\">${esc(invoice.sendStatus||'未送信')}</span>${invoice.dlStatus==='DL済'?'<span class=\"status downloaded\">DL済</span>':''}<strong class=\"invoice-list-amount\">${C.formatYen(invoice.total)}</strong></span></button>`;}).join(''):`<p class=\"invoice-list-empty\">${state.invoices.length?'検索条件に一致する請求書がありません。':'請求書がありません。'}</p>`;\n    $$('[data-invoice-select]').forEach(button=>button.onclick=()=>{state.selectedInvoiceNumber=button.dataset.invoiceSelect;renderInvoices();});renderInvoiceDetail(ordered.find(invoice=>String(invoice.invoiceNumber)===String(state.selectedInvoiceNumber)));"""
new="""    $('#invoiceList').innerHTML=ordered.length?ordered.map(invoice=>{const payment=invoice.paymentStatus||'未入金',sourceIndex=state.invoices.indexOf(invoice),checked=state.selected.has(sourceIndex);return `<div class=\"invoice-list-row ${String(invoice.invoiceNumber)===String(state.selectedInvoiceNumber)?'active':''}\"><label class=\"invoice-list-check\" title=\"この請求書を選択\"><input type=\"checkbox\" data-invoice-check=\"${sourceIndex}\" ${checked?'checked':''} aria-label=\"${esc(invoice.partnerName||'取引先')}の請求書を選択\"></label><button class=\"invoice-list-item ${String(invoice.invoiceNumber)===String(state.selectedInvoiceNumber)?'active':''}\" type=\"button\" data-invoice-select=\"${esc(invoice.invoiceNumber)}\"><span class=\"invoice-list-meta\"><span>${esc(invoice.createdAt||invoice.invoiceDate||'')}</span><span>No. ${esc(invoice.invoiceNumber)}</span></span><span class=\"invoice-list-name\">${esc(invoice.partnerName||'取引先未設定')}</span><span class=\"invoice-list-subject\">${esc(invoice.subject||'件名未設定')}</span><span class=\"invoice-list-statuses\"><span class=\"payment-pill ${paymentClass(payment)}\">${esc(payment)}</span><span class=\"status ${statusClass(invoice.sendStatus)}\">${esc(invoice.sendStatus||'未送信')}</span>${invoice.dlStatus==='DL済'?'<span class=\"status downloaded\">DL済</span>':''}<strong class=\"invoice-list-amount\">${C.formatYen(invoice.total)}</strong></span></button></div>`;}).join(''):`<p class=\"invoice-list-empty\">${state.invoices.length?'検索条件に一致する請求書がありません。':'請求書がありません。'}</p>`;\n    $$('[data-invoice-select]').forEach(button=>button.onclick=()=>{state.selectedInvoiceNumber=button.dataset.invoiceSelect;renderInvoices();});\n    $$('[data-invoice-check]').forEach(box=>box.onchange=()=>{const index=Number(box.dataset.invoiceCheck);if(box.checked)state.selected.add(index);else state.selected.delete(index);updateInvoiceSelectionUi();});\n    updateInvoiceSelectionUi(ordered);renderInvoiceDetail(ordered.find(invoice=>String(invoice.invoiceNumber)===String(state.selectedInvoiceNumber)));"""
if old not in s:
    raise SystemExit('MISSING:renderInvoices-list-block')
s=s.replace(old,new,1)
marker='  function updateInvoiceFilters(){'
helper="""  function updateInvoiceSelectionUi(visible=filteredInvoices()){const valid=new Set(state.invoices.map((_,i)=>i));for(const index of [...state.selected])if(!valid.has(index))state.selected.delete(index);const visibleIndices=visible.map(inv=>state.invoices.indexOf(inv)).filter(i=>i>=0),selectedVisible=visibleIndices.filter(i=>state.selected.has(i)).length,master=$('#invoiceSelectAllVisible');if(master){master.checked=visibleIndices.length>0&&selectedVisible===visibleIndices.length;master.indeterminate=selectedVisible>0&&selectedVisible<visibleIndices.length;}const count=$('#invoiceSelectedCount');if(count)count.textContent=`${state.selected.size}件選択`;const send=$('#invoiceSendSelected');if(send)send.disabled=state.selected.size===0;}\n"""
if helper not in s:
    s=s.replace(marker,helper+marker,1)
bind="""  $('#invoiceSelectAllVisible')?.addEventListener('change',event=>{const visible=filteredInvoices();visible.forEach(inv=>{const index=state.invoices.indexOf(inv);if(index<0)return;if(event.currentTarget.checked)state.selected.add(index);else state.selected.delete(index);});renderInvoices();});\n  $('#invoiceClearSelection')?.addEventListener('click',()=>{state.selected.clear();renderInvoices();});\n  $('#invoiceSendSelected')?.addEventListener('click',()=>{const items=selectedItems();if(items.length)openSendDialog(items);});\n"""
anchor="  $('#refreshInvoices').onclick=()=>refreshAll(true);"
if bind not in s:
    if anchor not in s: raise SystemExit('MISSING:refreshInvoices-binding')
    s=s.replace(anchor,bind+anchor,1)
p.write_text(s,encoding='utf-8')

# CSS
p=Path('assets/styles.css')
s=p.read_text(encoding='utf-8')
css='''\n/* 請求書一覧チェックボックス復元 */\n.invoice-bulk-toolbar{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:8px 10px;background:#fff;border:1px solid #e4e7ec;border-radius:10px}\n.invoice-bulk-toolbar #invoiceSelectedCount{font-weight:700;color:#475467;margin-right:auto}\n.invoice-select-all{display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer}\n.invoice-list-row{display:grid;grid-template-columns:34px minmax(0,1fr);align-items:stretch;border-bottom:1px solid #eef0f3}\n.invoice-list-row.active{background:#f6f9ff}\n.invoice-list-check{display:flex;align-items:flex-start;justify-content:center;padding-top:18px;cursor:pointer}\n.invoice-list-check input{width:18px;height:18px}\n.invoice-list-row .invoice-list-item{border-bottom:0;width:100%}\n'''
if '/* 請求書一覧チェックボックス復元 */' not in s:s+=css
p.write_text(s,encoding='utf-8')
print('invoice list checkboxes restored')
