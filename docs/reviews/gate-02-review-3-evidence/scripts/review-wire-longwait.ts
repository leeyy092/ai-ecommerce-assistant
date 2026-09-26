import http from 'node:http';import{readFileSync,writeFileSync,readdirSync}from'node:fs';import assert from'node:assert/strict';import{getPrismaClient,resetClientPool}from'./src/database/prisma';
const T='/tmp/gate02-review3-20260925-8_hqanp6',a=JSON.parse(readFileSync(T+'/actors-private.json','utf8')),B=process.env.BETTER_AUTH_URL!,results:any[]=[];
async function wire(name:string,chunks:Buffer[],code:string){await getPrismaClient().authRateLimit.deleteMany();const boundary='review-wire-boundary';let sent=0,ended=false;
const actual:any=await new Promise(resolve=>{let done=false;const finish=(r:any)=>{if(done)return;done=true;clearTimeout(timer);resolve({...r,bytes_sent:sent,multipart_closed:ended});req.destroy()};const req=http.request(B+'/api/v1/imports',{method:'POST',headers:{cookie:a.owner.cookie,origin:B,'content-type':'multipart/form-data; boundary='+boundary}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{let b:any;try{b=JSON.parse(body)}catch{}finish({status:res.statusCode,code:b?.error?.code,message:b?.error?.message})})});req.on('error',e=>finish({error:e.message}));const timer=setTimeout(()=>finish({timeout:true}),20000);
const fields=[['store_id',a.storeId],['data_source_id',a.sourceId],['entity_type','products']].map(([k,v])=>`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');req.write(fields+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="wire.csv"\r\n\r\n`);void(async()=>{for(const c of chunks){if(done)return;sent+=c.length;await new Promise<void>(r=>req.write(c,()=>r()));}})();});
let status='PASS',error;try{assert.equal(actual.status,422);assert.equal(actual.code,code);assert.equal(actual.multipart_closed,false)}catch(e:any){status='FAIL';error=e.message}results.push({name,expected:{status:422,code,multipart_closed:false},actual,status,error});console.log(name,status,actual)}
async function main(){
await wire('H06 true HTTP incomplete multipart byte boundary',Array.from({length:22},()=>Buffer.alloc(1024*1024,97)),'FILE_TOO_LARGE');
await wire('H06 true HTTP incomplete multipart record boundary',[Buffer.from('a,b\n'),...Array.from({length:11},()=>Buffer.from('x,y\n'.repeat(10000)))],'TOO_MANY_ROWS');
writeFileSync(T+'/evidence/wire-longwait-assertions.json',JSON.stringify(results,null,2));await getPrismaClient().$disconnect();await resetClientPool();process.exit(results.some(x=>x.status==='FAIL')?1:0);

}
main().catch(e=>{console.error(e);process.exit(2)});
