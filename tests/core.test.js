const assert = require('node:assert/strict');
const C = require('../assets/core.js');

assert.equal(C.roundToNearest10(27549),27550);
assert.equal(C.roundToNearest10(27551),27550);
assert.equal(C.roundToNearest10(27555),27560);
const postalInvoice=C.parseInvoiceRows([
  ['取引先名称','件名','請求日','お支払期限','請求書番号','小計','消費税','合計金額','取引先郵便番号'],
  ['テスト','2026年8月分','2026/7/10','2026/7/27','202608999','25045','2504','27549','4870024']
])[0];
assert.equal(postalInvoice.postal,'487-0024');
assert.equal(postalInvoice.total,27550);
assert.equal(postalInvoice.tax,2505);
assert.equal(C.nextInvoiceNumber('2026-08-09',[]),'202608001');
assert.equal(C.nextInvoiceNumber('2026-08-09',[{invoiceNumber:'202608156'},{invoiceNumber:'202607999'},{invoiceNumber:'202608099'}]),'202608157');
assert.equal(C.nextInvoiceNumber('2026-09-01',[]),'202609001');
assert.equal(C.nextInvoiceNumber('2026-09-01',[{invoiceNumber:'202609001'},{invoiceNumber:'202609002'},{invoiceNumber:'202608999'}]),'202609003');
assert.equal(C.nextInvoiceNumber('2026-08-09',[{invoiceNumber:'202609023'},{invoiceNumber:'990811209'}]),'202608001');
assert.equal(C.nextInvoiceNumber('2026-08-09',[{invoiceNumber:'202608999'},{invoiceNumber:'202609023'}]),'2026081000');
assert.equal(C.buildManualInvoice({invoiceNumber:'7',subject:'任意番号',invoiceDate:'2026-08-09',dueDate:'2026-08-31'},[{name:'授業料',unitPrice:100,quantity:1,taxRate:10}],C.DEMO_PARTNERS[0]).invoiceNumber,'7');

const headers=['csv_type(変更不可)','取引先名称','件名','請求日','お支払期限','請求書番号','売上計上日','メモ','タグ','小計','消費税','源泉徴収税','合計金額','取引先敬称','取引先郵便番号','取引先都道府県','取引先住所1','取引先住所2','取引先部署','取引先担当者役職','取引先担当者氏名','自社担当者氏名','備考','振込先','入金ステータス','メール送信ステータス','郵送ステータス','ダウンロードステータス','納品日','品名','品目コード','単価','数量','単位','納品書番号','詳細','金額','源泉徴収','品目消費税率'];
const row=['40102','テスト太郎','2026年8月分','2026/7/10','2026/7/27','999999002','2026/8/1','検証','テスト','25045','2505','','27550','様','4870024','愛知県','春日井市テスト町1-2-3','','','','','TEST002','口座振替予定','','','','','','','8月分授業料','','22545','1','','','','22545','含まない','10%'];
const invoices=C.parseInvoiceRows([headers,row]);
assert.equal(invoices.length,1);
assert.equal(invoices[0].invoiceNumber,'999999002');
assert.equal(invoices[0].total,27550);
assert.equal(invoices[0].tax,2505);
assert.equal(invoices[0].invoiceDate,'2026/07/10');
assert.equal(invoices[0].postal,'487-0024');

const partnerHeader=C.PARTNER_HEADERS;
const partnerRow=['TEST002','テスト太郎','テスト タロウ','様','','','','4870024','愛知県','春日井市テスト町1-2-3','','','','','','sample@example.com','cc@example.com','','',''];
const partners=C.parsePartners([partnerHeader,partnerRow]);
const matched=C.matchPartners(invoices,partners)[0];
assert.equal(matched.email,'sample@example.com');
assert.equal(matched.cc,'cc@example.com');
assert.equal(matched.warnings.length,0);

const directMailInvoice=C.parseInvoiceRows([
  ['取引先名称','件名','請求日','お支払期限','請求書番号','小計','消費税','合計金額','メールアドレス'],
  ['送信テスト','負荷テスト','2026/08/12','2026/09/02','202608925','100','10','110','direct@example.com']
])[0];
const directMailMatched=C.matchPartners([directMailInvoice],[])[0];
assert.equal(directMailMatched.email,'direct@example.com');
assert.deepEqual(directMailMatched.warnings,['取引先未照合']);

