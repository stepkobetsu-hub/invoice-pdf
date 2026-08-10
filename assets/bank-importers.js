(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StepBankImporters=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function parseCsv(text){
    const rows=[];let row=[],value='',quoted=false;
    for(let index=0;index<text.length;index+=1){
      const char=text[index];
      if(char==='"'){
        if(quoted&&text[index+1]==='"'){value+='"';index+=1;}else quoted=!quoted;
      }else if(char===','&&!quoted){row.push(value);value='';}
      else if((char==='\n'||char==='\r')&&!quoted){
        if(char==='\r'&&text[index+1]==='\n')index+=1;
        row.push(value);if(row.some(cell=>cell!==''))rows.push(row);row=[];value='';
      }else value+=char;
    }
    row.push(value);if(row.some(cell=>cell!==''))rows.push(row);
    return rows;
  }
  function decodeBankCsv(bytes){
    for(const encoding of ['utf-8','shift_jis']){
      try{return {text:new TextDecoder(encoding,{fatal:true}).decode(bytes),encoding};}catch(_error){}
    }
    throw new Error('CSV文字コードを判定できませんでした。');
  }
  function reiwaDate(value){
    const digits=String(value||'').replace(/\D/g,'');
    if(!/^\d{6}$/.test(digits))throw new Error('Web21明細の日付形式が不正です。');
    const year=2018+Number(digits.slice(0,2));
    const month=digits.slice(2,4),day=digits.slice(4,6);
    const iso=`${year}-${month}-${day}`;
    const date=new Date(Date.UTC(year,Number(month)-1,Number(day)));
    if(Number.isNaN(date.valueOf())||date.getUTCMonth()+1!==Number(month)||date.getUTCDate()!==Number(day))throw new Error('Web21明細の日付が不正です。');
    return iso;
  }
  function parseSmbcWeb21(text){
    const rows=parseCsv(text);
    const header=rows[0]||[];
    if(header[0]!=='1'||header.length<18)throw new Error('三井住友銀行Web21の入出金明細CSVではありません。');
    if(!rows.some(row=>row[0]==='8')||!rows.some(row=>row[0]==='9'))throw new Error('Web21 CSVの集計・終端レコードがありません。');
    const accountIdentifier=[header[8],header[10],header[11],header[12]].map(value=>String(value||'').trim()).join(':');
    const transactions=rows.filter(row=>row[0]==='2').map((row,index)=>{
      if(row.length<20)throw new Error(`Web21明細${index+1}行目の列数が不正です。`);
      const direction=String(row[4]||'');
      if(!['1','2'].includes(direction))throw new Error(`Web21明細${index+1}行目の入出金区分が不正です。`);
      const amount=Number(String(row[6]||'').replace(/^0+(?=\d)/,''));
      if(!Number.isSafeInteger(amount)||amount<0)throw new Error(`Web21明細${index+1}行目の金額が不正です。`);
      const transactionDate=reiwaDate(row[2]);
      const payerNameRaw=direction==='1'?String(row[14]||'').trim():'';
      const transactionLabel=String(row[17]||'').trim();
      const bankAndBranch=[row[15],row[16]].map(value=>String(value||'').trim()).filter(Boolean).join(' ');
      return {
        sourceTransactionId:`${transactionDate}:${String(row[1]||'').trim()}`,
        transactionDate,
        descriptionRaw:[transactionLabel,payerNameRaw,bankAndBranch].filter(Boolean).join(' '),
        payerNameRaw,
        depositAmount:direction==='1'?amount:0,
        withdrawalAmount:direction==='2'?amount:0,
        currency:'JPY',
      };
    });
    return {sourceType:'smbc_web21_csv',accountIdentifier,transactions};
  }
  async function sha256Hex(bytes){
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  async function importFile(file){
    const bytes=await file.arrayBuffer();
    const decoded=decodeBankCsv(bytes);
    return {...parseSmbcWeb21(decoded.text),encoding:decoded.encoding,fileName:file.name,fileSha256:await sha256Hex(bytes)};
  }
  return {parseCsv,decodeBankCsv,reiwaDate,parseSmbcWeb21,sha256Hex,importFile};
});
