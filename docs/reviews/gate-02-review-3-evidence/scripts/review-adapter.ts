import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FILE_HEADERS,FILE_KINDS,getAdapter,parseStandardFile,validateTimestamp,validateAmount,validateInteger,createCanonicalBatch} from './src/adapters/contracts';
import {GOLDEN_EXPECTED} from './tests/fixtures/golden/expected-records';
import {goldenCoverageA,goldenCoverageB} from './tests/fixtures/golden/coverage-golden';
import * as mocks from './tests/fixtures/golden/mock-golden';
const T='/tmp/gate02-review3-20260925-8_hqanp6';const rs:any[]=[];
function check(name:string,expected:any,fn:()=>any){let actual;try{actual=fn();assert.deepEqual(actual,expected);rs.push({name,expected,actual,status:'PASS'})}catch(e:any){rs.push({name,expected,actual,status:'FAIL',error:e.message.slice(0,700)})}console.log(name,rs.at(-1).status)}
for(const [s,store]of[['A','a'],['B','b']] as const)for(const kind of Object.keys(FILE_HEADERS)){const c=readFileSync(`tests/fixtures/golden/store-${store}/${kind}.csv`,'utf8');check(`H04 ${s}/${kind} CSV normative oracle`,true,()=>{assert.deepEqual(getAdapter('csv').parse(kind as any,{storeExternalId:'XM-DEMO-'+s},c).records,GOLDEN_EXPECTED[s][kind as keyof typeof FILE_HEADERS]);return true});}
const products=readFileSync('tests/fixtures/golden/store-a/products.csv','utf8');
check('H03 numeric 20,6 upper boundary',[0,1],()=>['99999999999999.999999','100000000000000.000000'].map(v=>{const e:any[]=[];validateAmount(v,'amount',2,e,{required:true});return e.length}));
check('H03 unsafe integer refused',1,()=>{const e:any[]=[];validateInteger('9007199254740993','quantity',2,e,{required:true});return e.length});
for(const v of ['2026-02-30T00:00:00Z','2026-09-01T00:00:00','09/01/26','2026-09-01T00:00:00+24:00','2026-09-01T00:00:00+08:99'])check(`H03 timestamp invalid ${v}`,{errors:1,throws:false},()=>{const e:any[]=[];try{validateTimestamp(v,'source_updated_at',2,e,{required:true});return{errors:e.length,throws:false}}catch{return{errors:e.length,throws:true}}});
check('H03 source time missing no invented value',true,()=>{const p=parseStandardFile('products',products.replaceAll('2026-09-11T09:00:00+08:00',''),{storeExternalId:'XM-DEMO-A'});return p.records.length===0&&p.errors.some(x=>x.column==='source_updated_at')});
check('H03 optional columns may be omitted',true,()=>{const lines=products.trim().split(/\r?\n/).map(x=>x.split(','));const remove=[lines[0].indexOf('category'),lines[0].indexOf('specification')];const c=lines.map(l=>l.filter((_,i)=>!remove.includes(i)).join(',')).join('\n');return parseStandardFile('products',c,{storeExternalId:'XM-DEMO-A'}).errors.length===0});
check('H03 blank required enum rejected',true,()=>{const p=parseStandardFile('products',products.replaceAll(',active,',',,'),{storeExternalId:'XM-DEMO-A'});return p.records.length===0&&p.errors.length>0});
check('H03 duplicate header refused','DUPLICATE_COLUMN',()=>parseStandardFile('products','name,name\na,b',{storeExternalId:'XM-DEMO-A'}).errors[0].code);
check('H03 unclosed quote refused','INVALID_CSV',()=>parseStandardFile('products',products+'"unclosed',{storeExternalId:'XM-DEMO-A'}).errors[0].code);
check('H03 STORE_MISMATCH whole file rejection',[0,'STORE_MISMATCH'],()=>{const p=parseStandardFile('products',products.replace('XM-DEMO-A','XM-DEMO-B'),{storeExternalId:'XM-DEMO-A'});return[p.records.length,p.errors[0].code]});
check('H04 complaint normative distinction',[false,null],()=>[GOLDEN_EXPECTED.A.customer_messages[2],GOLDEN_EXPECTED.B.customer_messages[0]].map((x:any)=>x.isComplaint));
check('H04 independent explicit zeros match case refund dates',[['2026-09-01','2026-09-03','2026-09-04','2026-09-05','2026-09-06','2026-09-07','2026-09-08','2026-09-09','2026-09-10'],['2026-09-01','2026-09-02','2026-09-05','2026-09-06','2026-09-07','2026-09-08','2026-09-10'],10,10],()=>[goldenCoverageA.find(x=>x.source_kind==='after_sales' && x.channel==='case')!.explicit_zero_dates,goldenCoverageA.find(x=>x.source_kind==='after_sales' && x.channel==='refund')!.explicit_zero_dates,...goldenCoverageB.filter(x=>x.source_kind==='after_sales').map(x=>x.explicit_zero_dates.length)]);
check('H04 coverage channel matches data contract enum default/case/refund',true,()=>[...goldenCoverageA,...goldenCoverageB].every(x=>x.source_kind==='after_sales'?['case','refund'].includes(x.channel):x.channel==='default'));
const args:any={sourceKind:'products',sourceNamespace:'review',storeId:'11111111-1111-1111-1111-111111111111',adapterKind:'csv',rawChecksum:createHash('sha256').update(products).digest('hex'),parse:parseStandardFile('products',products,{storeExternalId:'XM-DEMO-A'})};
check('H04 batch metadata stable',true,()=>{const b=createCanonicalBatch(args);return b.store_id===args.storeId&&b.source_namespace==='review'&&b.raw_checksum===args.rawChecksum&&b.adapter_version==='adapter-v1'&&b.records.length===2});

for(const [store,dataset] of [['A',mocks.mockGoldenA],['B',mocks.mockGoldenB]] as const)for(const kind of Object.keys(FILE_HEADERS))check(`H04 ${store}/${kind} Mock normative oracle`,true,()=>{assert.deepEqual(getAdapter('mock').parse(kind as any,{storeExternalId:'XM-DEMO-'+store},JSON.stringify(dataset)).records,GOLDEN_EXPECTED[store][kind as keyof typeof FILE_HEADERS]);return true});
for(const [source_kind,channel] of [['orders','orders/default'],['orders','case'],['after_sales','default']])check(`H04 invalid channel pairing ${source_kind}/${channel}`,true,()=>{assert.throws(()=>createCanonicalBatch({...args,coverageDeclaration:[{source_kind,channel,status:'complete',from:'2026-09-01',to:'2026-09-11',explicit_zero_dates:[]}]}));return true});
writeFileSync(T+'/evidence/adapter-assertions.json',JSON.stringify(rs,null,2));process.exit(rs.some(x=>x.status==='FAIL')?1:0);
