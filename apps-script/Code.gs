/** STEP請求書PDF作成・配信システム backend. Public deployment v0.1.25. */
const STEP = Object.freeze({
  AUTH_API:'https://script.google.com/macros/s/AKfycbypkUc0MqZ07E7pZRglNPeRM56WbCcuWaLpRzi9bVFcPklHDxaaLC7GfzG6ozTGCbEX/exec',
  AUTH_PERMISSION_LEVELS:['2','3','4'],
  STUDENT_MASTER: {SPREADSHEET_ID:'1CIJkTlYUcUkbb8jBdFc6L8D5ubTGsxwNxFv01ten-Zk',SHEET_NAME:'☆マスタ'},
  SHEETS: {
    PARTNERS: '取引先マスタ', SETTINGS: '基本設定', TEMPLATES: 'メール定型文', INVOICES: '請求書データ',
    DETAILS: '請求書明細', DELIVERIES: '請求書配信履歴', DOWNLOADS: 'ダウンロード履歴', LOGS: '操作ログ',
    USERS: 'ユーザー権限', QUEUE: '送信キュー'
  },
  PARTNER_HEADERS: ['顧客コード','名称','名称(カナ)','敬称','支払い期限(月)','支払い期限(日)','土日祝日','郵便番号','都道府県','住所1','住所2','担当者部署','担当者役職','担当者氏名','電話番号','メールアドレス','CCメールアドレス','自社担当者名','Peppol ID','メモ'],
  INVOICE_HEADERS: ['請求書番号','顧客コード','宛名','敬称','対象年月','請求日','支払期限','郵便番号','住所','税抜小計','消費税額','請求金額','メールアドレス','CCメールアドレス','PDF状態','PDFファイルID','PDFファイル名','現在状態','作成日時','更新日時','メモ','タグ','入金状態','入金日','振込先','備考'],
  DETAIL_HEADERS: ['請求書番号','行番号','納品日','品目・納品書番号','品目コード','単価','数量','単位','価格','税率'],
  DELIVERY_HEADERS: ['配信ID','請求書番号','顧客コード','宛名','送信先メールアドレス','CCメールアドレス','メール件名','送信日時','送信状態','送信エラー','ダウンロードトークンハッシュ','トークン有効開始日時','トークン有効期限','初回アクセス日時','初回ダウンロード日時','最終アクセス日時','アクセス回数','ダウンロード回数','現在状態','PDFファイルID','PDFファイル名','再送回数','最終再送日時','無効化日時','作成者','作成日時','更新日時'],
  DOWNLOAD_HEADERS: ['日時','配信ID','請求書番号','種別','結果','ユーザーエージェント保存有無','IP保存有無'],
  LOG_HEADERS: ['日時','操作者','操作種別','請求書番号','顧客コード','配信ID','結果','エラー','変更前','変更後'],
  USER_HEADERS: ['メールアドレス','表示名','管理者','PDF作成','メール送信','再送','配信停止','取引先編集','基本設定変更','履歴閲覧','有効'],
  QUEUE_HEADERS: ['キューID','配信ID','請求書番号','テストモード','再送','新規トークン','状態','試行回数','登録日時','開始日時','完了日時','エラー'],
  TEMPLATE_HEADERS: ['テンプレートID','名称','件名','本文','有効'],
  SETTING_HEADERS: ['キー','値','説明']
});

// SpreadsheetApp.openById is comparatively expensive. Keep one spreadsheet and
// one Sheet object per name for the lifetime of a single Apps Script execution.
let STEP_SPREADSHEET_CACHE_ = null;
const STEP_SHEET_CACHE_ = {};

function doGet(e) {
  const token = String((e && e.parameter && e.parameter.t) || '');
  if (!token) return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><title>STEP請求書</title><p>STEP請求書配信サービスは稼働中です。</p>');
  log_('旧Google配信URLアクセス','','','','終了','Cloudflare版へ移行済み');
  return HtmlService.createHtmlOutput('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新しい配信URLをご確認ください</title><style>body{font-family:system-ui,sans-serif;background:#f5f7fb;color:#1b2a4a;margin:0;padding:48px 20px}.card{max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 10px 30px #1b2a4a18}h1{font-size:22px}p{line-height:1.8}</style></head><body><main class="card"><h1>このGoogle経由の配信URLは終了しました。</h1><p>PDFはGoogle DriveではなくCloudflareの保護された保管場所から配信しています。最新の案内メールに記載されたURLをご確認ください。</p><p>ご不明な場合は個別指導ステップ（0568-41-8937）までお問い合わせください。</p></main></body></html>').setTitle('新しい配信URLをご確認ください');
}

function doPost(e) {
  try {
    const isForm = !!(e && e.parameter && e.parameter.bridge === '1');
    const body = isForm ? {
      action: e.parameter.action || '',
      payload: JSON.parse(e.parameter.payload || '{}'),
      authToken: e.parameter.authToken || '',
      systemPortalSessionToken: e.parameter.systemPortalSessionToken || ''
    } : JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const requestAuth = verifyRequestAuth_(body);
    const action = String(body.action || '');
    const payload = body.payload || {};
    const routes = {
      getDashboard: () => getDashboard_(requestAuth), importPartners: () => importPartners_(payload.partners || [], requestAuth),
      deletePartner: () => deletePartner_(payload.customerCode, requestAuth),
      findStudentForPartner: () => findStudentForPartner_(payload.studentCode, requestAuth),
      savePdf: () => savePdf_(payload.invoice || {}, payload.pdfBase64 || '', requestAuth), saveInvoiceData: () => saveInvoiceData_(payload.invoice || {}, requestAuth),
      updatePaymentStatus: () => updatePaymentStatus_(payload.invoiceNumber, payload.paymentStatus, payload.paymentDate, requestAuth), deleteInvoice: () => deleteInvoice_(payload.invoiceNumber, requestAuth),
      enqueueSend: () => enqueueSend_(payload, requestAuth),
      prepareSend: () => enqueueSend_(Object.assign({}, payload, {preflight:true}), requestAuth),
      releasePreparedSend: () => releasePreparedSend_(payload.deliveryId, requestAuth),
      disableDelivery: () => disableDelivery_(payload.invoiceNumber, requestAuth), saveSettings: () => saveSettings_(payload, requestAuth),
      recoverQueue: () => recoverStuckQueue_(requestAuth),
      processPendingSends: () => processPendingSends_(requestAuth)
    };
    if (!routes[action]) throw new Error('未対応の操作です。');
    const result = {ok:true,data:routes[action]()};
    return isForm ? bridgeResponse_(result, e.parameter.requestId || '', e.parameter.bridgeNonce || '') : json_(result);
  } catch (err) {
    const result = {ok:false,error:safeError_(err)};
    return e && e.parameter && e.parameter.bridge === '1'
      ? bridgeResponse_(result, e.parameter.requestId || '', e.parameter.bridgeNonce || '')
      : json_(result);
  }
}

