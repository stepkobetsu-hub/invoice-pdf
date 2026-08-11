from pathlib import Path
import re


def require_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f'MISSING:{label}')
    return text.replace(old, new, 1)

# index.html
p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = s.replace('assets/styles.css?v=20260810-settings-combobox', 'assets/styles.css?v=20260811-ui-restored')
s = s.replace('assets/app.js?v=20260810-settings-combobox', 'assets/app.js?v=20260811-ui-restored')
s = require_replace(
    s,
    '<div class="actions single-save-actions"><button id="previewSingleInvoice" class="button secondary" type="button">大きくプレビュー</button><button id="saveSingleInvoice" class="button primary" type="submit">保存して発行リストへ追加</button></div>',
    '<div class="actions single-save-actions"><button id="saveSingleInvoice" class="button primary" type="submit">保存</button></div>',
    'single-save-ui')
s = require_replace(
    s,
    '<label><span class="field-label-row"><span>取引先<span class="required">必須</span></span><button id="goPartnerCreate" class="mini-link" type="button">取引先マスタ登録へ</button></span><span id="singlePartnerCombo"',
    '<label><span class="field-label-row"><span>取引先<span class="required">必須</span></span><span class="single-partner-links"><button id="openStudentImportFromSingle" class="mini-link" type="button">生徒マスタから取込</button><button id="goPartnerCreate" class="mini-link" type="button">取引先マスタ登録へ</button></span></span><span id="singlePartnerCombo"',
    'single-student-import-button')
s = require_replace(
    s,
    '<div id="invoiceImportSummary" class="summary-grid hidden"></div>\n        <div class="table-wrap">\n          <table id="createTable"><thead><tr><th>選択</th><th>請求書番号</th><th>顧客コード</th><th>宛名</th><th>件名</th><th>請求金額</th><th>メール</th><th>CC</th><th>PDF状態</th><th>警告</th><th>プレビュー</th></tr></thead><tbody><tr class="empty"><td colspan="11">請求書CSVを読み込んでください。</td></tr></tbody></table>\n        </div>\n        <div class="actions"><button id="addToSend" class="button success" disabled>発行リストを請求書一覧で確認</button></div>',
    '<div id="invoiceImportSummary" class="summary-grid hidden"></div>\n        <div class="create-table-toolbar" aria-label="CSV読込行の一括操作"><span id="createSelectedCountTop">0／0件を選択</span><button id="removeSelectedCreateRowsTop" class="button create-delete-button create-delete-button-top" type="button" data-remove-create-rows disabled>選択した行を削除</button><button id="addToSendTop" class="button success create-save-button-top" type="button" data-save-imported-invoices disabled>保存して請求書を作成</button></div>\n        <div class="table-wrap">\n          <table id="createTable"><thead><tr><th><label><input id="createSelectAll" type="checkbox" aria-label="すべて選択"> すべて</label></th><th>請求書番号</th><th>顧客コード</th><th>宛名</th><th>件名</th><th>請求金額</th><th>メール</th><th>CC</th><th>PDF状態</th><th>警告</th><th>プレビュー</th></tr></thead><tbody><tr class="empty"><td colspan="11">請求書CSVを読み込んでください。</td></tr></tbody></table>\n        </div>\n        <div class="actions create-list-actions"><span id="createSelectedCount">0／0件を選択</span><button id="removeSelectedCreateRows" class="button create-delete-button" type="button" data-remove-create-rows disabled>選択した行を削除</button><button id="addToSend" class="button success" type="button" data-save-imported-invoices disabled>保存して請求書を作成</button></div>',
    'csv-toolbar')
p.write_text(s, encoding='utf-8')

# assets/app.js
p = Path('assets/app.js')
s = p.read_text(encoding='utf-8')
s = require_replace(s, 'preview:null,selected:new Set(),selectedInvoiceNumber:', 'preview:null,selected:new Set(),createSelected:new Set(),selectedInvoiceNumber:', 'createSelected-state')
s = require_replace(s, "async function onInvoiceCsv(file){try{const decoded=await C.decodeCsvFile(file);state.invoices=C.parseInvoiceRows(C.parseCsv(decoded.text));activateStep(1);reconcile();", "async function onInvoiceCsv(file){try{const decoded=await C.decodeCsvFile(file);state.invoices=C.parseInvoiceRows(C.parseCsv(decoded.text));state.createSelected=new Set(state.invoices.map((_,index)=>index));activateStep(1);reconcile();", 'csv-select-all-default')

