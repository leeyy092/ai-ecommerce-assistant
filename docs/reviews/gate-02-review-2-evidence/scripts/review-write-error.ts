import{Readable}from'node:stream';import{mkdirSync,chmodSync}from'node:fs';import{spoolUpload}from'./src/services/imports';import{setStorageRoot}from'./src/storage';
const root='/tmp/aiea-g2r2-9hnwja_c/unwritable';mkdirSync(root+'/tmp',{recursive:true});chmodSync(root+'/tmp',0o500);setStorageRoot(root);
spoolUpload(new Readable({read(){this.push('a,b\n1,2');this._read=()=>{};}})).then(()=>{console.log('UNEXPECTED_SUCCESS');process.exitCode=2}).catch((e:any)=>{console.log('HANDLED_FAILURE',e.code);process.exitCode=0});
setTimeout(()=>{console.log('UNSETTLED');process.exit(3)},3000);
