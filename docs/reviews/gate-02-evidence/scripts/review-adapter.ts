import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {csvAdapter,mockAdapter,FILE_KINDS,FILE_HEADERS,parseCsv,validateAmount,validateTimestamp,validateDate} from './src/adapters/contracts';
import {mockGoldenA,mockGoldenB} from './tests/fixtures/golden/mock-golden';
const out:any={golden:[],boundaries:{}};
const ctx={storeExternalId:'XM-DEMO-A',sourceUpdatedAt:'2026-09-15T00:00:00Z'};
for(const [dir,data,store] of [['store-a',mockGoldenA,'XM-DEMO-A'],['store-b',mockGoldenB,'XM-DEMO-B']] as const){
 for(const k of FILE_KINDS){const c=csvAdapter.parse(k,{...ctx,storeExternalId:store},readFileSync(`tests/fixtures/golden/${dir}/${k}.csv`,'utf8'));const m=mockAdapter.parse(k,{...ctx,storeExternalId:store},JSON.stringify(data));assert.deepEqual(c,m);out.golden.push({store,kind:k,equal:true,records:c.records.length,errors:c.errors});}
}
function one(kind:any,row:any,change:any){const data=structuredClone(mockGoldenA);data[kind]=[{...row,...change}];return mockAdapter.parse(kind,ctx,JSON.stringify(data));}
const check=(name:string,result:any)=>{out.boundaries[name]={accepted:result.records.length,errors:result.errors,record:result.records[0]??null};};
check('amount_over_numeric_20_6',one('order_items',mockGoldenA.order_items[0],{item_paid_amount:'100000000000000.000000'}));
check('integer_over_safe_range',one('orders',mockGoldenA.orders[0],{expected_item_count:'9007199254740993'}));
check('ambiguous_datetime',one('orders',mockGoldenA.orders[0],{ordered_at:'09/01/26 09:55',paid_at:'09/01/26 10:00'}));
check('impossible_date',one('ads',mockGoldenA.ads[0],{report_date:'2026-02-30'}));
check('missing_source_time',one('orders',mockGoldenA.orders[0],{source_updated_at:null}));
check('refund_completed_before_occurred',one('after_sales',mockGoldenA.after_sales[1],{completed_at:'2026-09-01T00:00:00Z'}));
check('blank_required_enum',one('products',mockGoldenA.products[0],{product_status:null,sku_status:null}));
const base=readFileSync('tests/fixtures/golden/store-a/products.csv','utf8');
const rows=parseCsv(base);const cat=rows[0].indexOf('category');const spec=rows[0].indexOf('specification');
const optionalOmitted=rows.map(r=>r.filter((_,i)=>i!==cat&&i!==spec).join(',')).join('\n');
check('optional_columns_omitted',csvAdapter.parse('products',ctx,optionalOmitted));
const order=readFileSync('tests/fixtures/golden/store-a/orders.csv','utf8').trim().split('\n');
check('duplicate_headers',csvAdapter.parse('orders',ctx,order[0]+',currency\n'+order[1]+',USD'));
check('unclosed_quoted_field',csvAdapter.parse('products',ctx,rows[0].join(',')+'\n'+rows[1].slice(0,-1).join(',')+',"active'));
out.golden_source_contract={source:'04_DATA_MODEL section12.8',A_M3_expected:false,A_M3_actual:mockGoldenA.customer_messages[2].is_complaint,CSV_A_M3_actual:csvAdapter.parse('customer_messages',ctx,readFileSync('tests/fixtures/golden/store-a/customer_messages.csv','utf8')).records[2],expected_A_complaint_coverage:'3/3',actual_A_known:mockGoldenA.customer_messages.filter(r=>r.is_complaint!==null).length};
out.adapter_output_keys=Object.keys(csvAdapter.parse('orders',ctx,order.join('\n')));out.adapter_methods=Object.keys(csvAdapter);out.has_coverage_manifest='coverage_declaration' in csvAdapter.parse('orders',ctx,order.join('\n'));
writeFileSync('/tmp/aiea-g2-review-h99ruviq/evidence/adapter-probes.json',JSON.stringify(out,null,2));console.log(JSON.stringify({golden_pairs:out.golden.length,golden_equal:true,boundaries:Object.fromEntries(Object.entries(out.boundaries).map(([k,v]:any)=>[k,{accepted:v.accepted,error_codes:v.errors.map((e:any)=>e.code)}])),fixture_contract_match:false,has_coverage_manifest:out.has_coverage_manifest}));
