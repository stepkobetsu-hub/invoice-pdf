from pathlib import Path
p=Path('assets/app.js')
s=p.read_text(encoding='utf-8')
old="async function refreshSupportData(){if(!state.settings.apiUrl)return;try{const data=await api('getSupportData');applySupportDashboard(data);return;}catch(primaryError){try{const legacy=await api('getDashboard',{syncStatuses:false});if(Array.isArray(legacy?.partners)){applySupportDashboard(legacy);return;}throw primaryError;}catch(fallbackError){alert(`取引先・設定の読み込みに失敗しました：${fallbackError.message}`,'warning');}}}"
new="async function refreshSupportData(){if(!state.settings.apiUrl)return;let primaryError=null;try{const data=await api('getSupportData');if(Array.isArray(data?.partners)&&data.partners.length){applySupportDashboard(data);return;}primaryError=new Error('getSupportData returned no partners');}catch(error){primaryError=error;}try{const legacy=await api('getDashboard',{syncStatuses:false});if(Array.isArray(legacy?.partners)&&legacy.partners.length){applySupportDashboard(legacy);return;}throw primaryError||new Error('取引先データが空です。');}catch(fallbackError){const cached=JSON.parse(localStorage.getItem('stepInvoicePartners')||'[]');if(Array.isArray(cached)&&cached.length){state.partners=cached;renderPartners();renderPartnerOptions();window.StepReceipts?.refreshPartners?.();return;}alert(`取引先・設定の読み込みに失敗しました：${fallbackError.message}`,'warning');}}"
if old not in s: raise SystemExit('refreshSupportData anchor missing')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
p=Path('index.html');s=p.read_text(encoding='utf-8');s=s.replace('assets/app.js?v=20260811-partner-fallback','assets/app.js?v=20260811-partner-empty-recovery');p.write_text(s,encoding='utf-8')
print('fixed empty partner support recovery')