pattern = re.compile(r"  function renderCreate\(\)\{.*?\n  function renderPartners\(\)", re.S)
m = pattern.search(s)
if not m:
    raise SystemExit('MISSING:renderCreate-block')
replacement = r'''  function updateCreateSelectionUi(){const total=state.invoices.length,selected=state.createSelected.size,master=$('#createSelectAll');if(master){master.checked=total>0&&selected===total;master.indeterminate=selected>0&&selected<total;}$$('#createSelectedCount, #createSelectedCountTop').forEach(count=>count.textContent=`${selected}／${total}件を選択`);$$('[data-save-imported-invoices]').forEach(button=>button.disabled=selected===0);$$('[data-remove-create-rows]').forEach(button=>{button.disabled=selected===0;button.textContent=selected?`選択した${selected}件を削除`:'選択した行を削除';});}
  function removeSelectedCreateRows(){const selected=[...state.createSelected].filter(index=>state.invoices[index]);if(!selected.length)return;if(!window.confirm(`選択した${selected.length}件をこの一覧から削除します。\n\nまだ保存していないCSVの読込内容が対象です。よろしいですか？`))return;const removing=new Set(selected);state.invoices=state.invoices.filter((_,index)=>!removing.has(index));state.createSelected=new Set(state.invoices.map((_,index)=>index));state.preview=null;renderCreate();$('#invoiceImportSummary').innerHTML=cards({'残り件数':state.invoices.length,'削除件数':selected.length,'選択件数':state.createSelected.size});$('#invoiceImportSummary').classList.remove('hidden');alert(`${selected.length}件を一覧から削除しました。`,'success');}
  function renderCreate(){const tbody=$('#createTable tbody');if(!state.invoices.length){state.createSelected.clear();tbody.innerHTML='<tr class="empty"><td colspan="11">請求書CSVを読み込むか、個別作成で1件追加してください。</td></tr>';updateCreateSelectionUi();return;}for(const index of [...state.createSelected])if(index>=state.invoices.length)state.createSelected.delete(index);tbody.innerHTML=state.invoices.map((x,i)=>`<tr><td><input type="checkbox" data-create-select="${i}" ${state.createSelected.has(i)?'checked':''} aria-label="${esc(x.partnerName||'取引先')}の請求書を選択"></td><td>${esc(x.invoiceNumber)}</td><td>${esc(x.customerCode)}</td><td>${esc(x.partnerName)} ${esc(x.honorific)}</td><td>${esc(x.subject)}</td><td class="num">${C.formatYen(x.total)}</td><td>${esc(x.email)}</td><td>${esc(x.cc)}</td><td><span class="status ${x.pdfStatus==='PDF作成済み'?'sent':'unsent'}">${esc(x.pdfStatus==='PDF作成済み'?'PDF作成済み':'送信時に自動作成')}</span></td><td>${x.warnings.length?`<span class="warning-text">${esc(x.warnings.join('／'))}</span>`:'なし'}</td><td><button class="button secondary" data-preview="${i}">表示</button></td></tr>`).join('');tbody.querySelectorAll('[data-create-select]').forEach(box=>box.onchange=()=>{const index=Number(box.dataset.createSelect);if(box.checked)state.createSelected.add(index);else state.createSelected.delete(index);updateCreateSelectionUi();});tbody.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>previewInvoice(Number(b.dataset.preview)));updateCreateSelectionUi();}
  function renderPartners()'''
s = s[:m.start()] + replacement + s[m.end():]

marker = '  function updateInvoiceFilters(){'
if marker not in s:
    raise SystemExit('MISSING:updateInvoiceFilters-marker')
