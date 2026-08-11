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
s = s.replace('<div class="brand"><img src="assets/step-logo.png?v=20260802-logo" alt="個別指導ステップ"><div><strong>STEP請求書</strong><span>PDF作成・配信システム</span></div></div>', '<button id="brandHome" class="brand brand-home" type="button" aria-label="請求書一覧へ戻る"><img src="assets/step-logo.png?v=20260802-logo" alt="個別指導ステップ"><div><strong>STEP請求書</strong><span>PDF作成・配信システム</span></div></button>')
if '<button id="brandHome"' not in s:
    raise SystemExit('MISSING:brand-home')
p.write_text(s, encoding='utf-8')

# assets/app.js
p = Path('assets/app.js')
s = p.read_text(encoding='utf-8')
old = "async function refreshAll(syncStatuses=false){try{const data=await cloudApi('/api/app/dashboard');state.invoices=data.invoices||[];state.history=data.history||[];state.dashboardLoaded=true;restoreForms();renderCreate();renderInvoices();renderHistory();$('#userLabel').textContent=data.user||'接続済み';if(!state.supportLoaded||syncStatuses)void refreshSupportData();}catch(d1Error){try{const data=await api('getDashboard',{syncStatuses:syncStatuses===true});state.invoices=data.invoices||state.invoices;state.history=data.history||[];state.dashboardLoaded=true;applySupportDashboard(data);renderCreate();renderInvoices();renderHistory();$('#userLabel').textContent=data.user||'接続済み';alert(`D1に接続できないため、旧台帳を表示しました：${d1Error.message}`,'warning');}catch(fallbackError){alert(fallbackError.message,'error');}}}"
new = "async function refreshAll(syncStatuses=false){try{const data=await cloudApi('/api/app/dashboard');state.invoices=data.invoices||[];state.history=data.history||[];state.dashboardLoaded=true;restoreForms();renderCreate();renderInvoices();renderHistory();$('#userLabel').textContent=data.user||'接続済み';if(!state.supportLoaded||syncStatuses)await refreshSupportData();else renderPartners();}catch(d1Error){try{const data=await api('getDashboard',{syncStatuses:syncStatuses===true});state.invoices=data.invoices||state.invoices;state.history=data.history||[];state.dashboardLoaded=true;applySupportDashboard(data);renderCreate();renderInvoices();renderHistory();$('#userLabel').textContent=data.user||'接続済み';alert(`D1に接続できないため、旧台帳を表示しました：${d1Error.message}`,'warning');}catch(fallbackError){alert(fallbackError.message,'error');}}}"
if old in s:
    s = s.replace(old,new,1)
# Every fresh load/reload starts at invoice list, regardless of current hash.
s = re.sub(r"function initialViewForNavigation\(navigationType,hash=location\.hash\)\{\s*const requested=.*?\n\s*return .*?;\s*\}", "function initialViewForNavigation(navigationType,hash=location.hash){return 'invoices';}", s, count=1, flags=re.S)
if "function initialViewForNavigation(navigationType,hash=location.hash){return 'invoices';}" not in s:
    raise SystemExit('MISSING:initial-view')
old_nav = "$$('.nav-item[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));"
new_nav = "$$('.nav-item[data-view]').forEach(b=>b.onclick=async()=>{if(b.dataset.view==='partners'){await refreshSupportData();renderPartners();}showView(b.dataset.view);});\n  $('#brandHome')?.addEventListener('click',()=>showView('invoices'));"
if old_nav in s:
    s = s.replace(old_nav,new_nav,1)
p.write_text(s, encoding='utf-8')

# CSS
p = Path('assets/styles.css')
s = p.read_text(encoding='utf-8')
if '.brand-home{' not in s:
    s += '\n.brand-home{border:0;background:transparent;padding:0;margin:0;text-align:left;cursor:pointer;color:inherit;font:inherit}\n.brand-home:hover{opacity:.9}\n'
p.write_text(s, encoding='utf-8')

print('Partner master, brand navigation, and invoice-list startup restored')
