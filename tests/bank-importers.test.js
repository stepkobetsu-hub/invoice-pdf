const assert=require('node:assert/strict');
const {decodeBankCsv,parseSmbcWeb21,reiwaDate}=require('../assets/bank-importers.js');

assert.equal(reiwaDate('080810'),'2026-08-10');

const fixture=[
  '1,03,0,080810,080803,080810,0009,"BANK",403,"BRANCH",000,1,0000000000,"ACCOUNT",1,1,1," "',
  '2,10000001,080810,080810,1,11,000000031275,000000000000,,,,,,,"ﾔﾏﾀﾞ ﾊﾅｺ",BANK,BRANCH,"ﾌﾘｺﾐ",,',
  '2,10000002,080810,080810,2,14,000000001000,000000000000,,,,,,,,,,,"W21 TEST",0,',
  '8,1,31275,1,1000,1,00000000030275,2,',
  '9,5,1,',
].join('\r\n');
const parsed=parseSmbcWeb21(fixture);
assert.equal(parsed.sourceType,'smbc_web21_csv');
assert.equal(parsed.transactions.length,2);
assert.deepEqual(parsed.transactions[0],{
  sourceTransactionId:'2026-08-10:10000001',transactionDate:'2026-08-10',
  descriptionRaw:'ﾌﾘｺﾐ ﾔﾏﾀﾞ ﾊﾅｺ BANK BRANCH',payerNameRaw:'ﾔﾏﾀﾞ ﾊﾅｺ',depositAmount:31275,withdrawalAmount:0,currency:'JPY',
});
assert.equal(parsed.transactions[1].depositAmount,0);
assert.equal(parsed.transactions[1].withdrawalAmount,1000);

const cp932Like=Uint8Array.from([0x31,0x2c,0xb1]);
assert.equal(decodeBankCsv(cp932Like).encoding,'shift_jis');
assert.throws(()=>parseSmbcWeb21('date,amount,name'),/Web21/);
console.log('SMBC Web21 importer checks passed.');