save_fn = r'''  async function saveImportedInvoicesToList(){const buttons=$$('[data-save-imported-invoices]'),items=[...state.createSelected].sort((a,b)=>a-b).map(index=>state.invoices[index]).filter(Boolean);if(!items.length)return alert('保存する請求書を選択してください。','error');buttons.forEach(button=>{button.disabled=true;button.textContent='保存しています…';});showOperationOverlay(`0／${items.length}件を保存しています…`);let next=0,savedCount=0;const saved=new Array(items.length),createdAt=new Date().toISOString();try{const worker=async()=>{while(true){const index=next++;if(index>=items.length)return;const invoice={...items[index],paymentStatus:items[index].paymentStatus||'未入金',createdAt:items[index].createdAt||createdAt};saved[index]=await saveInvoiceToD1(invoice);savedCount+=1;$('#operationOverlayText').textContent=`${savedCount}／${items.length}件を保存しています…`;}};await Promise.all(Array.from({length:Math.min(5,items.length)},worker));buttons.forEach(button=>button.textContent='保存しました');state.createSelected.clear();await refreshAll(false);state.selectedInvoiceNumber=saved[0]?.invoiceNumber||'';activateStep(5);showView('invoices');alert(`${saved.length}件の請求書をD1へ保存しました。`,'success');}catch(e){await refreshAll(false);alert(`${savedCount}件を保存した後、処理を中断しました：${e.message}`,'error');}finally{hideOperationOverlay();buttons.forEach(button=>button.textContent='保存して請求書を作成');updateCreateSelectionUi();}}
'''
s = s.replace(marker, save_fn + marker, 1)

s = s.replace("  function openStudentImport(){", "  function openStudentImport(source='partners'){")
s = require_replace(s, "form.reset();state.studentCandidate=null;", "form.reset();state.studentImportSource=source;state.studentCandidate=null;", 'student-import-source')
s = require_replace(s, "$('#studentImportDialog').close();alert(`${partner['名称']}を取引先マスタへ${existing>=0?'更新':'登録'}しました。`,'success');", "$('#studentImportDialog').close();if(state.studentImportSource==='single'){showView('create');await setCreateMethod('single');singlePartnerCombo?.choose(partner['顧客コード']);}alert(`${partner['名称']}を取引先マスタへ${existing>=0?'更新':'登録'}しました。`,'success');", 'student-import-select-after')
s = s.replace("  $('#previewSingleInvoice').onclick=previewSingleInvoice;", "  $('#previewSingleInvoice')?.addEventListener('click',previewSingleInvoice);")
s = require_replace(s, "  $('#openStudentImport').onclick=openStudentImport;", "  $('#openStudentImport').onclick=()=>openStudentImport('partners');\n  $('#openStudentImportFromSingle').onclick=()=>openStudentImport('single');", 'student-import-bindings')
s = require_replace(s, "  $('#addToSend').onclick=()=>{activateStep(5);showView('invoices');renderInvoices();};", "  $$('[data-save-imported-invoices]').forEach(button=>button.onclick=saveImportedInvoicesToList);\n  $('#createSelectAll').onchange=event=>{state.createSelected=event.currentTarget.checked?new Set(state.invoices.map((_,index)=>index)):new Set();renderCreate();};\n  $$('[data-remove-create-rows]').forEach(button=>button.onclick=removeSelectedCreateRows);", 'csv-action-bindings')
p.write_text(s, encoding='utf-8')

# CSS
p = Path('assets/styles.css')
s = p.read_text(encoding='utf-8')
marker_css = '/* CSV一括作成 UI復元 — 2026-08-11 */'
if marker_css not in s:
    s += '''\n\n/* CSV一括作成 UI復元 — 2026-08-11 */\n.create-list-actions{align-items:center}\n.create-list-actions #createSelectedCount{margin-right:auto;font-weight:700}\n.create-delete-button{border-color:#f04438;background:#fff;color:#b42318}\n.create-delete-button:hover:not(:disabled),.create-delete-button:focus:not(:disabled){background:#fff1f0}\n.create-table-toolbar{display:flex;align-items:center;justify-content:flex-start;gap:12px;margin:0 0 8px;padding:0 4px;color:#475467;font-size:12px}\n.create-table-toolbar span{font-weight:700}\n.create-delete-button-top,.create-save-button-top{padding:7px 12px;font-size:12px}\n.single-partner-links{display:flex;gap:10px;align-items:center;flex-wrap:wrap}\n'''
p.write_text(s, encoding='utf-8')

print('UI restoration patch applied')
