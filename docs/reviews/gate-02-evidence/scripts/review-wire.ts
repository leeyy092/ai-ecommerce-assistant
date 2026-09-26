import http from 'node:http';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
const T='/tmp/aiea-g2-review-h99ruviq',a=JSON.parse(readFileSync(T+'/actors-private.json','utf8'));
async function main(){
 const boundary='g2-review-wire-boundary';let responded=false,result:any,sent=0;
 const req=http.request('http://127.0.0.1:3322/api/v1/imports',{method:'POST',headers:{cookie:a.owner.cookie,origin:'http://127.0.0.1:3322','content-type':'multipart/form-data; boundary='+boundary}},res=>{responded=true;let body='';res.on('data',c=>body+=c);res.on('end',()=>{result={status:res.statusCode,body:JSON.parse(body)}})});
 req.setTimeout(12000,()=>req.destroy(new Error('wire timeout')));
 const fields=[['store_id',a.storeId],['data_source_id',a.sourceId],['source_kind','products']].map(([k,v])=>`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
 req.write(fields+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="wire.csv"\r\nContent-Type: text/csv\r\n\r\n`);
 for(let i=0;i<21;i++){sent+=1024*1024;if(!req.write(Buffer.alloc(1024*1024,97)))await once(req,'drain');}
 await new Promise(r=>setTimeout(r,1000));const beforeClose={file_bytes_sent:sent,response_before_multipart_end:responded};
 req.write(Buffer.alloc(1024*1024,98));sent+=1024*1024;req.end(`\r\n--${boundary}--\r\n`);
 for(let i=0;i<100&&!result;i++)await new Promise(r=>setTimeout(r,50));
 const out={...beforeClose,total_file_bytes_sent:sent,result};writeFileSync(T+'/evidence/wire-probes.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
}
main().catch(e=>{console.error(e);process.exit(1)});