function setupSystem() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheet;
  if (props.getProperty('SPREADSHEET_ID')) spreadsheet = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  else { spreadsheet = SpreadsheetApp.create('STEP請求書PDF作成・配信システム'); props.setProperty('SPREADSHEET_ID', spreadsheet.getId()); }
  const specs = [
    [STEP.SHEETS.PARTNERS, STEP.PARTNER_HEADERS], [STEP.SHEETS.SETTINGS, STEP.SETTING_HEADERS], [STEP.SHEETS.TEMPLATES, STEP.TEMPLATE_HEADERS],
    [STEP.SHEETS.INVOICES, STEP.INVOICE_HEADERS], [STEP.SHEETS.DETAILS, STEP.DETAIL_HEADERS], [STEP.SHEETS.DELIVERIES, STEP.DELIVERY_HEADERS],
    [STEP.SHEETS.DOWNLOADS, STEP.DOWNLOAD_HEADERS], [STEP.SHEETS.LOGS, STEP.LOG_HEADERS], [STEP.SHEETS.USERS, STEP.USER_HEADERS], [STEP.SHEETS.QUEUE, STEP.QUEUE_HEADERS]
  ];
  specs.forEach(([name,headers]) => ensureSheet_(spreadsheet,name,headers));
  const first = spreadsheet.getSheets()[0]; if (!specs.some(x => x[0] === first.getName()) && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(first);
  seedSettings_(spreadsheet);
  seedTemplate_(spreadsheet);
  seedCurrentUser_(spreadsheet);
  if (!props.getProperty('ADMIN_API_KEY')) props.setProperty('ADMIN_API_KEY', createToken_()+createToken_());
  props.setProperties({PRODUCTION_SEND_APPROVED:'false',APPROVED_PDF_TEMPLATE:'stage1-approved-v1',SYSTEM_VERSION:'0.1.0'}, false);
  installQueueTrigger_();
  return {spreadsheetUrl:spreadsheet.getUrl(),spreadsheetId:spreadsheet.getId(),webAppUrl:ScriptApp.getService().getUrl() || '',adminApiKey:props.getProperty('ADMIN_API_KEY'),cloudflareConfigured:Boolean(props.getProperty('CLOUDFLARE_API_URL')&&props.getProperty('CLOUDFLARE_ADMIN_API_KEY'))};
}

function getPdfForToken(token) {
  throw new Error('Google経由のPDF配信は終了しました。最新のCloudflare配信URLをご利用ください。');
}

function processSendQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const settings = settings_();
    const limit = Math.max(1, Math.min(20, Number(settings.batchSize || 5)));
    const queueSheet = sheet_(STEP.SHEETS.QUEUE), data = table_(queueSheet), now = new Date();
    const pending = data.rows.filter(x => x.values[data.map['状態']] === '送信待ち').slice(0,limit);
    pending.forEach(item => {
      try {
        updateRow_(queueSheet,item.rowNumber,data.map,{'状態':'送信中','開始日時':now,'試行回数':Number(item.values[data.map['試行回数']]||0)+1});
        sendOne_(item.values,data.map,settings);
        updateRow_(queueSheet,item.rowNumber,data.map,{'状態':'完了','完了日時':new Date(),'エラー':''});
      } catch (err) {
        updateRow_(queueSheet,item.rowNumber,data.map,{'状態':'送信失敗','完了日時':new Date(),'エラー':safeError_(err)});
        updateDeliveryById_(item.values[data.map['配信ID']],{'送信状態':'送信失敗','送信エラー':safeError_(err),'現在状態':'送信失敗','更新日時':new Date()});
        log_('メール送信',item.values[data.map['請求書番号']],'',item.values[data.map['配信ID']],'失敗',safeError_(err));
      }
    });
  } finally { lock.releaseLock(); }
}

function importPartners_(partners, requestAuth) {
  requirePermission_('取引先編集', requestAuth);
  if (!Array.isArray(partners) || !partners.length) throw new Error('取引先データがありません。');
  const sheet = sheet_(STEP.SHEETS.PARTNERS);
  const rows = partners.map(p => STEP.PARTNER_HEADERS.map(h => String(p[h] == null ? '' : p[h])));
  if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow()-1,STEP.PARTNER_HEADERS.length).clearContent();
  sheet.getRange(2,1,rows.length,STEP.PARTNER_HEADERS.length).setNumberFormat('@').setValues(rows);
  log_('取引先変更','','','','成功','');
  return {count:rows.length};
}

function deletePartner_(customerCode, requestAuth) {
  requirePermission_('取引先編集', requestAuth);
  const code=String(customerCode||'').trim();
  if(!code)throw new Error('削除する顧客コードがありません。');
  const sh=sheet_(STEP.SHEETS.PARTNERS),t=table_(sh);
  const targets=t.rows.filter(r=>String(r.values[t.map['顧客コード']]).trim()===code).reverse();
  targets.forEach(r=>sh.deleteRow(r.rowNumber));
  log_('取引先削除','',code,'',targets.length?'成功':'対象なし','');
  return {deleted:targets.length};
}

function findStudentForPartner_(studentCode, requestAuth) {
  requirePermission_('取引先編集', requestAuth);
  const code = String(studentCode == null ? '' : studentCode).trim().replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (!code) throw new Error('生徒コードを入力してください。');
  if (!/^[A-Za-z0-9]+$/.test(code)) throw new Error('生徒コードは半角英数で入力してください。');
  const cache = CacheService.getScriptCache(), cacheKey = 'student-partner:' + code.toLowerCase(), cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { cache.remove(cacheKey); }
  }
  const master = SpreadsheetApp.openById(STEP.STUDENT_MASTER.SPREADSHEET_ID);
  const sheet = master.getSheetByName(STEP.STUDENT_MASTER.SHEET_NAME);
  if (!sheet) throw new Error('生徒マスタの「☆マスタ」シートが見つかりません。');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('生徒マスタにデータがありません。');
  const found = sheet.getRange(2,1,lastRow-1,1).createTextFinder(code).matchEntireCell(true).findNext();
  if (!found) throw new Error('一致する生徒コードが見つかりません。');
  const row = sheet.getRange(found.getRow(),1,1,24).getDisplayValues()[0];
  if (String(row[0]).trim() !== code) throw new Error('一致する生徒コードが見つかりません。');
  const student = {
    studentCode:String(row[0] || '').trim(), name:String(row[4] || '').trim(), kana:String(row[5] || '').trim(),
    grade:String(row[9] || '').trim(), postal:String(row[19] || '').trim(), addressU:String(row[20] || '').trim(),
    addressV:String(row[21] || '').trim(), addressW:String(row[22] || '').trim(), email:String(row[23] || '').trim()
  };
  cache.put(cacheKey, JSON.stringify(student), 300);
  return student;
}

function savePdf_(invoice, pdfBase64, requestAuth) {
  requirePermission_('PDF作成', requestAuth);
  ensureInvoiceColumns_();
  if (!/^\d{6,}$/.test(String(invoice.invoiceNumber || ''))) throw new Error('請求書番号が不正です。');
  if (!pdfBase64) throw new Error('PDFデータがありません。');
  const expectedTotal = Math.floor((Number(invoice.sourceTotal == null ? invoice.total : invoice.sourceTotal) + 5) / 10) * 10;
  if (Number(invoice.total) !== expectedTotal || Number(invoice.tax) !== expectedTotal - Number(invoice.subtotal)) throw new Error('10円単位の丸め結果または税額が一致しません。');
  const fileName = safeFileName_(`${invoice.invoiceNumber}_${invoice.partnerName}${invoice.honorific || '様'}.pdf`);
  const result = cloudflareAdminFetch_('/api/admin/invoices','post',{invoice:invoice,pdfBase64:pdfBase64});
  upsertInvoice_(invoice,result.invoiceId,fileName);
  log_('PDF作成',invoice.invoiceNumber,invoice.customerCode,'','成功','',{}, {storage:'Cloudflare R2',invoiceId:result.invoiceId});
  return {pdfFileId:result.invoiceId,pdfFileName:fileName,storage:'Cloudflare R2'};
}