assert.deepEqual(C.DEMO_PARTNERS.map(p=>p['メールアドレス']),[
  'mintcocoajasmine@gmail.com',
  'kk8989892000@yahoo.co.jp',
  'skase.days@gmail.com',
  'chloeandnina1@gmail.com'
]);
const studentPartner=C.studentToPartner({studentCode:'999',name:'テスト生徒',kana:'テストセイト',grade:'小５',classroom:'神領校',postal:'4850802',addressU:'愛知県小牧市大草',addressV:'1220',addressW:'テストハイツ101',email:'student@example.com'});
assert.equal(studentPartner['顧客コード'],'999');
assert.equal(studentPartner['都道府県'],'愛知県');
assert.equal(studentPartner['住所1'],'小牧市大草1220');
assert.equal(studentPartner['住所2'],'テストハイツ101');
assert.equal(studentPartner['郵便番号'],'485-0802');
assert.equal(studentPartner['学年'],'小５');
assert.equal(studentPartner['教室'],'神領');
assert.deepEqual(C.partnerDocumentDefaults(studentPartner),{memo:'小５',tags:'神領'});
assert.deepEqual(C.partnerDocumentDefaults({'メモ':'生徒マスタから取込（学年：中2）','教室':'大手町校'}),{memo:'中2',tags:'大手'});
assert.equal(C.normalizeStudentCode(' １３２０ '),'1320');
assert.equal(C.normalizeStudentCode(' Ａb１２ '),'Ab12');
const manual=C.buildManualInvoice({invoiceNumber:'202608101',subject:'2026年8月分',invoiceDate:'2026-08-09',dueDate:'2026-08-31',note:'個別作成テスト'},[
  {name:'授業料',unitPrice:25000,quantity:1,unit:'月',taxRate:10},
  {name:'教材費',unitPrice:50,quantity:1,unit:'冊',taxRate:10}
],C.DEMO_PARTNERS[0]);
assert.equal(manual.csvType,'個別作成');
assert.equal(manual.customerCode,'DEMO001');
assert.equal(manual.subtotal,25050);
assert.equal(manual.sourceTax,2505);
assert.equal(manual.sourceTotal,27555);
assert.equal(manual.total,27560);
assert.equal(manual.tax,2510);
assert.equal(manual.details.length,2);
assert.equal(C.matchPartners([manual],C.DEMO_PARTNERS)[0].warnings.length,1);
const discounted=C.buildManualInvoice({invoiceNumber:'202608102',subject:'割引テスト',invoiceDate:'2026-08-10',dueDate:'2026-08-31'},[
  {name:'授業料',unitPrice:25000,quantity:1,unit:'月',taxRate:10},
  {name:'割引',unitPrice:-10000,quantity:1,unit:'式',taxRate:10}
],C.DEMO_PARTNERS[0]);
assert.equal(discounted.subtotal,15000);
assert.equal(discounted.tax,1500);
assert.equal(discounted.total,16500);

const summary=C.selectedSummary([{email:'sample@example.com',pdfStatus:'PDF作成済み',sendStatus:'未送信',warnings:[]},{email:'',pdfStatus:'未作成',sendStatus:'送信済み',warnings:['メール未登録']}]);
assert.deepEqual(summary,{selected:2,sendable:1,missingEmail:1,invalidEmail:0,missingPdf:1,alreadySent:1,errors:1});

const selection=C.classifySendSelection([
  {invoiceNumber:'A',email:'first@example.com',pdfStatus:'PDF作成済み',sendStatus:'未送信'},
  {invoiceNumber:'B',email:'resend@example.com',pdfStatus:'PDF作成済み',sendStatus:'再送済み'},
  {invoiceNumber:'C',email:'',pdfStatus:'PDF作成済み',sendStatus:'未送信'},
  {invoiceNumber:'D',email:'stopped@example.com',pdfStatus:'PDF作成済み',sendStatus:'配信停止'},
  {invoiceNumber:'E',email:'sending@example.com',pdfStatus:'PDF作成済み',sendStatus:'送信中'}
]);
assert.deepEqual(selection.unsent.map(x=>x.invoiceNumber),['A']);
assert.deepEqual(selection.resend.map(x=>x.invoiceNumber),['B']);
assert.deepEqual(selection.blocked.map(x=>x.invoiceNumber),['C','D','E']);
assert.equal(C.isInitialSendable(selection.selected[0]),true);
assert.equal(C.isInitialSendable(selection.selected[1]),false);

const quoted=C.parseCsv('a,b\n"x,y","z"\n');
assert.deepEqual(quoted,[['a','b'],['x,y','z']]);
console.log('core tests passed');
