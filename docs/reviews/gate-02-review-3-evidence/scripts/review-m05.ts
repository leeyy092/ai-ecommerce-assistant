import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';import {getPrismaClient,resetClientPool} from './src/database/prisma';
const T='/tmp/gate02-review3-20260925-8_hqanp6',a=JSON.parse(readFileSync(T+'/actors-private.json','utf8')),db=getPrismaClient(),B=process.env.BETTER_AUTH_URL!,rs:any[]=[];
const day=86400000,base=Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'),d=(n:number)=>new Date(base+n*day).toISOString().slice(0,10);
async function check(name:string,expected:any,f:()=>Promise<any>){let actual;try{actual=await f();assert.deepEqual(actual,expected);rs.push({name,expected,actual,status:'PASS'})}catch(e:any){rs.push({name,expected,actual,status:'FAIL',error:e.message})}writeFileSync(T+'/evidence/m05-assertions.json',JSON.stringify(rs,null,2));console.log(name,rs.at(-1).status)}
async function q(s:string){const r=await fetch(B+'/api/v1/data-sources?store_id='+a.storeId+s,{headers:{cookie:a.owner.cookie}});const b:any=await r.json();const c=b.data?.items.find((x:any)=>x.id===a.sourceId)?.coverage??[];return{status:r.status,days:c.length,from:c[0]?.date,to:c.at(-1)?.date}}
async function main(){await db.dataCoverage.deleteMany({where:{storeId:a.storeId}});const task=await db.importTask.findFirstOrThrow({where:{storeId:a.storeId}});
 await db.dataCoverage.createMany({data:Array.from({length:221},(_,i)=>({orgId:a.owner.orgId,storeId:a.storeId,dataSourceId:a.sourceId,sourceKind:'products' as const,channel:'default_channel' as const,coverageDate:new Date(base+(i-110)*day),status:'complete' as const,explicitZero:true,recordCount:0n,datasetVersion:2n,importTaskId:task.id}))});
 await check('M05 absent bounds exact 90 days',{status:200,days:90,from:d(-89),to:d(0)},()=>q(''));
 await check('M05 from only exact 90 days',{status:200,days:90,from:d(-50),to:d(39)},()=>q('&from='+d(-50)));
 await check('M05 to only exact 90 days',{status:200,days:90,from:d(-85),to:d(4)},()=>q('&to='+d(5)));
 await check('M05 explicit 90 and exclusive end',{status:200,days:90,from:d(-89),to:d(0)},()=>q('&from='+d(-89)+'&to='+d(1)));
 await check('M05 91 days rejected',422,async()=>(await q('&from='+d(-90)+'&to='+d(1))).status);
 await db.$disconnect();await resetClientPool();process.exit(rs.some(x=>x.status==='FAIL')?1:0);
}main().catch(e=>{console.error(e);process.exit(2)});
