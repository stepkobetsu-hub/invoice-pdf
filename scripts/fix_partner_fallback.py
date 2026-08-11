from pathlib import Path

p=Path('assets/app.js')
s=p.read_text(encoding='utf-8')
old="""  async function refreshSupportData(){if(!state.settings.apiUrl)return;try{const data=await api('getSupportData');applySupportDashboard(data);}catch(e){alert(`取引先・設定の読み込みは継続できませんでした：${e.message}`,'warning');}}"""
new="""  async function refreshSupportData(){if(!state.settings.apiUrl)return;try{const data=await api('getSupportData');applySupportDashboard(data);return;}catch(primaryError){try{const legacy=await api('getDashboard',{syncStatuses:false});if(Array.isArray(legacy?.partners)){applySupportDashboard(legacy);return;}throw primaryError;}catch(fallbackError){alert(`取引先・設定の読み込みに失敗しました：${fallbackError.message}`,'warning');}}}"""
if old not in s:
    raise SystemExit('MISSING:refreshSupportData')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')

p=Path('index.html')
s=p.read_text(encoding='utf-8')
s=s.replace('assets/app.js?v=20260811-invoice-checkboxes','assets/app.js?v=20260811-partner-fallback')
p.write_text(s,encoding='utf-8')
print('partner fallback fixed')
