import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, rm } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from 'node:net'
import {execFileSync} from 'node:child_process'
const exportFields=['artifact_id','snapshot_id','snapshot_digest','metric','dimensions_json','value','numerator','denominator','unit','state','source_json','observed_at']
/** Only Vane, Google and Smartsheet HTTPS are faked from the pinned published protocols in
 * docs/ANALYTICS-HANDOFFS.md and docs/SMARTSHEET.md. The emitted Worker,
 * assets, D1 and authentication run with real authorization. */
export async function analyticsEdge(persist) {
 const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
 const analyticsPersist=join(persist,'analytics')
 try {
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',analyticsPersist,'--config','dist/server/wrangler.json'],{stdio:'pipe',maxBuffer:16*1024*1024,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
 } finally {
  // Wrangler migrations can leave scratch beside the emitted config too.
  await rm('dist/server/.wrangler', { recursive: true, force: true })
 }
 const origin=`http://127.0.0.1:${port}`,vaneOrigin='https://synthetic-bifocal-vane.workers.dev'
 const require=createRequire(import.meta.url),wrangler=createRequire(require.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=wrangler('miniflare')
 // A test-only mail sink uses unchanged native invitation and confirmation
 // handlers, producing real email sessions in the same store. Application
 // authorization and source transport results are never mocked.
 const {build}=wrangler('esbuild')
 const wrapper=await build({stdin:{contents:`import worker from './dist/server/index.js';
 import {createOperatorAuth,createAuthHandler} from './src/modules/operator-auth/index.mjs';
 const mail=[];
 export default {async fetch(request,env,execution){
  const path=new URL(request.url).pathname;
  if(path==='/__analytics-mail')return Response.json(mail);
  if(request.headers.get('X-Bifocal-Test-Mail')==='synthetic-bifocal-mail'&&['/auth/invite','/auth/confirm'].includes(path)){
   const auth=createOperatorAuth({db:env.DB,clientIp:()=> '127.0.0.1',config:{dependencies:true,origin:env.AUTH_ORIGIN,local:true,OWNER_EMAIL:env.OWNER_EMAIL,SESSION_SECRET:env.SESSION_SECRET,MAIL_FROM:env.MAIL_FROM},mailSender:{async send(message){mail.push(message);return {status:'accepted',provider:'resend',providerMessageId:'synthetic-bifocal-mail'}}}});
   return createAuthHandler(auth)(request);
  }
  return worker.fetch(request,env,execution);
 }};`,resolveDir:resolve('.')},bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:*'],mainFields:['module','main'],conditions:['workerd','worker','browser']})
 const modules=[{type:'ESModule',path:resolve('dist/server/analytics-test.mjs'),contents:wrapper.outputFiles[0].text},{type:'ESModule',path:resolve('dist/server/index.js')},...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>({type:'ESModule',path:resolve('dist/server/assets',name)}))]
 const state={phase:'success',smartsheet:'success',calls:[],inserted:[]}
 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-analytics',host:'127.0.0.1',port,inspectorPort:0,cf:false,modulesRoot:resolve('dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(analyticsPersist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:'synthetic-bifocal-2@example.test',BIFOCAL_VANE_ORIGIN:vaneOrigin,SETUP_TOKEN:'synthetic-bifocal-1'.repeat(3)},outboundService:async request=>{
  const url=new URL(request.url);state.calls.push({host:url.hostname,path:url.pathname,method:request.method,search:url.search})
  assert.equal(url.protocol,'https:');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-60');assert.equal(request.headers.has('cookie'),false)
  assert.ok([new URL(vaneOrigin).hostname,'bigquery.googleapis.com','api.smartsheet.com'].includes(url.hostname),'no arbitrary host or telemetry egress')
  if(url.hostname==='api.smartsheet.com') {
   // Self-authored responses from the pinned Sheet, Row, Column, Cell and
   // SheetVersion schemas; only this HTTPS boundary is replaced.
   const phase=state.smartsheet
   assert.equal(request.method,'GET');assert.match(url.pathname,/^\/2\.0\/sheets\/4583173393803140(?:\/version)?$/)
   if(phase==='denied'||phase==='revoked')return Response.json({errorCode:phase==='denied'?1006:1004,message:'synthetic-bifocal-88'},{status:phase==='denied'?404:403})
   if(phase==='rate')return Response.json({errorCode:4003,message:'synthetic-bifocal-89'},{status:429})
   if(phase==='redirect')return new Response(null,{status:302,headers:{location:'https://synthetic-bifocal.invalid/private'}})
   if(phase==='token-echo')return Response.json({version:17,name:'synthetic-bifocal-60'})
   if(phase==='response-overflow')return Response.json({id:4583173393803140,name:'x'.repeat(1048577),version:17,totalRowCount:101,columns:[],rows:[]})
   if(url.pathname.endsWith('/version')) {
    assert.equal(url.search,'')
    if(phase==='final-revoked')return Response.json({errorCode:1004,message:'synthetic-bifocal-90'},{status:403})
    return Response.json({version:phase==='final-drift'?18:17})
   }
   assert.deepEqual([...url.searchParams.keys()].sort(),['columnIds','include','level','page','pageSize'])
   assert.equal(url.searchParams.get('columnIds'),'1001,1002,1003,1004,1005');assert.equal(url.searchParams.get('include'),'objectValue');assert.equal(url.searchParams.get('level'),'2');assert.equal(url.searchParams.get('pageSize'),'100')
   const page=Number(url.searchParams.get('page'));assert.ok(page===1||page===2)
   const columns=[{id:1001,index:0,title:phase==='schema-drift'&&page===2?'Changed label':'Label',type:phase==='complex-column'?'MULTI_PICKLIST':'TEXT_NUMBER',version:0},{id:1002,index:1,title:'Amount',type:'TEXT_NUMBER',version:0},{id:1003,index:2,title:'Units',type:'TEXT_NUMBER',version:0},{id:1004,index:3,title:'Date',type:'DATE',version:0},{id:1005,index:4,title:'Active',type:'CHECKBOX',version:0}]
   const rows=Array.from({length:page===1?100:phase==='missing-row'?0:1},(_,index)=>{
    const ordinal=(page-1)*100+index,rowId=7000000000000001n+BigInt(ordinal)*2n
    const label=ordinal===0?'':ordinal===1?undefined:ordinal===2?'=HYPERLINK("https://synthetic-bifocal.invalid")':'Item '+(ordinal+1)
    const amount=ordinal===0?123.45:ordinal===1?-23.4:ordinal===2?0:undefined
    return {id:Number(phase==='duplicate-row'&&page===2?7000000000000001n:rowId),rowNumber:ordinal+1,cells:[{columnId:1001,...(label===undefined?{}:{value:phase==='cell-overflow'?'x'.repeat(4097):phase==='snapshot-overflow'?'x'.repeat(4000):label}),...(phase==='complex-cell'?{objectValue:{objectType:'MULTI_PICKLIST',values:['One','Two']}}:{})},{columnId:1002,...(amount===undefined?{}:{value:phase==='money-precision'?1.234:amount}),...(ordinal===0?{formula:'=SUM([Amount]2:[Amount]3)'}:{})},{columnId:1003,value:phase==='snapshot-overflow'?'1'.repeat(1500):ordinal===0?2:ordinal===1?3:0},{columnId:1004,...(ordinal===0?{value:'2026-06-30',objectValue:{objectType:'DATE',value:'2026-06-30'}}:{})},{columnId:1005,...(ordinal<2?{value:ordinal===0}:{})}]}
   })
   const result={id:4583173393803140,name:'synthetic-bifocal-87',version:phase==='page-drift'&&page===2?18:17,totalRowCount:phase==='row-overflow'?2001:phase==='empty'?0:101,columns,rows}
   if(phase==='empty')result.rows=[]
   if(phase==='column-missing')result.columns.pop()
   let text=JSON.stringify(result)
   if(phase==='unsafe-id')text=text.replace('7000000000000001','9007199254740993')
   if(phase==='unsafe-decimal')text=text.replace('123.45','123.450000000000001')
   return new Response(text,{headers:{'content-type':'application'+'/'+'json'}})
  }
  if(url.hostname===new URL(vaneOrigin).hostname) {
   assert.equal(request.method,'GET');assert.equal(url.pathname,'/api/v1/stats');assert.equal(url.searchParams.get('site_id'),'synthetic-bifocal-61');assert.equal(url.searchParams.get('dimension'),'utm_campaign')
   if(state.phase==='revoked')return Response.json({error:'key_revoked'},{status:403})
   if(state.phase==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})
   return Response.json({site_id:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',time_zone:'America/New_York',dimension:'utm_campaign',results:{visitors:2400,visits:3300},breakdown:[{value:'Spring launch',visitors:1800,visits:2400,conversions:128,conversionRate:5.3,revenue:32000.15,currency:'USD'},{value:'Partner referral',visitors:600,visits:900,conversions:72,conversionRate:8,revenue:12500,currency:'USD'}]})
  }
  assert.match(url.pathname,/^\/bigquery\/v2\/projects\/synthetic-bifocal-62\/datasets\/business\/tables\/(usage|reporting)(\/data|\/insertAll)?$/)
  if(url.pathname.endsWith('/data')) {
   assert.equal(request.method,'GET');assert.equal(url.searchParams.get('selectedFields'),'campaign,active_accounts,day')
   return Response.json({kind:'bigquery#tableDataList',totalRows:state.phase==='incomplete'?'3':'2',...(state.phase==='incomplete'?{pageToken:'synthetic-bifocal-63'}:{}),rows:[{f:[{v:'Spring launch'},{v:'184'},{v:'2026-06-30'}]},{f:[{v:'Partner referral'},{v:'96'},{v:'2026-06-30'}]}]})
  }
  if(url.pathname.endsWith('/insertAll')) {
   assert.equal(request.method,'POST');const body=await request.json();assert.equal(body.skipInvalidRows,false);assert.equal(body.ignoreUnknownValues,false);assert.equal(body.templateSuffix,undefined)
   assert.ok(body.rows.length>0);assert.ok(body.rows.every(row=>Object.keys(row.json).sort().join()===exportFields.toSorted().join() && Object.values(row.json).every(value=>typeof value==='string')))
   state.inserted.push(body.rows)
   if(state.phase==='uncertain')throw Error('synthetic-bifocal-64 network outcome unknown')
   return Response.json({kind:'bigquery#tableDataInsertAllResponse',...(state.phase==='partial'?{insertErrors:[{index:0,errors:[{reason:'invalid',message:'synthetic-bifocal-65'}]}]}:{})})
  }
  assert.equal(request.method,'GET')
  const usage=url.pathname.endsWith('/usage')
  return Response.json({tableReference:{projectId:'synthetic-bifocal-62',datasetId:'business',tableId:usage?'usage':'reporting'},location:'US',type:'TABLE',schema:{fields:usage?[{name:'campaign',type:'STRING'},{name:'active_accounts',type:'INTEGER'},{name:'day',type:'DATE'},{name:'restricted_salary',type:'NUMERIC'}]:exportFields.map(name=>({name,type:'STRING'}))}})
 }}))
 await mf.ready
 state.database=()=>mf.getD1Database('DB')
 return {origin,vaneOrigin,state,close:()=>mf.dispose()}
}
