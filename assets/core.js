(function(global){
  'use strict';
  const PARTNER_HEADERS=['顧客コード','名称','名称(カナ)','敬称','支払い期限(月)','支払い期限(日)','土日祝日','郵便番号','都道府県','住所1','住所2','担当者部署','担当者役職','担当者氏名','電話番号','メールアドレス','CCメールアドレス','自社担当者名','Peppol ID','メモ'];
  const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DEMO_PARTNERS=[
    ['DEMO001','ダミー取引先1','ダミー トリヒキサキ イチ','様','','','','487-0001','愛知県','春日井市テスト町1-1','','','','','','mintcocoajasmine@gmail.com','','','','検証用ダミー取引先（実在しません）'],
    ['DEMO002','ダミー取引先2','ダミー トリヒキサキ ニ','様','','','','487-0002','愛知県','春日井市テスト町2-2','','','','','','kk8989892000@yahoo.co.jp','','','','検証用ダミー取引先（実在しません）'],
    ['DEMO003','ダミー取引先3','ダミー トリヒキサキ サン','様','','','','487-0003','愛知県','春日井市テスト町3-3','','','','','','skase.days@gmail.com','','','','検証用ダミー取引先（実在しません）'],
    ['DEMO004','ダミー取引先4','ダミー トリヒキサキ ヨン','様','','','','487-0004','愛知県','春日井市テスト町4-4','','','','','','chloeandnina1@gmail.com','','','','検証用ダミー取引先（実在しません）']
  ].map(row=>Object.fromEntries(PARTNER_HEADERS.map((header,index)=>[header,row[index]||''])));

  function parseCsv(text){
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"'){quoted=false;}else field+=ch;}
      else if(ch==='"') quoted=true;
      else if(ch===','){row.push(field);field='';}
      else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
      else field+=ch;
    }
    if(field!==''||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
    return rows.filter(r=>r.some(v=>v!==''));
  }

  async function decodeCsvFile(file){
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return {encoding:'UTF-8 BOM',text:new TextDecoder('utf-8').decode(bytes.subarray(3))};
    const utf8=new TextDecoder('utf-8',{fatal:true});
    try{return {encoding:'UTF-8',text:utf8.decode(bytes)};}catch(_){return {encoding:'CP932/Shift-JIS',text:new TextDecoder('shift_jis').decode(bytes)};}
  }

  function roundToNearest10(value){return Math.floor((Number(value)+5)/10)*10;}
  function normalizePostal(value){
    const text=String(value??'').trim();
    const digits=text.replace(/\D/g,'');
    return digits.length===7?`${digits.slice(0,3)}-${digits.slice(3)}`:text;
  }
  function splitJapaneseAddress(address){
    const text=String(address||'').trim();
    const match=text.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)(.*)$/);
    return match?{prefecture:match[1],rest:match[2]}:{prefecture:'',rest:text};
  }
  function studentToPartner(student){
    const code=String(student?.studentCode||'').trim(),name=String(student?.name||'').trim();
    if(!code||!name)throw new Error('生徒コードまたは生徒氏名がありません。');
    const first=splitJapaneseAddress(student?.addressU);
    const partner=Object.fromEntries(PARTNER_HEADERS.map(header=>[header,'']));
    Object.assign(partner,{
      '顧客コード':code,'名称':name,'名称(カナ)':String(student?.kana||'').trim(),'敬称':'様',
      '郵便番号':normalizePostal(student?.postal),'都道府県':first.prefecture,
      '住所1':`${first.rest}${String(student?.addressV||'').trim()}`,
      '住所2':String(student?.addressW||'').trim(),'メールアドレス':String(student?.email||'').trim(),
      'メモ':`生徒マスタから取込${student?.grade?`（学年：${String(student.grade).trim()}）`:''}`
    });
    return partner;
  }
  function normalizeStudentCode(value){
    return String(value??'').trim().replace(/[Ａ-Ｚａ-ｚ０-９]/g,char=>String.fromCharCode(char.charCodeAt(0)-0xFEE0));
  }
  function formatYen(value){return `${Number(value||0).toLocaleString('ja-JP')}円`;}
  function normalizeDate(value){const parts=String(value||'').split(/[\/-]/);if(parts.length!==3)return String(value||'');return `${parts[0]}/${parts[1].padStart(2,'0')}/${parts[2].padStart(2,'0')}`;}
  function nextInvoiceNumber(dateValue,invoices){
    const match=String(dateValue||'').match(/^(\d{4})[\/-](\d{1,2})/);
    if(!match)throw new Error('請求日が不正です。');
    const prefix=`${match[1]}${match[2].padStart(2,'0')}`;
    const max=(Array.isArray(invoices)?invoices:[]).reduce((current,invoice)=>{
      const number=String(invoice?.invoiceNumber||'');
      if(!number.startsWith(prefix))return current;
      const suffix=number.slice(prefix.length);
      return /^\d+$/.test(suffix)?Math.max(current,Number(suffix)):current;
    },0);
    return `${prefix}${String(max+1).padStart(3,'0')}`;
  }

  function parseInvoiceRows(rows){
    if(rows.length<2)throw new Error('請求書CSVにデータ行がありません。');
    const h=rows[0];
    const required=['取引先名称','件名','請求日','お支払期限','請求書番号','小計','消費税','合計金額'];
    const missing=required.filter(x=>!h.includes(x));if(missing.length)throw new Error(`必須列がありません: ${missing.join('、')}`);
    const ix=name=>h.indexOf(name);
    const firstDetail=h.indexOf('納品日');
    return rows.slice(1).filter(r=>r[ix('請求書番号')]).map(r=>{
      const subtotal=Number(r[ix('小計')]||0);
      const sourceTax=Number(r[ix('消費税')]||0);
      const sourceTotal=Number(r[ix('合計金額')]||subtotal+sourceTax);
      const total=roundToNearest10(sourceTotal);
      const tax=total-subtotal;
      const details=[];
      for(let start=firstDetail;start>=0&&start<r.length;start+=11){
        if(!r[start+1])continue;
        details.push({deliveryDate:r[start]||'',name:r[start+1],itemCode:r[start+2]||'',unitPrice:Number(r[start+3]||0),quantity:Number(r[start+4]||0),unit:r[start+5]||'',deliveryNumber:r[start+6]||'',detail:r[start+7]||'',amount:Number(r[start+8]||0),withholding:r[start+9]||'',taxRate:r[start+10]||''});
      }
      const invoice={
        csvType:r[0]||'',partnerName:r[ix('取引先名称')]||'',subject:r[ix('件名')]||'',invoiceDate:normalizeDate(r[ix('請求日')]),dueDate:normalizeDate(r[ix('お支払期限')]),invoiceNumber:String(r[ix('請求書番号')]||''),memo:r[ix('メモ')]||'',tags:r[ix('タグ')]||'',subtotal,sourceTax,sourceTotal,tax,total,honorific:r[ix('取引先敬称')]||'様',postal:normalizePostal(r[ix('取引先郵便番号')]),prefecture:r[ix('取引先都道府県')]||'',address1:r[ix('取引先住所1')]||'',address2:r[ix('取引先住所2')]||'',department:r[ix('取引先部署')]||'',position:r[ix('取引先担当者役職')]||'',contactName:r[ix('取引先担当者氏名')]||'',customerCode:String(r[ix('自社担当者氏名')]||''),note:r[ix('備考')]||'',bank:r[ix('振込先')]||'',details,pdfStatus:'未作成',sendStatus:'未送信',dlStatus:'未取得'
      };
      invoice.roundingAdjusted=sourceTotal!==total;
      return invoice;
    });
  }

  function parsePartners(rows){
    if(rows.length<2)throw new Error('取引先CSVにデータ行がありません。');
    const actual=rows[0].map(x=>x.trim());
    const missing=PARTNER_HEADERS.filter(x=>!actual.includes(x));if(missing.length)throw new Error(`取引先CSVの必須列がありません: ${missing.join('、')}`);
    return rows.slice(1).filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(PARTNER_HEADERS.map(h=>[h,String(r[actual.indexOf(h)]??'')])));
  }

  function matchPartners(invoices,partners){
    const byCode=new Map(partners.map(p=>[String(p['顧客コード']),p]));
    const byName=new Map(partners.map(p=>[String(p['名称']).replace(/\s/g,''),p]));
    return invoices.map(invoice=>{
      const partner=byCode.get(invoice.customerCode)||byName.get(invoice.partnerName.replace(/\s/g,''))||null;
      const email=partner?.['メールアドレス']||'';
      const cc=partner?.['CCメールアドレス']||'';
      const warnings=[];
      if(!partner)warnings.push('取引先未照合');
      if(!email)warnings.push('メール未登録');else if(!EMAIL.test(email))warnings.push('メール形式不正');
      if(invoice.roundingAdjusted)warnings.push(`10円単位へ調整（${formatYen(invoice.sourceTotal)}→${formatYen(invoice.total)}）`);
      return {...invoice,partner,email,cc,warnings};
    });
  }

  function buildManualInvoice(values,detailRows,partner){
    const invoiceNumber=String(values?.invoiceNumber||'').trim();
    if(!/^\d{6,}$/.test(invoiceNumber))throw new Error('請求書番号は6桁以上の数字で入力してください。');
    if(!partner)throw new Error('取引先を選択してください。');
    if(!String(values?.subject||'').trim())throw new Error('件名を入力してください。');
    if(!values?.invoiceDate||!values?.dueDate)throw new Error('請求日と支払期限を入力してください。');
    const details=(Array.isArray(detailRows)?detailRows:[]).map((row,index)=>{
      const name=String(row?.name||'').trim();
      const unitPrice=Number(row?.unitPrice||0);
      const quantity=Number(row?.quantity||0);
      const taxRate=Number(row?.taxRate??10);
      if(!name)throw new Error(`明細${index+1}の品目を入力してください。`);
      if(!Number.isFinite(unitPrice))throw new Error(`明細${index+1}の単価が不正です。`);
      if(!Number.isFinite(quantity)||quantity<=0)throw new Error(`明細${index+1}の数量が不正です。`);
      if(![0,8,10].includes(taxRate))throw new Error(`明細${index+1}の税率が不正です。`);
      const amount=Math.round(unitPrice*quantity);
      return {deliveryDate:'',name,itemCode:'',unitPrice,quantity,unit:String(row?.unit||''),deliveryNumber:'',detail:'',amount,withholding:'含まない',taxRate:`${taxRate}%`,taxRateValue:taxRate};
    });
    if(!details.length)throw new Error('請求明細を1行以上入力してください。');
    const subtotal=details.reduce((sum,row)=>sum+row.amount,0);
    const sourceTax=details.reduce((sum,row)=>sum+Math.round(row.amount*row.taxRateValue/100),0);
    const sourceTotal=subtotal+sourceTax;
    const total=roundToNearest10(sourceTotal);
    return {
      csvType:'個別作成',partnerName:partner['名称'],subject:String(values.subject).trim(),invoiceDate:normalizeDate(values.invoiceDate),dueDate:normalizeDate(values.dueDate),invoiceNumber,
      memo:String(values.memo||''),tags:String(values.tags||''),paymentStatus:String(values.paymentStatus||'未入金'),subtotal,sourceTax,sourceTotal,tax:total-subtotal,total,honorific:partner['敬称']||'様',postal:normalizePostal(partner['郵便番号']),prefecture:partner['都道府県']||'',
      address1:partner['住所1']||'',address2:partner['住所2']||'',department:partner['担当者部署']||'',position:partner['担当者役職']||'',contactName:partner['担当者氏名']||'',
      customerCode:String(partner['顧客コード']||''),note:String(values.note||''),bank:'',details:details.map(({taxRateValue,...row})=>row),pdfStatus:'未作成',sendStatus:'未送信',dlStatus:'未取得',
      roundingAdjusted:sourceTotal!==total
    };
  }

  function validateEmail(value){return EMAIL.test(String(value||''));}
  function isSentStatus(status){return ['送信済み','再送済み'].includes(String(status||''));}
  function isInitialSendable(item){return String(item?.sendStatus||'')==='未送信'&&validateEmail(item?.email)&&item?.pdfStatus==='PDF作成済み';}
  function isResendable(item){return isSentStatus(item?.sendStatus)&&validateEmail(item?.email)&&item?.pdfStatus==='PDF作成済み';}
  function classifySendSelection(items){
    const selected=Array.isArray(items)?items:[];
    const unsent=selected.filter(isInitialSendable);
    const resend=selected.filter(isResendable);
    return {selected,unsent,resend,blocked:selected.filter(x=>!unsent.includes(x)&&!resend.includes(x))};
  }
  function maskName(value){const chars=Array.from(String(value||''));if(chars.length<=1)return '＊';return chars[0]+'＊'.repeat(Math.max(1,chars.length-1));}
  function renderTemplate(text,data){return String(text).replace(/{{([^{}]+)}}/g,(_,key)=>String(data[key.trim()]??''));}
  function selectedSummary(items){
    return {selected:items.length,sendable:items.filter(x=>validateEmail(x.email)&&x.pdfStatus==='PDF作成済み').length,missingEmail:items.filter(x=>!x.email).length,invalidEmail:items.filter(x=>x.email&&!validateEmail(x.email)).length,missingPdf:items.filter(x=>x.pdfStatus!=='PDF作成済み').length,alreadySent:items.filter(x=>['送信済み','再送済み'].includes(x.sendStatus)).length,errors:items.filter(x=>x.warnings?.length).length};
  }

  global.StepInvoiceCore={PARTNER_HEADERS,DEMO_PARTNERS,parseCsv,decodeCsvFile,roundToNearest10,formatYen,normalizeDate,nextInvoiceNumber,parseInvoiceRows,parsePartners,matchPartners,buildManualInvoice,studentToPartner,normalizeStudentCode,validateEmail,isSentStatus,isInitialSendable,isResendable,classifySendSelection,maskName,renderTemplate,selectedSummary};
  if(typeof module!=='undefined')module.exports=global.StepInvoiceCore;
})(typeof window!=='undefined'?window:globalThis);
