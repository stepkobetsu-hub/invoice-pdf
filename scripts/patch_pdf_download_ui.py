from pathlib import Path

index = Path('index.html')
app = Path('assets/app.js')

html = index.read_text(encoding='utf-8')
html = html.replace('<div class="dialog-head"><h2>請求書のPDF／印刷</h2><button data-close aria-label="閉じる">×</button></div>','<div class="dialog-head"><h2>請求書PDF</h2><button data-close aria-label="閉じる">×</button></div>')
html = html.replace('<div class="dialog-message"><p><strong id="pdfInvoiceTarget"></strong></p><p>PDFを端末へ保存するか、印刷画面を開きます。</p></div>','<div class="dialog-message"><p><strong id="pdfInvoiceTarget"></strong></p></div>')
html = html.replace('<div class="dialog-actions"><button data-close class="button secondary">閉じる</button><button id="printSelectedInvoice" class="button secondary preview-output-button">印刷</button><button id="downloadSelectedInvoice" class="button primary preview-output-button">PDFをダウンロード</button></div>','<div class="dialog-actions"><button data-close class="button secondary">閉じる</button><button id="downloadSelectedInvoice" class="button primary preview-output-button">PDFをダウンロード</button></div>')
html = html.replace('assets/app.js?v=20260811-ui-restored','assets/app.js?v=20260811-pdf-partner-refresh')
html = html.replace('assets/app.js?v=20260811-pdf-download','assets/app.js?v=20260811-pdf-partner-refresh')
index.write_text(html, encoding='utf-8')

js = app.read_text(encoding='utf-8')
js = js.replace("a.download=`${inv.invoiceNumber}_${inv.partnerName}${inv.honorific||'様'}${preview?'_プレビュー':''}.pdf`;", "a.download=`${inv.invoiceNumber}_${inv.partnerName}${inv.honorific||'様'}.pdf`;")
old_prepare = "async function prepareSingleInvoice(){setSingleDefaults();if(state.dashboardLoaded){updateSingleLivePreview();return;}try{const data=await cloudApi('/api/app/dashboard');if(Array.isArray(data.invoices)){state.invoices=data.invoices;state.history=data.history||[];state.dashboardLoaded=true;renderCreate();renderHistory();setSingleDefaults(true);}}catch(e){alert(`保存済み請求書の確認に失敗しました：${e.message}`,'error');}finally{updateSingleLivePreview();}}"
new_prepare = "async function prepareSingleInvoice(){setSingleDefaults();await refreshSupportData();if(state.dashboardLoaded){renderPartnerOptions();updateSingleLivePreview();return;}try{const data=await cloudApi('/api/app/dashboard');if(Array.isArray(data.invoices)){state.invoices=data.invoices;state.history=data.history||[];state.dashboardLoaded=true;renderCreate();renderHistory();renderPartnerOptions();setSingleDefaults(true);}}catch(e){alert(`保存済み請求書の確認に失敗しました：${e.message}`,'error');}finally{updateSingleLivePreview();}}"
if old_prepare not in js:
    raise SystemExit('prepareSingleInvoice pattern not found')
js = js.replace(old_prepare, new_prepare)
old_handler = "$('#downloadSelectedInvoice').onclick=()=>state.preview&&createPdf(state.preview,{save:true}).catch(e=>alert(e.message,'error'));\n  $('#printSelectedInvoice').onclick=()=>{if(!state.preview)return;$('#invoicePdfDialog').close();showInvoicePreview(state.preview);setTimeout(printPreview,50);};"
new_handler = "$('#downloadSelectedInvoice').onclick=async()=>{if(!state.preview)return;const target=state.preview;try{await createPdf(target,{save:true});const index=state.invoices.findIndex(item=>String(item.invoiceNumber)===String(target.invoiceNumber));if(index>=0){const updated={...state.invoices[index],dlStatus:'DL済',downloadedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};const saved=await saveInvoiceToD1(updated);state.invoices[index]=saved;state.preview=saved;renderInvoices();}$('#invoicePdfDialog').close();}catch(e){alert(e.message,'error');}};"
if old_handler in js:
    js = js.replace(old_handler, new_handler)
elif "$('#downloadSelectedInvoice').onclick=async()=>" not in js:
    raise SystemExit('download handler pattern not found')
app.write_text(js, encoding='utf-8')