function saveInvoiceData_(invoice, requestAuth) {
  requirePermission_('PDF作成', requestAuth);
  ensureInvoiceColumns_();
  const number=String(invoice.invoiceNumber||'').trim();
  if(!/^\d{6,}$/.test(number))throw new Error('請求書番号が不正です。');
  if(!String(invoice.partnerName||'').trim())throw new Error('取引先名を入力してください。');
  if(!Array.isArray(invoice.details)||!invoice.details.length)throw new Error('請求明細を1行以上入力してください。');
  const sh=sheet_(STEP.SHEETS.INVOICES),t=table_(sh),existing=t.rows.find(r=>String(r.values[t.map['請求書番号']])===number),now=new Date(),partner=findPartner_(invoice.customerCode,invoice.partnerName);
  const payment=['未設定','未入金','入金済'].includes(String(invoice.paymentStatus||''))?String(invoice.paymentStatus):'未入金';
  const paymentDate=payment==='入金済'?String(invoice.paymentDate||(existing&&t.map['入金日']!==undefined?existing.values[t.map['入金日']]:'')||''):'';
  const row={'請求書番号':number,'顧客コード':String(invoice.customerCode||''),'宛名':String(invoice.partnerName||''),'敬称':String(invoice.honorific||'様'),'対象年月':String(invoice.subject||''),'請求日':invoice.invoiceDate||'','支払期限':invoice.dueDate||'','郵便番号':String(invoice.postal||partner['郵便番号']||''),'住所':String(invoice.prefecture||partner['都道府県']||'')+String(invoice.address1||partner['住所1']||'')+String(invoice.address2||partner['住所2']||''),'税抜小計':Number(invoice.subtotal||0),'消費税額':Number(invoice.tax||0),'請求金額':Number(invoice.total||0),'メールアドレス':partner['メールアドレス']||invoice.email||'','CCメールアドレス':partner['CCメールアドレス']||invoice.cc||'','PDF状態':String(invoice.pdfStatus||'未作成'),'PDFファイルID':String(invoice.pdfFileId||''),'PDFファイル名':String(invoice.pdfFileName||''),'現在状態':String(invoice.sendStatus||'未送信'),'作成日時':existing?existing.values[t.map['作成日時']]:now,'更新日時':now,'メモ':String(invoice.memo||''),'タグ':String(invoice.tags||''),'入金状態':payment,'入金日':paymentDate,'振込先':String(invoice.bank||''),'備考':String(invoice.note||'')};
  if(existing)updateRow_(sh,existing.rowNumber,t.map,row);else sh.appendRow(STEP.INVOICE_HEADERS.map(h=>row[h]));
  replaceInvoiceDetails_(number,invoice.details);
  log_(existing?'請求書編集':'請求書作成',number,row['顧客コード'],'','成功','',{}, {paymentStatus:payment,total:row['請求金額']});
  return {invoiceNumber:number,created:!existing,paymentStatus:payment};
}

function updatePaymentStatus_(invoiceNumber, paymentStatus, paymentDate, requestAuth) {
  requirePermission_('PDF作成', requestAuth);
  ensureInvoiceColumns_();
  const number=String(invoiceNumber||''),status=String(paymentStatus||''),paidAt=status==='入金済'?String(paymentDate||''):'';
  if(!['未設定','未入金','入金済'].includes(status))throw new Error('入金状態が不正です。');
  if(status==='入金済'&&!/^\d{4}-\d{2}-\d{2}$/.test(paidAt))throw new Error('入金日をカレンダーから選択してください。');
  const sh=sheet_(STEP.SHEETS.INVOICES),t=table_(sh),row=t.rows.find(r=>String(r.values[t.map['請求書番号']])===number);
  if(!row)throw new Error('請求書が見つかりません。');
  const before=String(row.values[t.map['入金状態']]||'未入金'),beforeDate=t.map['入金日']===undefined?'':formatDate_(row.values[t.map['入金日']]);
  updateRow_(sh,row.rowNumber,t.map,{'入金状態':status,'入金日':paidAt,'更新日時':new Date()});
  log_('入金状態変更',number,String(row.values[t.map['顧客コード']]||''),'','成功','',{status:before,paymentDate:beforeDate},{status:status,paymentDate:paidAt});
  return {invoiceNumber:number,paymentStatus:status,paymentDate:paidAt};
}

function deleteInvoice_(invoiceNumber, requestAuth) {
  requirePermission_('PDF作成', requestAuth);
  const number=String(invoiceNumber||'').trim();if(!number)throw new Error('削除する請求書番号がありません。');
  const sh=sheet_(STEP.SHEETS.INVOICES),t=table_(sh),rows=t.rows.filter(r=>String(r.values[t.map['請求書番号']])===number).reverse();
  if(!rows.length)throw new Error('請求書が見つかりません。');
  invalidateByInvoice_(number);rows.forEach(row=>sh.deleteRow(row.rowNumber));
  const ds=sheet_(STEP.SHEETS.DETAILS),dt=table_(ds);dt.rows.filter(row=>String(row.values[dt.map['請求書番号']])===number).reverse().forEach(row=>ds.deleteRow(row.rowNumber));
  log_('請求書削除',number,'','','成功','');return {deleted:rows.length,invoiceNumber:number};
}

function replaceInvoiceDetails_(number, details) {
  const ds=sheet_(STEP.SHEETS.DETAILS),dt=table_(ds),invoiceNumber=String(number);
  const retained=dt.rows
    .filter(r=>String(r.values[dt.map['請求書番号']])!==invoiceNumber)
    .map(r=>STEP.DETAIL_HEADERS.map(header=>r.values[dt.map[header]]));
  const replacements=(details||[]).map((d,i)=>[invoiceNumber,i+1,d.deliveryDate||'',d.name||'',d.itemCode||'',Number(d.unitPrice||0),Number(d.quantity||0),d.unit||'',Number(d.amount||0),d.taxRate||'']);
  const rows=retained.concat(replacements),existingRows=Math.max(0,ds.getLastRow()-1);
  if(existingRows)ds.getRange(2,1,existingRows,STEP.DETAIL_HEADERS.length).clearContent();
  if(rows.length)ds.getRange(2,1,rows.length,STEP.DETAIL_HEADERS.length).setValues(rows);
}

