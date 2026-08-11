from pathlib import Path

index = Path('index.html')
app = Path('assets/app.js')

html = index.read_text(encoding='utf-8')
html = html.replace('<div class="dialog-head"><h2>請求書のPDF／印刷</h2><button data-close aria-label="閉じる">×</button></div>','<div class="dialog-head"><h2>請求書PDF</h2><button data-close aria-label="閉じる">×</button></div>')
html = html.replace('<div class="dialog-message"><p><strong id="pdfInvoiceTarget"></strong></p><p>PDFを端末へ保存するか、印刷画面を開きます。</p></div>','<div class="dialog-message"><p><strong id="pdfInvoiceTarget"></strong></p></div>')
html = html.replace('<div class="dialog-actions"><button data-close class="button secondary">閉じる</button><button id="printSelectedInvoice" class="button secondary preview-output-button">印刷</button><button id="downloadSelectedInvoice" class="button primary preview-output-button">PDFをダウンロード</button></div>','<div class="dialog-actions"><button data-close class="button secondary">閉じる</button><button id="downloadSelectedInvoice" class="button primary preview-output-button">PDFをダウンロード</button></div>')
html = html.replace('<span id="modeBadge" class="badge warning">テスト送信モード</span>','<span id="modeBadge" class="badge">通常送信</span>')
html = html.replace('<div class="page-heading"><div><h1>メール設定</h1><p>本番送信は管理者の最終承認まで有効化できません。</p></div></div>','<div class="page-heading"><div><h1>メール設定</h1><p>請求書の送信元・返信先・本文などを設定します。</p></div></div>')
html = html.replace('<label>テスト送信先<input name="testRecipient" value="stepkobetsu@gmail.com"></label>','<input name="testRecipient" type="hidden" value="">')
html = html.replace('<div class="span-2 test-banner">テスト送信モード — 実際の取引先には送信されません</div>','')
html = html.replace('<button id="sendTest" class="button secondary" type="button">テスト送信</button>','')
html = html.replace('assets/app.js?v=20260811-production-mail-ui','assets/app.js?v=20260811-production-mail-clean')
html = html.replace('assets/app.js?v=20260811-real-recipient','assets/app.js?v=20260811-production-mail-clean')
html = html.replace('assets/app.js?v=20260811-pdf-partner-refresh22','assets/app.js?v=20260811-production-mail-clean')
html = html.replace('assets/app.js?v=20260811-pdf-partner-refresh2','assets/app.js?v=20260811-production-mail-clean')
index.write_text(html, encoding='utf-8')

js = app.read_text(encoding='utf-8')
js = js.replace("a.download=`${inv.invoiceNumber}_${inv.partnerName}${inv.honorific||'様'}${preview?'_プレビュー':''}.pdf`;", "a.download=`${inv.invoiceNumber}_${inv.partnerName}${inv.honorific||'様'}.pdf`;")
old_prepare = "async function prepareSingleInvoice(){setSingleDefaults();if(state.dashboardLoaded){updateSingleLivePreview();return;}try{const data=await cloudApi('/api/app/dashboard');if(Array.isArray(data.invoices)){state.invoices=data.invoices;state.history=data.history||[];state.dashboardLoaded=true;renderCreate();renderHistory();setSingleDefaults(true);}}catch(e){alert(`保存済み請求書の確認に失敗しました：${e.message}`,'error');}finally{updateSingleLivePreview();}}"
new_prepare = "async function prepareSingleInvoice(){setSingleDefaults();await refreshSupportData();if(state.dashboardLoaded){renderPartnerOptions();updateSingleLivePreview();return;}try{const data=await cloudApi('/api/app/dashboard');if(Array.isArray(data.invoices)){state.invoices=data.invoices;state.history=data.history||[];state.dashboardLoaded=true;renderCreate();renderHistory();renderPartnerOptions();setSingleDefaults(true);}}catch(e){alert(`保存済み請求書の確認に失敗しました：${e.message}`,'error');}finally{updateSingleLivePreview();}}"
if old_prepare in js:
    js = js.replace(old_prepare, new_prepare)
elif 'await refreshSupportData();if(state.dashboardLoaded)' not in js:
    raise SystemExit('prepareSingleInvoice pattern not found')
old_handler = "$('#downloadSelectedInvoice').onclick=()=>state.preview&&createPdf(state.preview,{save:true}).catch(e=>alert(e.message,'error'));\n  $('#printSelectedInvoice').onclick=()=>{if(!state.preview)return;$('#invoicePdfDialog').close();showInvoicePreview(state.preview);setTimeout(printPreview,50);};"
new_handler = "$('#downloadSelectedInvoice').onclick=async()=>{if(!state.preview)return;const target=state.preview;try{await createPdf(target,{save:true});const index=state.invoices.findIndex(item=>String(item.invoiceNumber)===String(target.invoiceNumber));if(index>=0){const updated={...state.invoices[index],dlStatus:'DL済',downloadedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};const saved=await saveInvoiceToD1(updated);state.invoices[index]=saved;state.preview=saved;renderInvoices();}$('#invoicePdfDialog').close();}catch(e){alert(e.message,'error');}};"
if old_handler in js:
    js = js.replace(old_handler, new_handler)
elif "$('#downloadSelectedInvoice').onclick=async()=>" not in js:
    raise SystemExit('download handler pattern not found')
js = js.replace('testMode:true', 'testMode:false')
old_to = "$('#mailTo').textContent=settings.testRecipient?`${settings.testRecipient}（テスト送信先／本来の宛先：${invoice.email}）`:invoice.email;"
if old_to in js:
    js = js.replace(old_to, "$('#mailTo').textContent=invoice.email;")
js = js.replace("  $('#sendTest').onclick=()=>alert('請求書を1件選択して、請求書一覧からテスト送信してください。');\n", '')
if 'testMode:true' in js:
    raise SystemExit('testMode:true remains in app.js')
app.write_text(js, encoding='utf-8')
