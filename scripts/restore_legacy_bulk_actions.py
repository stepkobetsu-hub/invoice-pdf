from pathlib import Path

# Restore the compact legacy bulk-action UI shown in the approved screenshot.
p = Path('index.html')
s = p.read_text(encoding='utf-8')
old = '''        <div class="invoice-bulk-toolbar" aria-label="請求書の一括操作"><label class="invoice-select-all"><input id="invoiceSelectAllVisible" type="checkbox"> 表示中をすべて選択</label><span id="invoiceSelectedCount">0件選択</span><button id="invoiceClearSelection" class="button secondary compact" type="button">選択解除</button><button id="invoiceSendSelected" class="button success compact" type="button" disabled>選択した請求書を送信</button></div>'''
new = '''        <div class="invoice-bulk-legacy" aria-label="請求書の一括操作">
          <details id="invoiceBulkMenu" class="invoice-bulk-menu">
            <summary id="invoiceBulkSummary">選択した0件を一括操作する</summary>
            <div class="invoice-bulk-menu-items">
              <button type="button" data-invoice-bulk-action="send">一括メール送信</button>
              <button type="button" data-invoice-bulk-action="payment">一括入金</button>
              <button type="button" data-invoice-bulk-action="delete" class="danger">一括削除</button>
              <button type="button" data-invoice-bulk-action="clear">選択を解除</button>
            </div>
          </details>
          <button id="invoiceSelectAllResults" class="invoice-select-all-results" type="button">すべての検索結果を選択する</button>
        </div>'''
if old not in s:
    raise SystemExit('MISSING:current bulk toolbar')
s = s.replace(old, new, 1)

# Add a date-only bulk payment dialog, matching the old flow: choose date, then apply to all checked invoices.
anchor = '''  <dialog id="paymentDateDialog" class="payment-date-dialog">'''
bulk_dialog = '''  <dialog id="bulkPaymentDateDialog" class="payment-date-dialog">
    <form id="bulkPaymentDateForm">
      <div class="dialog-head"><h2>選択した請求書を一括入金</h2><button data-close type="button" aria-label="閉じる">×</button></div>
      <div class="dialog-message"><p><strong id="bulkPaymentTarget"></strong></p><label class="payment-date-field">入金日<input id="bulkPaymentDateInput" name="paymentDate" type="date" required></label><p class="field-help">選択した請求書を、この日付でまとめて入金済みにします。</p></div>
      <div class="dialog-actions"><button data-close class="button secondary" type="button">キャンセル</button><button class="button primary" type="submit">一括で入金済にする</button></div>
    </form>
  </dialog>
'''
if 'id="bulkPaymentDateDialog"' not in s:
    if anchor not in s:
        raise SystemExit('MISSING:payment dialog anchor')
    s = s.replace(anchor, bulk_dialog + anchor, 1)

# Bust caches.
s = s.replace('assets/styles.css?v=20260811-invoice-checkboxes', 'assets/styles.css?v=20260811-legacy-bulk')
s = s.replace('assets/app.js?v=20260811-partner-fallback', 'assets/app.js?v=20260811-legacy-bulk')
p.write_text(s, encoding='utf-8')

# JavaScript: restore old compact dropdown behavior + bulk send/delete/payment.
p = Path('assets/app.js')
s = p.read_text(encoding='utf-8')
old_helper = '''  function updateInvoiceSelectionUi(visible=filteredInvoices()){const valid=new Set(state.invoices.map((_,i)=>i));for(const index of [...state.selected])if(!valid.has(index))state.selected.delete(index);const visibleIndices=visible.map(inv=>state.invoices.indexOf(inv)).filter(i=>i>=0),selectedVisible=visibleIndices.filter(i=>state.selected.has(i)).length,master=$('#invoiceSelectAllVisible');if(master){master.checked=visibleIndices.length>0&&selectedVisible===visibleIndices.length;master.indeterminate=selectedVisible>0&&selectedVisible<visibleIndices.length;}const count=$('#invoiceSelectedCount');if(count)count.textContent=`${state.selected.size}件選択`;const send=$('#invoiceSendSelected');if(send)send.disabled=state.selected.size===0;}'''
new_helper = '''  function updateInvoiceSelectionUi(visible=filteredInvoices()){const valid=new Set(state.invoices.map((_,i)=>i));for(const index of [...state.selected])if(!valid.has(index))state.selected.delete(index);const summary=$('#invoiceBulkSummary');if(summary)summary.textContent=`選択した${state.selected.size}件を一括操作する`;const menu=$('#invoiceBulkMenu');if(menu)menu.classList.toggle('disabled',state.selected.size===0);const all=$('#invoiceSelectAllResults');if(all){const visibleIndices=visible.map(inv=>state.invoices.indexOf(inv)).filter(i=>i>=0),allSelected=visibleIndices.length>0&&visibleIndices.every(i=>state.selected.has(i));all.textContent=allSelected?'検索結果の選択を解除する':'すべての検索結果を選択する';all.dataset.allSelected=allSelected?'1':'0';}}'''
if old_helper not in s:
    raise SystemExit('MISSING:updateInvoiceSelectionUi')
s = s.replace(old_helper, new_helper, 1)