function enqueueSend_(payload, requestAuth) {
  requirePermission_(payload.resend ? '再送' : 'メール送信', requestAuth);
  const testMode = payload.testMode !== false;
  if (!testMode && PropertiesService.getScriptProperties().getProperty('PRODUCTION_SEND_APPROVED') !== 'true') throw new Error('本番送信は管理者の最終承認前のため無効です。');
  const numbers = [...new Set((payload.invoiceNumbers || []).map(String))]; if (!numbers.length) throw new Error('請求書が選択されていません。');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  let response;
  try {
    const queue = sheet_(STEP.SHEETS.QUEUE), deliveries = table_(sheet_(STEP.SHEETS.DELIVERIES)), invoices = table_(sheet_(STEP.SHEETS.INVOICES));
    const queued = table_(queue).rows;
    const results=[];
    numbers.forEach(number => {
      const inv = invoices.rows.find(x => String(x.values[invoices.map['請求書番号']]) === number); if (!inv) throw new Error(`${number}: 請求書データがありません。`);
      if (inv.values[invoices.map['PDF状態']] !== 'PDF作成済み') throw new Error(`${number}: PDF未作成です。`);
      const email = inv.values[invoices.map['メールアドレス']]; if (!email) throw new Error(`${number}: メールアドレス未登録です。`);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${number}: メールアドレス形式不正です。`);
      if (queued.some(q => String(q.values[table_(queue).map['請求書番号']]) === number && ['送信待ち','送信中'].includes(q.values[table_(queue).map['状態']]))) throw new Error(`${number}: 既に送信キューへ登録されています。`);
      if (payload.resend && payload.newToken !== false) invalidateByInvoice_(number);
      const deliveryId = Utilities.getUuid(), queueId = Utilities.getUuid(), now = new Date();
      const settings=settings_(), expires=new Date(now.getTime()+Number(settings.validDays||45)*86400000);
      const subject=String(settings.subject||'【請求書】送付のご案内（個別指導ステップから）');
      const prepared = payload.preflight === true, initialStatus = prepared ? '送信前確認' : '送信待ち';
      const cloudDelivery=createCloudflareDelivery_({deliveryId:deliveryId,invoiceNumber:number,recipientEmail:email,ccEmail:inv.values[invoices.map['CCメールアドレス']],expiresAt:expires,createdBy:activeEmail_()||requestAuth.name||'apps-script'});
      sheet_(STEP.SHEETS.DELIVERIES).appendRow([deliveryId,number,inv.values[invoices.map['顧客コード']],inv.values[invoices.map['宛名']],email,inv.values[invoices.map['CCメールアドレス']],subject,'',initialStatus,'','Cloudflare管理',now,expires,'','','',0,0,initialStatus,inv.values[invoices.map['PDFファイルID']],inv.values[invoices.map['PDFファイル名']],payload.resend?1:0,payload.resend?now:'','',activeEmail_(),now,now]);
      cacheDownloadUrlForQueue_(deliveryId,cloudDelivery.downloadUrl);
      queue.appendRow([queueId,deliveryId,number,testMode,payload.resend===true,payload.newToken!==false,initialStatus,0,now,'','','']);
      results.push({invoiceNumber:number,deliveryId,queueId,preflightUrl:prepared?cloudDelivery.downloadUrl:''});
      log_(payload.resend?'再送':'メール送信',number,inv.values[invoices.map['顧客コード']],deliveryId,'キュー登録','');
    });
    response={queued:results.length,items:results,testMode};
  } finally { lock.releaseLock(); }
  installQueueTrigger_();
  return response;
}

function releasePreparedSend_(deliveryId, requestAuth) {
  requirePermission_('メール送信', requestAuth);
  const id=String(deliveryId||''); if(!id) throw new Error('配信IDがありません。');
  const queueSheet=sheet_(STEP.SHEETS.QUEUE), queue=table_(queueSheet);
  const q=queue.rows.find(r=>String(r.values[queue.map['配信ID']])===id); if(!q) throw new Error('送信前確認キューがありません。');
  if(q.values[queue.map['状態']]!=='送信前確認') throw new Error('送信前確認中のキューではありません。');
  const delivery=findDeliveryById_(id); if(!delivery) throw new Error('配信履歴がありません。');
  const d=delivery.values,m=delivery.map,settings=settings_();
  if(String(q.values[queue.map['テストモード']])!=='true'&&q.values[queue.map['テストモード']]!==true) throw new Error('本番送信はこの確認処理では解除できません。');
  if(String(settings.testRecipient||'').toLowerCase()!==String(d[m['送信先メールアドレス']]||'').toLowerCase()) throw new Error('テスト送信先が請求書の送信先と一致しません。');
  if(d[m['無効化日時']]) throw new Error('このURLは既に無効です。');
  if(new Date(d[m['トークン有効期限']]).getTime()<Date.now()) throw new Error('このURLは期限切れです。');
  const now=new Date();
  updateRow_(queueSheet,q.rowNumber,queue.map,{'状態':'送信待ち','開始日時':'','完了日時':'','エラー':''});
  updateDeliveryById_(id,{'送信状態':'送信待ち','送信エラー':'','初回アクセス日時':'','初回ダウンロード日時':'','最終アクセス日時':'','アクセス回数':0,'ダウンロード回数':0,'現在状態':'送信待ち','更新日時':now});
  log_('送信前URL確認',d[m['請求書番号']],d[m['顧客コード']],id,'成功','');
  installQueueTrigger_();
  processSendQueue();
  return {released:true,invoiceNumber:d[m['請求書番号']]};
}

function sendOne_(queueValues, queueMap, settings) {
  const deliveryId=queueValues[queueMap['配信ID']], delivery=findDeliveryById_(deliveryId); if(!delivery) throw new Error('配信履歴がありません。');
  const d=delivery.values,m=delivery.map;
  const testMode=String(queueValues[queueMap['テストモード']])==='true'||queueValues[queueMap['テストモード']]===true;
  const recipient=testMode?settings.testRecipient:d[m['送信先メールアドレス']]; if(!recipient) throw new Error(testMode?'テスト送信先未登録':'メールアドレス未登録');
  let url=takeCachedDownloadUrl_(deliveryId);
  if(!url)url=rotateCloudflareDelivery_(deliveryId,d[m['トークン有効期限']]).downloadUrl;
  if(!/^https:\/\//.test(url)||/script\.google\.com|drive\.google\.com/i.test(url))throw new Error('Cloudflare配信URLを発行できませんでした。');
  const invoice=findInvoice_(d[m['請求書番号']]);
  const values={'取引先名':d[m['宛名']],'敬称':invoice.敬称||'様','顧客コード':d[m['顧客コード']],'対象年月':invoice.対象年月||'','請求書番号':d[m['請求書番号']],'請求金額':Number(invoice.請求金額||0).toLocaleString('ja-JP')+'円','支払期限':invoice.支払期限||'','有効日数':settings.validDays||45,'有効期限':formatDate_(d[m['トークン有効期限']]),'ダウンロードURL':url,'事業者名':'個別指導ステップ','電話番号':'0568-41-8937','返信先メールアドレス':settings.replyTo||'stepkobetsu@gmail.com'};
  let subject=merge_(settings.subject||d[m['メール件名']],values), body=merge_(settings.body||defaultMailBody_(),values);
  if(testMode){subject='【テスト】'+subject;body=`これはテスト送信です。\n本来の送信先: ${d[m['送信先メールアドレス']]}\n\n`+body;}
  const options={name:settings.senderName||'個別指導ステップ【請求書】',replyTo:settings.replyTo||'stepkobetsu@gmail.com'};
  const cc=[testMode?'':d[m['CCメールアドレス']],settings.enableAdminCc==='true'?settings.adminCc:''].filter(Boolean).join(','); if(cc)options.cc=cc;if(settings.bcc)options.bcc=settings.bcc;
  assertHourlyLimit_(settings);
  MailApp.sendEmail(recipient,subject,body,options);
  clearCachedDownloadUrl_(deliveryId);
  try{cloudflareAdminFetch_('/api/admin/deliveries/'+encodeURIComponent(deliveryId)+'/sent','post',{});}catch(syncError){log_('Cloudflare状態同期',d[m['請求書番号']],d[m['顧客コード']],deliveryId,'警告',safeError_(syncError));}
  const now=new Date(), status=Number(d[m['再送回数']]||0)>0?'再送済み':'送信済み';
  updateDeliveryCells_(delivery,{'送信日時':now,'送信状態':status,'送信エラー':'','現在状態':status,'更新日時':now});
  updateInvoiceState_(d[m['請求書番号']],status);
  log_('メール送信',d[m['請求書番号']],d[m['顧客コード']],deliveryId,'成功','');
}

function assertHourlyLimit_(settings) {
  const limit = Math.max(1, Number(settings.hourlyLimit || 50));
  const cutoff = Date.now() - 60 * 60 * 1000;
  const t = table_(sheet_(STEP.SHEETS.DELIVERIES));
  const sent = t.rows.filter(r => {
    const sentAt = r.values[t.map['送信日時']];
    return sentAt && new Date(sentAt).getTime() >= cutoff;
  }).length;
  if (sent >= limit) throw new Error(`1時間あたりの送信上限（${limit}件）に達しました。時間をおいて再実行してください。`);
}

function disableDelivery_(invoiceNumber, requestAuth) { requirePermission_('配信停止', requestAuth); const count=invalidateByInvoice_(String(invoiceNumber)); log_('URL無効化',invoiceNumber,'','','成功',''); return {disabled:count}; }
function invalidateByInvoice_(invoiceNumber) { const sh=sheet_(STEP.SHEETS.DELIVERIES), t=table_(sh), now=new Date(); let n=0;t.rows.forEach(r=>{if(String(r.values[t.map['請求書番号']])===invoiceNumber&&!r.values[t.map['無効化日時']]){const deliveryId=String(r.values[t.map['配信ID']]||'');if(deliveryId)cloudflareAdminFetch_('/api/admin/deliveries/'+encodeURIComponent(deliveryId)+'/revoke','post',{});updateRow_(sh,r.rowNumber,t.map,{'無効化日時':now,'現在状態':'無効化','更新日時':now});n++;}});return n; }

function validateToken_(token, recordAccess) {
  if (!token || token.length < 30) throw new Error('このダウンロードURLはご利用いただけません。');
  const hash=hashToken_(token), sh=sheet_(STEP.SHEETS.DELIVERIES), t=table_(sh), row=t.rows.find(r=>constantTimeEqual_(String(r.values[t.map['ダウンロードトークンハッシュ']]||''),hash));
  if(!row)throw new Error('このダウンロードURLはご利用いただけません。');
  const v=row.values,m=t.map,now=new Date(); if(v[m['無効化日時']]||v[m['現在状態']]==='無効化')throw new Error('このダウンロードURLは現在ご利用いただけません。個別指導ステップまでお問い合わせください。');
  if(new Date(v[m['トークン有効期限']]).getTime()<now.getTime()){updateRow_(sh,row.rowNumber,m,{'現在状態':'期限切れ','更新日時':now});throw new Error('このダウンロードURLは有効期限が切れています。');}
  if(recordAccess){updateRow_(sh,row.rowNumber,m,{'初回アクセス日時':v[m['初回アクセス日時']]||now,'最終アクセス日時':now,'アクセス回数':Number(v[m['アクセス回数']]||0)+1,'現在状態':v[m['現在状態']]==='DL済'?'DL済':'URLアクセス済み','更新日時':now});sheet_(STEP.SHEETS.DOWNLOADS).appendRow([now,v[m['配信ID']],v[m['請求書番号']],'URLアクセス','成功','保存しない','保存しない']);}
  const settings=settings_(), invoice=findInvoice_(v[m['請求書番号']]);
  return {row:{sheet:sh,rowNumber:row.rowNumber,map:m,values:v},publicData:{name:settings.nameDisplay==='full'?v[m['宛名']]:maskName_(v[m['宛名']]),subject:invoice.対象年月||'',invoiceNumber:v[m['請求書番号']],amount:settings.amountDisplay==='hide'?'非表示':Number(invoice.請求金額||0).toLocaleString('ja-JP')+'円',expiresAt:formatDate_(v[m['トークン有効期限']])}};
}

function getDashboard_(requestAuth) {
  requirePermission_('履歴閲覧', requestAuth);ensureInvoiceColumns_();syncCloudflareStatuses_();
  const invoices=table_(sheet_(STEP.SHEETS.INVOICES)),details=table_(sheet_(STEP.SHEETS.DETAILS)),deliveries=table_(sheet_(STEP.SHEETS.DELIVERIES)),logs=table_(sheet_(STEP.SHEETS.LOGS)),partners=table_(sheet_(STEP.SHEETS.PARTNERS));
  const partnerByCode={},partnerByName={};partners.rows.forEach(r=>{const p=objectRow_(r.values,partners.map);partnerByCode[String(p['顧客コード'])]=p;partnerByName[String(p['名称']).replace(/\s/g,'')]=p;});
  const activeNumbers=new Set(invoices.rows.map(r=>String(r.values[invoices.map['請求書番号']]))),latest={};deliveries.rows.forEach(r=>latest[String(r.values[deliveries.map['請求書番号']])]=r);
  const invoiceItems=invoices.rows.map(r=>{const o=objectRow_(r.values,invoices.map),number=String(o['請求書番号']),d=latest[number],rawDl=d?String(d.values[deliveries.map['現在状態']]||''):'',partner=partnerByCode[String(o['顧客コード'])]||partnerByName[String(o['宛名']).replace(/\s/g,'')]||{},address=String(o['住所']||''),prefecture=String(partner['都道府県']||''),addressWithoutPrefecture=prefecture&&address.indexOf(prefecture)===0?address.slice(prefecture.length):address;return {invoiceNumber:number,customerCode:o['顧客コード'],partnerName:o['宛名'],honorific:o['敬称'],subject:o['対象年月'],invoiceDate:formatDate_(o['請求日']),dueDate:formatDate_(o['支払期限']),postal:o['郵便番号'],prefecture:prefecture,address1:String(partner['住所1']||addressWithoutPrefecture),address2:String(partner['住所2']||''),memo:String(o['メモ']||''),tags:String(o['タグ']||''),paymentStatus:String(o['入金状態']||'未入金'),paymentDate:formatDate_(o['入金日']),bank:String(o['振込先']||''),note:String(o['備考']||''),subtotal:o['税抜小計'],tax:o['消費税額'],total:o['請求金額'],email:o['メールアドレス'],cc:o['CCメールアドレス'],pdfStatus:o['PDF状態'],pdfFileId:o['PDFファイルID'],pdfFileName:o['PDFファイル名'],createdAt:formatDate_(o['作成日時']),updatedAt:formatDateTime_(o['更新日時']),sendStatus:d?d.values[deliveries.map['送信状態']]:'未送信',sentAt:d?formatDateTime_(d.values[deliveries.map['送信日時']]):'',dlStatus:d?(['送信済み','再送済み'].includes(rawDl)?'未アクセス':rawDl):'未取得',downloadedAt:d?formatDateTime_(d.values[deliveries.map['初回ダウンロード日時']]):'',expiresAt:d?formatDateTime_(d.values[deliveries.map['トークン有効期限']]):'',details:details.rows.filter(item=>String(item.values[details.map['請求書番号']])===number).map(item=>({deliveryDate:formatDate_(item.values[details.map['納品日']]),name:item.values[details.map['品目・納品書番号']],itemCode:item.values[details.map['品目コード']],unitPrice:Number(item.values[details.map['単価']]||0),quantity:Number(item.values[details.map['数量']]||0),unit:item.values[details.map['単位']],amount:Number(item.values[details.map['価格']]||0),taxRate:item.values[details.map['税率']]})),warnings:[]};});
  const deliveryHistory=deliveries.rows.filter(r=>activeNumbers.has(String(r.values[deliveries.map['請求書番号']]))).map(r=>({timestamp:formatDateTime_(r.values[deliveries.map['更新日時']]),action:Number(r.values[deliveries.map['再送回数']]||0)>0?'再送':'初回送信',invoiceNumber:r.values[deliveries.map['請求書番号']],name:r.values[deliveries.map['宛名']],deliveryId:maskId_(r.values[deliveries.map['配信ID']]),sendStatus:r.values[deliveries.map['送信状態']],urlStatus:r.values[deliveries.map['現在状態']],result:r.values[deliveries.map['送信エラー']]||'正常'}));
  const operationHistory=logs.rows.filter(r=>activeNumbers.has(String(r.values[logs.map['請求書番号']]))).map(r=>({timestamp:formatDateTime_(r.values[logs.map['日時']]),action:String(r.values[logs.map['操作種別']]||'更新'),invoiceNumber:r.values[logs.map['請求書番号']],name:'',deliveryId:maskId_(r.values[logs.map['配信ID']]),sendStatus:'',urlStatus:'',result:r.values[logs.map['結果']]||r.values[logs.map['エラー']]||'正常'}));
  return {user:requestAuth.name||activeEmail_(),settings:settings_(),invoices:invoiceItems.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||String(b.invoiceNumber).localeCompare(String(a.invoiceNumber))),history:deliveryHistory.concat(operationHistory).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))).slice(0,300)};
}

function upsertInvoice_(inv,fileId,fileName){ensureInvoiceColumns_();const sh=sheet_(STEP.SHEETS.INVOICES),t=table_(sh),now=new Date(),existing=t.rows.find(r=>String(r.values[t.map['請求書番号']])===String(inv.invoiceNumber));const partner=findPartner_(inv.customerCode,inv.partnerName);const payment=String(inv.paymentStatus||existing&&existing.values[t.map['入金状態']]||'未入金'),paymentDate=payment==='入金済'?String(inv.paymentDate||existing&&existing.values[t.map['入金日']]||''):'';const row={'請求書番号':String(inv.invoiceNumber),'顧客コード':String(inv.customerCode||''),'宛名':inv.partnerName||'','敬称':inv.honorific||'様','対象年月':inv.subject||'','請求日':inv.invoiceDate||'','支払期限':inv.dueDate||'','郵便番号':String(inv.postal||''),'住所':String(inv.prefecture||'')+String(inv.address1||'')+String(inv.address2||''),'税抜小計':Number(inv.subtotal||0),'消費税額':Number(inv.tax||0),'請求金額':Number(inv.total||0),'メールアドレス':partner['メールアドレス']||inv.email||'','CCメールアドレス':partner['CCメールアドレス']||inv.cc||'','PDF状態':'PDF作成済み','PDFファイルID':fileId,'PDFファイル名':fileName,'現在状態':'PDF作成済み','作成日時':existing?existing.values[t.map['作成日時']]:now,'更新日時':now,'メモ':String(inv.memo||''),'タグ':String(inv.tags||''),'入金状態':payment,'入金日':paymentDate,'振込先':String(inv.bank||''),'備考':String(inv.note||'')};if(existing)updateRow_(sh,existing.rowNumber,t.map,row);else sh.appendRow(STEP.INVOICE_HEADERS.map(h=>row[h]));replaceInvoiceDetails_(inv.invoiceNumber,inv.details||[]);}
function findPartner_(code,name){const t=table_(sheet_(STEP.SHEETS.PARTNERS));const row=t.rows.find(r=>String(r.values[t.map['顧客コード']])===String(code))||t.rows.find(r=>String(r.values[t.map['名称']]).replace(/\s/g,'')===String(name).replace(/\s/g,''));return row?objectRow_(row.values,t.map):{};}
function findInvoice_(number){const t=table_(sheet_(STEP.SHEETS.INVOICES)),r=t.rows.find(x=>String(x.values[t.map['請求書番号']])===String(number));return r?objectRow_(r.values,t.map):{};}
function updateInvoiceState_(number,status){const sh=sheet_(STEP.SHEETS.INVOICES),t=table_(sh),r=t.rows.find(x=>String(x.values[t.map['請求書番号']])===String(number));if(r)updateRow_(sh,r.rowNumber,t.map,{'現在状態':status,'更新日時':new Date()});}

function requirePermission_(permission, requestAuth){if(requestAuth&&requestAuth.method==='systemPortal'&&STEP.AUTH_PERMISSION_LEVELS.includes(String(requestAuth.permissionLevel)))return;const email=activeEmail_();if(!email)throw new Error('STEPスタッフ認証を確認できません。Googleアカウントでログインしてください。');const t=table_(sheet_(STEP.SHEETS.USERS)),r=t.rows.find(x=>String(x.values[t.map['メールアドレス']]).toLowerCase()===email.toLowerCase());if(!r||String(r.values[t.map['有効']]).toLowerCase()!=='true'||!(String(r.values[t.map['管理者']]).toLowerCase()==='true'||String(r.values[t.map[permission]]).toLowerCase()==='true'))throw new Error(`権限がありません: ${permission}`);}
function activeEmail_(){return Session.getActiveUser().getEmail()||Session.getEffectiveUser().getEmail()||'';}
function seedCurrentUser_(ss){const sh=ss.getSheetByName(STEP.SHEETS.USERS);if(sh.getLastRow()===1){const e=activeEmail_();if(e)sh.appendRow([e,'初期管理者',true,true,true,true,true,true,true,true,true]);}}

function settings_(){const t=table_(sheet_(STEP.SHEETS.SETTINGS)),o={};t.rows.forEach(r=>o[String(r.values[t.map['キー']])]=String(r.values[t.map['値']]));return o;}
function saveSettings_(values, requestAuth){requirePermission_('基本設定変更', requestAuth);const sh=sheet_(STEP.SHEETS.SETTINGS),t=table_(sh);Object.keys(values||{}).forEach(k=>{const r=t.rows.find(x=>String(x.values[t.map['キー']])===k);if(r)updateRow_(sh,r.rowNumber,t.map,{'値':String(values[k])});else sh.appendRow([k,String(values[k]),'']);});log_('設定変更','','','','成功','');return {saved:Object.keys(values||{}).length};}
function seedSettings_(ss){const sh=ss.getSheetByName(STEP.SHEETS.SETTINGS);if(sh.getLastRow()>1)return;[['businessName','個別指導ステップ','事業者名'],['businessPostal','487-0024','郵便番号'],['businessAddress','愛知県春日井市大留町1丁目23-2','住所'],['businessPhone','0568-41-8937','電話番号'],['rounding','nearest10','合計を10円単位へ四捨五入'],['nameDisplay','masked','DLページの氏名表示'],['amountDisplay','show','DLページの金額表示'],['defaultBank','','請求書の標準振込先'],['defaultNote','個別指導ステップ（運営：株式会社エデュクレスト）','請求書の標準備考'],['senderName','個別指導ステップ【請求書】','送信者表示名'],['senderEmail','invoice@step-edu.net','認証済み送信元'],['replyTo','stepkobetsu@gmail.com','返信先'],['adminCc','stepkobetsu@gmail.com','管理者CC'],['enableAdminCc','true','管理者CCを毎回入れる'],['bcc','','BCC'],['validDays','45','URL有効日数'],['hourlyLimit','50','1時間あたり送信上限'],['batchSize','5','1回の処理件数'],['invalidateOld','true','再送時の旧URL無効化'],['testRecipient','stepkobetsu@gmail.com','テスト送信先'],['subject','【請求書】送付のご案内（個別指導ステップから）','メール件名'],['body',defaultMailBody_(),'メール本文'],['webAppUrl','','Apps ScriptデプロイURL']].forEach(x=>sh.appendRow(x));}
function seedTemplate_(ss){const sh=ss.getSheetByName(STEP.SHEETS.TEMPLATES);if(sh.getLastRow()===1)sh.appendRow(['default','標準','【請求書】送付のご案内（個別指導ステップから）',defaultMailBody_(),true]);}
function defaultMailBody_(){return '{{取引先名}} {{敬称}}\n\nお世話になっております。\n次月分の請求書を送付いたしますので、ご査収の程よろしくお願いいたします。\n\n請求書は、以下のURLよりダウンロードできます。\n有効期間は本日より{{有効日数}}日間です。\n\n有効期間を過ぎた場合は、個別指導ステップまでメールの再配信をご依頼ください。\n\n【ダウンロードURL】\n{{ダウンロードURL}}\n\n本メールは、個別指導ステップの請求書配信システムから自動送信しております。\n\nお心当たりのない場合は、メール内のURLを開かず、個別指導ステップまでご連絡ください。\n\n個別指導ステップ\n〒487-0024\n愛知県春日井市大留町1丁目23-2\nTEL: 0568-41-8937';}

function ensureSheet_(ss,name,headers){let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0||String(sh.getRange(1,1).getValue())!==headers[0]){sh.clear();sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eaed');sh.setFrozenRows(1);sh.getRange(1,1,Math.max(2,sh.getMaxRows()),headers.length).setWrap(false);sh.autoResizeColumns(1,headers.length);}return sh;}
function ensureInvoiceColumns_(){const sh=sheet_(STEP.SHEETS.INVOICES),lastCol=Math.max(1,sh.getLastColumn()),headers=sh.getRange(1,1,1,lastCol).getValues()[0].map(String),missing=STEP.INVOICE_HEADERS.filter(header=>!headers.includes(header));if(missing.length)sh.getRange(1,lastCol+1,1,missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e8eaed');return sh;}
function sheet_(name){if(STEP_SHEET_CACHE_[name])return STEP_SHEET_CACHE_[name];const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');if(!id)throw new Error('初期設定が未完了です。setupSystemを実行してください。');if(!STEP_SPREADSHEET_CACHE_)STEP_SPREADSHEET_CACHE_=SpreadsheetApp.openById(id);const sh=STEP_SPREADSHEET_CACHE_.getSheetByName(name);if(!sh)throw new Error(`シートがありません: ${name}`);STEP_SHEET_CACHE_[name]=sh;return sh;}
function table_(sh){const lastRow=sh.getLastRow(),lastCol=sh.getLastColumn();const values=lastRow?sh.getRange(1,1,lastRow,lastCol).getValues():[];const headers=values[0]||[],map={};headers.forEach((h,i)=>map[String(h)]=i);return {headers,map,rows:values.slice(1).map((v,i)=>({values:v,rowNumber:i+2}))};}
function objectRow_(values,map){const o={};Object.keys(map).forEach(k=>o[k]=values[map[k]]);return o;}
function updateRow_(sh,rowNumber,map,changes){const lastCol=sh.getLastColumn(),row=sh.getRange(rowNumber,1,1,lastCol).getValues()[0];Object.keys(changes).forEach(k=>{if(map[k]!==undefined)row[map[k]]=changes[k];});sh.getRange(rowNumber,1,1,lastCol).setValues([row]);}
function updateDeliveryCells_(row,changes){updateRow_(row.sheet,row.rowNumber,row.map,changes);}
function updateDeliveryById_(id,changes){const r=findDeliveryById_(id);if(r)updateDeliveryCells_(r,changes);}
function findDeliveryById_(id){const sh=sheet_(STEP.SHEETS.DELIVERIES),t=table_(sh),r=t.rows.find(x=>String(x.values[t.map['配信ID']])===String(id));return r?{sheet:sh,rowNumber:r.rowNumber,map:t.map,values:r.values}:null;}
function childFolder_(parent,name){const it=parent.getFoldersByName(name);return it.hasNext()?it.next():parent.createFolder(name);}
function safeFileName_(s){return String(s).replace(/[\\/:*?"<>|]/g,'_').slice(0,180);}
function createToken_(){const seed=Array.from({length:8},()=>Utilities.getUuid()).join('|')+'|'+Date.now();return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,seed,Utilities.Charset.UTF_8)).replace(/=+$/,'');}
function hashToken_(token){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(token),Utilities.Charset.UTF_8)).replace(/=+$/,'');}
function constantTimeEqual_(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function cacheDownloadUrlForQueue_(id,url){CacheService.getScriptCache().put('cloudflare-download-url:'+id,url,21600);}
function takeCachedDownloadUrl_(id){return CacheService.getScriptCache().get('cloudflare-download-url:'+id);}
function clearCachedDownloadUrl_(id){CacheService.getScriptCache().remove('cloudflare-download-url:'+id);}
function cloudflareConfig_(){const p=PropertiesService.getScriptProperties(),url=String(p.getProperty('CLOUDFLARE_API_URL')||'').replace(/\/+$/,''),key=String(p.getProperty('CLOUDFLARE_ADMIN_API_KEY')||'');if(!/^https:\/\/[^/]+/.test(url)||!key)throw new Error('Cloudflare連携が未設定です。Script Propertiesを確認してください。');return {url:url,key:key};}
function cloudflareAdminFetch_(path,method,payload){const c=cloudflareConfig_(),response=UrlFetchApp.fetch(c.url+path,{method:method||'post',contentType:'application/json',headers:{Authorization:'Bearer '+c.key},payload:JSON.stringify(payload||{}),muteHttpExceptions:true});let result;try{result=JSON.parse(response.getContentText());}catch(_){throw new Error('Cloudflareから正しい応答を受信できませんでした。');}if(response.getResponseCode()<200||response.getResponseCode()>=300||!result.ok)throw new Error('Cloudflare連携に失敗しました: '+String(result.error||response.getResponseCode()));return result;}
function createCloudflareDelivery_(values){return cloudflareAdminFetch_('/api/admin/deliveries','post',{deliveryId:String(values.deliveryId||''),invoiceNumber:String(values.invoiceNumber||''),recipientEmail:String(values.recipientEmail||''),ccEmail:String(values.ccEmail||''),expiresAt:new Date(values.expiresAt).toISOString(),createdBy:String(values.createdBy||'apps-script')});}
function rotateCloudflareDelivery_(deliveryId,expiresAt){return cloudflareAdminFetch_('/api/admin/deliveries/'+encodeURIComponent(deliveryId)+'/rotate','post',{expiresAt:new Date(expiresAt).toISOString()});}
function syncCloudflareStatuses_(){try{const sh=sheet_(STEP.SHEETS.DELIVERIES),t=table_(sh),rows=t.rows.slice(-100),ids=rows.map(r=>String(r.values[t.map['配信ID']]||'')).filter(Boolean);if(!ids.length)return;const result=cloudflareAdminFetch_('/api/admin/deliveries/status','post',{deliveryIds:ids}),byId={};(result.items||[]).forEach(item=>byId[String(item.delivery_id)]=item);rows.forEach(r=>{const item=byId[String(r.values[t.map['配信ID']]||'')];if(!item)return;const changes={'更新日時':new Date()};if(item.status==='downloaded'){changes['現在状態']='DL済';changes['初回アクセス日時']=item.first_opened_at?new Date(item.first_opened_at):r.values[t.map['初回アクセス日時']];changes['最終アクセス日時']=item.last_opened_at?new Date(item.last_opened_at):r.values[t.map['最終アクセス日時']];changes['初回ダウンロード日時']=item.downloaded_at?new Date(item.downloaded_at):r.values[t.map['初回ダウンロード日時']];changes['アクセス回数']=Number(item.open_count||0);changes['ダウンロード回数']=Number(item.download_count||0);}else if(item.status==='opened'){changes['現在状態']='URLアクセス済み';changes['初回アクセス日時']=item.first_opened_at?new Date(item.first_opened_at):r.values[t.map['初回アクセス日時']];changes['最終アクセス日時']=item.last_opened_at?new Date(item.last_opened_at):r.values[t.map['最終アクセス日時']];changes['アクセス回数']=Number(item.open_count||0);}else if(item.status==='revoked'||item.revoked_at){changes['現在状態']='無効化';changes['無効化日時']=item.revoked_at?new Date(item.revoked_at):new Date();}else if(item.expires_at&&new Date(item.expires_at).getTime()<Date.now()){changes['現在状態']='期限切れ';}else{return;}updateRow_(sh,r.rowNumber,t.map,changes);});}catch(err){console.warn('Cloudflare状態同期を保留: '+safeError_(err));}}
function testCloudflareIntegration(){const result=cloudflareAdminFetch_('/api/admin/deliveries/status','post',{deliveryIds:[]});return {ok:result.ok===true,apiUrl:cloudflareConfig_().url,storage:'Cloudflare R2'};}
function verifyAdminApiKey_(token){const expected=PropertiesService.getScriptProperties().getProperty('ADMIN_API_KEY')||'';if(!expected||!token||!constantTimeEqual_(expected,token))throw new Error('管理API認証に失敗しました。');}
function verifyRequestAuth_(body){
  const apiKey=String(body.authToken||'');
  if(apiKey){verifyAdminApiKey_(apiKey);return {method:'apiKey',permissionLevel:'4',name:activeEmail_()};}
  const token=String(body.systemPortalSessionToken||'').trim();
  if(!token)throw new Error('スタッフ用アプリへログインしてから、もう一度お試しください。');
  const cache=CacheService.getScriptCache(),cacheKey='staff-auth:'+hashToken_(token),cached=cache.get(cacheKey);
  if(cached){try{return JSON.parse(cached);}catch(_){cache.remove(cacheKey);}}
  const response=UrlFetchApp.fetch(STEP.AUTH_API,{method:'post',contentType:'text/plain',payload:JSON.stringify({action:'verifySystemPortal',systemPortalSessionToken:token}),muteHttpExceptions:true});
  let result;try{result=JSON.parse(response.getContentText());}catch(_){throw new Error('スタッフ認証サーバーへ接続できませんでした。');}
  if(!result.success)throw new Error(result.error||'スタッフログインを確認できません。もう一度ログインしてください。');
  if(!STEP.AUTH_PERMISSION_LEVELS.includes(String(result.permissionLevel)))throw new Error('請求書システムを利用できるスタッフ権限を確認できません。');
  const verified={method:'systemPortal',permissionLevel:String(result.permissionLevel),name:String(result.name||''),code:String(result.code||'')};
  cache.put(cacheKey,JSON.stringify(verified),120);
  return verified;
}
function merge_(text,values){return String(text).replace(/{{([^{}]+)}}/g,(m,k)=>values[String(k).trim()]==null?'':String(values[String(k).trim()]));}
function maskName_(name){const a=Array.from(String(name||''));return a.length<2?'＊':a[0]+'＊'.repeat(a.length-1);}
function maskId_(id){const s=String(id||'');return s?s.slice(0,8)+'…':'';}
function formatDate_(v){if(!v)return'';return Utilities.formatDate(new Date(v),'Asia/Tokyo','yyyy/MM/dd');}
function formatDateTime_(v){if(!v)return'';return Utilities.formatDate(new Date(v),'Asia/Tokyo','yyyy/MM/dd HH:mm:ss');}
function log_(action,invoice,customer,delivery,result,error,before,after){sheet_(STEP.SHEETS.LOGS).appendRow([new Date(),activeEmail_(),action,invoice||'',customer||'',delivery||'',result||'',error||'',before?JSON.stringify(before).slice(0,1000):'',after?JSON.stringify(after).slice(0,1000):'']);}
function safeError_(err){return String(err&&err.message?err.message:err).replace(/[A-Za-z0-9_-]{30,}/g,'[秘匿]').slice(0,500);}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function bridgeResponse_(obj,requestId,bridgeNonce){const payload=JSON.stringify({requestId:String(requestId||''),bridgeNonce:String(bridgeNonce||''),result:obj}).replace(/</g,'\\u003c');return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>top.postMessage('+payload+',"https://stepkobetsu-hub.github.io");</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);}
function installQueueTrigger_(){if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='processSendQueue'))ScriptApp.newTrigger('processSendQueue').timeBased().everyMinutes(1).create();}
function recoverStuckQueue_(requestAuth){requirePermission_('メール送信', requestAuth);const sh=sheet_(STEP.SHEETS.QUEUE),t=table_(sh),cutoff=Date.now()-15*60000;let n=0;t.rows.forEach(r=>{if(r.values[t.map['状態']]==='送信中'&&new Date(r.values[t.map['開始日時']]).getTime()<cutoff){updateRow_(sh,r.rowNumber,t.map,{'状態':'送信待ち','エラー':'送信中タイムアウトから復旧'});n++;}});return {recovered:n};}
function processPendingSends_(requestAuth){requirePermission_('メール送信', requestAuth);const recovered=recoverStuckQueue_(requestAuth).recovered;installQueueTrigger_();processSendQueue();const queue=table_(sheet_(STEP.SHEETS.QUEUE));return {recovered,pending:queue.rows.filter(r=>['送信待ち','送信中'].includes(String(r.values[queue.map['状態']]))).length,failed:queue.rows.filter(r=>String(r.values[queue.map['状態']])==='送信失敗').length};}
