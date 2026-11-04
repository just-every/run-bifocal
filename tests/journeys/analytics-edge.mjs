import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, rm } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from 'node:net'
import {execFileSync} from 'node:child_process'
import {DatabaseSync} from 'node:sqlite'
const exportFields=['artifact_id','snapshot_id','snapshot_digest','metric','dimensions_json','value','numerator','denominator','unit','state','source_json','observed_at']
/** Only Vane/Google HTTPS are faked from the pinned published protocols in
 * docs/ANALYTICS-HANDOFFS.md. The real emitted Worker, assets, D1 and auth run. */
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
 const modules=[{type:'ESModule',path:resolve('dist/server/index.js')},...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>({type:'ESModule',path:resolve('dist/server/assets',name)}))]
 const state={phase:'success',calls:[],inserted:[],catalogPhase:'success',catalogCalls:[],catalogGate:null,catalogEntered:null}
 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-analytics',host:'127.0.0.1',port,inspectorPort:0,cf:false,modulesRoot:resolve('dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(analyticsPersist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:'synthetic-bifocal-2@example.test',BIFOCAL_VANE_ORIGIN:vaneOrigin,SETUP_TOKEN:'synthetic-bifocal-1'.repeat(3)},outboundService:async request=>{
  const url=new URL(request.url);state.calls.push({host:url.hostname,path:url.pathname,method:request.method})
  assert.equal(url.protocol,'https:');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-60');assert.equal(request.headers.has('cookie'),false)
  assert.ok([new URL(vaneOrigin).hostname,'bigquery.googleapis.com'].includes(url.hostname),'no arbitrary host or telemetry egress')
  if(url.hostname===new URL(vaneOrigin).hostname) {
   assert.equal(request.method,'GET');assert.equal(url.pathname,'/api/v1/stats');assert.equal(url.searchParams.get('site_id'),'synthetic-bifocal-61');assert.equal(url.searchParams.get('dimension'),'utm_campaign')
   if(state.phase==='revoked')return Response.json({error:'key_revoked'},{status:403})
   if(state.phase==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})
   return Response.json({site_id:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',time_zone:'America/New_York',dimension:'utm_campaign',results:{visitors:2400,visits:3300},breakdown:[{value:'Spring launch',visitors:1800,visits:2400,conversions:128,conversionRate:5.3,revenue:32000.15,currency:'USD'},{value:'Partner referral',visitors:600,visits:900,conversions:72,conversionRate:8,revenue:12500,currency:'USD'}]})
  }
  if(url.searchParams.has('fields')) {
   assert.equal(request.method,'GET');assert.equal(await request.text(),'')
   assert.equal(request.headers.has('origin'),false)
   state.catalogCalls.push({path:url.pathname,query:Object.fromEntries(url.searchParams)})
   if(state.catalogGate){state.catalogEntered();await state.catalogGate}
   if(['403','404','429'].includes(state.catalogPhase))return Response.json({error:{message:'synthetic-private-metadata',details:['synthetic-bifocal-60']}},{status:Number(state.catalogPhase)})
   if(state.catalogPhase==='redirect')return new Response(null,{status:307,headers:{location:'https://unapproved.example.test/metadata'}})
   const base='/bigquery/v2/projects/synthetic-bifocal-62/datasets',cursor=url.searchParams.get('pageToken')
   if(url.pathname===base) {
    assert.equal(url.searchParams.get('maxResults'),'50')
    assert.equal(url.searchParams.get('fields'),'nextPageToken,datasets(datasetReference(projectId,datasetId),location)')
    const row=(id,location='US')=>({datasetReference:{projectId:'synthetic-bifocal-62',datasetId:id},location,friendlyName:'synthetic-private-metadata',labels:{private:'synthetic-private-metadata'}})
    return Response.json({datasets:cursor?[row('archive')]:[row('business'),row('europe','EU')],...(!cursor?{nextPageToken:'synthetic-bifocal-page-2'}:{})})
   }
   if(url.pathname===base+'/business/tables') {
    assert.equal(url.searchParams.get('maxResults'),'50')
    assert.equal(url.searchParams.get('fields'),'nextPageToken,tables(tableReference(projectId,datasetId,tableId),type)')
    const row=id=>({tableReference:{projectId:state.catalogPhase==='wrong-project'?'foreign-project':'synthetic-bifocal-62',datasetId:'business',tableId:id},type:state.catalogPhase==='malformed-catalog'?null:'TABLE',view:{query:'synthetic-private-metadata'},externalDataConfiguration:{connectionId:'synthetic-private-metadata'}})
    if(state.catalogPhase==='overflow')return Response.json({tables:[row('table_'+(cursor??'0'))],nextPageToken:String(Number(cursor??0)+1)})
    return Response.json({tables:cursor?[row(state.catalogPhase==='duplicate'?'usage':'complex')]:[row('usage')],...(['cursor-false','cursor-zero','cursor-null'].includes(state.catalogPhase)?{nextPageToken:state.catalogPhase==='cursor-false'?false:state.catalogPhase==='cursor-zero'?0:null}:!cursor||state.catalogPhase==='repeat'?{nextPageToken:'synthetic-bifocal-page-2'}:{})})
   }
   assert.match(url.pathname,new RegExp('^'+base+'/business/tables/(usage|complex)$'))
   assert.ok(!/query|connection|description|policyTags/.test(url.searchParams.get('fields')))
   const schemaFields=[{name:'campaign',type:'STRING',description:'synthetic-private-metadata'},{name:'amount',type:'NUMERIC',mode:'REQUIRED'},{name:'events',type:'RECORD',mode:'REPEATED',fields:[{name:'day',type:'DATE'},{name:'detail',type:'RECORD',fields:[{name:'code',type:'STRING'}]}]},{name:'payload',type:'JSON'},{name:'future',type:'FUTURE_TYPE'}]
   if(state.catalogPhase==='schema-overflow')schemaFields.push(...Array.from({length:251},(_,n)=>({name:'field_'+n,type:'STRING'})))
   if(state.catalogPhase==='malformed-schema')schemaFields[0].mode='UNRECOGNIZED'
   return Response.json({tableReference:{projectId:'synthetic-bifocal-62',datasetId:'business',tableId:url.pathname.split('/').at(-1)},location:state.catalogPhase==='non-us'?'EU':'US',type:['VIEW','EXTERNAL'].includes(state.catalogPhase)?state.catalogPhase:'TABLE',view:{query:'synthetic-private-metadata'},externalDataConfiguration:{connectionId:'synthetic-private-metadata'},schema:state.catalogPhase==='schema-unavailable'?{}:{fields:state.catalogPhase==='schema-not-array'?{}:schemaFields},...(state.catalogPhase==='credential-response'?{description:'synthetic-bifocal-60'}:{})})
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
 const dbPath=(await readdir(join(analyticsPersist,'v3'),{recursive:true})).find(path=>path.endsWith('.sqlite'))
 const inspect=sql=>{const db=new DatabaseSync(join(analyticsPersist,'v3',dbPath),{readOnly:true});try{return db.prepare(sql).all().map(row=>({...row}))}finally{db.close()}}
 // The real native invitation and confirmation handler seeds a member; only
 // its mail boundary is captured, as in machine-boundary-worker.mjs.
 const {createOperatorAuth,createAuthHandler}=await import('../../src/modules/operator-auth/index.mjs')
 const mail=[],auth=createAuthHandler(createOperatorAuth({db:await mf.getD1Database('DB'),clientIp:()=> '127.0.0.1',config:{dependencies:true,origin,local:true,OWNER_EMAIL:'synthetic-bifocal-1'+String.fromCharCode(64)+'example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:'synthetic-bifocal-2'+String.fromCharCode(64)+'example.test'},mailSender:{async send(message){mail.push(message);return {status:'accepted',provider:'resend',providerMessageId:'synthetic-bifocal-mail'}}}}))
 const confirmMail=async()=>{
  const link=mail.at(-1).text.match(/https?:[^\s]+/)[0],token=new URL(link).searchParams.get('token')
  const confirmed=await auth(new Request(origin+'/auth/confirm',{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,'content-type':'application/json'},body:JSON.stringify({token})}))
  assert.equal(confirmed.status,303,await confirmed.text())
  return confirmed.headers.get('set-cookie').split(';')[0]
 }
 const nativeMember=async cookie=>{
  const invite=await auth(new Request(origin+'/auth/invite',{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,cookie,'content-type':'application/json'},body:JSON.stringify({email:'synthetic-bifocal-catalog-member'+String.fromCharCode(64)+'example.test',displayName:'Synthetic catalog member',role:'member'})}))
  assert.equal(invite.status,202,await invite.text());return confirmMail()
 }
 const nativeOwner=async()=>{
  const response=await auth(new Request(origin+'/auth/magic-link',{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,'content-type':'application/json'},body:JSON.stringify({email:'synthetic-bifocal-1'+String.fromCharCode(64)+'example.test'})}))
  assert.equal(response.status,202,await response.text());return confirmMail()
 }
 return {origin,vaneOrigin,state,inspect,nativeMember,nativeOwner,close:()=>mf.dispose()}
}