old_bind = '''  $('#invoiceSelectAllVisible')?.addEventListener('change',event=>{const visible=filteredInvoices();visible.forEach(inv=>{const index=state.invoices.indexOf(inv);if(index<0)return;if(event.currentTarget.checked)state.selected.add(index);else state.selected.delete(index);});renderInvoices();});
  $('#invoiceClearSelection')?.addEventListener('click',()=>{state.selected.clear();renderInvoices();});
  $('#invoiceSendSelected')?.addEventListener('click',()=>{const items=selectedItems();if(items.length)openSendDialog(items);});
'''
new_bind = '''  $('#invoiceSelectAllResults')?.addEventListener('click',event=>{const visible=filteredInvoices(),clear=event.currentTarget.dataset.allSelected==='1';visible.forEach(inv=>{const index=state.invoices.indexOf(inv);if(index<0)return;if(clear)state.selected.delete(index);else state.selected.add(index);});renderInvoices();});
  $$('[data-invoice-bulk-action]').forEach(button=>button.addEventListener('click',async()=>{const action=button.dataset.invoiceBulkAction,items=selectedItems();$('#invoiceBulkMenu')?.removeAttribute('open');if(action==='clear'){state.selected.clear();renderInvoices();return;}if(!items.length)return alert('請求書を選択してください。','error');if(action==='send')return openSendDialog(items);if(action==='payment'){const dialog=$('#bulkPaymentDateDialog');$('#bulkPaymentTarget').textContent=`${items.length}件を一括で入金済みにします。`;$('#bulkPaymentDateInput').value=localIso(new Date());dialog.showModal();return;}if(action==='delete'){if(!confirm(`選択した${items.length}件の請求書を削除します。よろしいですか？`))return;showOperationOverlay(`0／${items.length}件を削除しています…`);let done=0;try{for(const inv of items){await cloudApi(`/api/app/invoices/${encodeURIComponent(inv.invoiceNumber)}`,{method:'DELETE'});done+=1;$('#operationOverlayText').textContent=`${done}／${items.length}件を削除しています…`;}state.selected.clear();await refreshAll(false);alert(`${done}件の請求書を削除しました。`,'success');}catch(e){await refreshAll(false);alert(`${done}件を削除した後に中断しました：${e.message}`,'error');}finally{hideOperationOverlay();}}}));
  $('#bulkPaymentDateForm')?.addEventListener('submit',async event=>{event.preventDefault();const items=selectedItems(),date=$('#bulkPaymentDateInput').value;if(!items.length||!date)return;const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;showOperationOverlay(`0／${items.length}件を入金済みにしています…`);let done=0;try{for(const inv of items){const updated={...inv,paymentStatus:'入金済',paymentDate:date,paymentAmount:Number(inv.total||0),updatedAt:new Date().toISOString()};await saveInvoiceToD1(updated);done+=1;$('#operationOverlayText').textContent=`${done}／${items.length}件を入金済みにしています…`;}$('#bulkPaymentDateDialog').close();state.selected.clear();await refreshAll(false);alert(`${done}件を入金済みにしました。`,'success');}catch(e){await refreshAll(false);alert(`${done}件を入金済みにした後に中断しました：${e.message}`,'error');}finally{hideOperationOverlay();button.disabled=false;}});
'''
if old_bind not in s:
    raise SystemExit('MISSING:current bulk bindings')
s = s.replace(old_bind, new_bind, 1)
p.write_text(s, encoding='utf-8')

# CSS: remove the replacement toolbar appearance and restore compact dropdown + link from screenshot.
p = Path('assets/styles.css')
s = p.read_text(encoding='utf-8')
css = '''
/* 2026-08-11: restore approved compact invoice bulk-action design */
.invoice-bulk-toolbar{display:none!important}
.invoice-bulk-legacy{width:272px;margin:0 0 12px;display:flex;flex-direction:column;align-items:stretch;gap:7px}
.invoice-bulk-menu{position:relative;margin:0}
.invoice-bulk-menu>summary{list-style:none;cursor:pointer;box-sizing:border-box;width:100%;height:38px;padding:8px 38px 8px 12px;border:1.5px solid #1473e6;border-radius:5px;background:#fff;color:#8a94a3;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative}
.invoice-bulk-menu>summary::-webkit-details-marker{display:none}
.invoice-bulk-menu>summary:after{content:'⌄';position:absolute;right:10px;top:6px;padding-left:10px;border-left:1px solid #d8dde6;color:#596273;font-size:20px;line-height:24px}
.invoice-bulk-menu.disabled>summary{color:#aab1bc;background:#fafbfc}
.invoice-bulk-menu-items{position:absolute;z-index:40;top:42px;left:0;right:0;padding:6px;background:#fff;border:1px solid #d8dde6;border-radius:6px;box-shadow:0 8px 20px rgba(16,24,40,.14)}
.invoice-bulk-menu-items button{display:block;width:100%;border:0;background:#fff;text-align:left;padding:9px 10px;border-radius:4px;font-size:14px;cursor:pointer}
.invoice-bulk-menu-items button:hover{background:#f2f6fb}
.invoice-bulk-menu-items button.danger{color:#c62828}
.invoice-select-all-results{border:0;background:transparent;color:#1669c9;text-decoration:none;font-size:14px;cursor:pointer;padding:0;text-align:center}
.invoice-select-all-results:hover{text-decoration:underline}
'''
if 'restore approved compact invoice bulk-action design' not in s:
    s += css
p.write_text(s, encoding='utf-8')
print('legacy bulk actions restored')
