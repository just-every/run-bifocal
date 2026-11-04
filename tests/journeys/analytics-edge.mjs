import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, rm } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from 'node:net'
import {execFileSync} from 'node:child_process'
const exportFields=['artifact_id','snapshot_id','snapshot_digest','metric','dimensions_json','value','numerator','denominator','unit','state','source_json','observed_at']
/** Only Vane, Google and Stripe HTTPS are faked from the pinned published protocols in
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
 const state={phase:'success',stripePhase:'success',calls:[],inserted:[]}
 const ownerAddress='synthetic-bifocal-1'+String.fromCharCode(64)+'example.test',mailAddress='synthetic-bifocal-2'+String.fromCharCode(64)+'example.test'
 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-analytics',host:'127.0.0.1',port,inspectorPort:0,cf:false,modulesRoot:resolve('dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(analyticsPersist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:ownerAddress,SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:mailAddress,BIFOCAL_VANE_ORIGIN:vaneOrigin,SETUP_TOKEN:'synthetic-bifocal-1'.repeat(3)},outboundService:async request=>{
  const url=new URL(request.url);state.calls.push({host:url.hostname,path:url.pathname,method:request.method})
  assert.equal(url.protocol,'https:');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-60');assert.equal(request.headers.has('cookie'),false)
  assert.ok([new URL(vaneOrigin).hostname,'bigquery.googleapis.com','api.stripe.com'].includes(url.hostname),'no arbitrary host or telemetry egress')
  if(url.hostname==='api.stripe.com')return stripeResponse(request,url,state)
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
 return {origin,vaneOrigin,state,db:await mf.getD1Database('DB'),close:()=>mf.dispose()}
}

// Self-authored specimens from Stripe's cited list and object schemas. They
// qualify only this bounded HTTPS protocol edge, never a live grant or account.
function stripeResponse(request,url,state) {
 assert.equal(request.method,'GET');assert.equal(url.pathname,'/v1/balance_transactions')
 assert.equal(request.headers.get('stripe-version'),'2026-10-28.endive')
 assert.equal(request.headers.has('stripe-account'),false)
 assert.deepEqual([...url.searchParams.keys()].sort(),['created[gte]','created[lt]','limit',...(url.searchParams.has('starting_after')?['starting_after']:[])].sort())
 assert.equal(url.searchParams.get('created[gte]'),String(Date.parse('2026-06-01')/1000));assert.equal(url.searchParams.get('created[lt]'),String(Date.parse('2026-07-01')/1000));assert.equal(url.searchParams.get('limit'),'100')
 const phase=state.stripePhase,after=url.searchParams.get('starting_after')
 const base={object:'balance_transaction',currency:'usd',available_on:Date.parse('2026-07-02T00:00:00Z')/1000,status:'available',fee:0,source:null}
 const fixtures=[
  {...base,id:'synthetic-bifocal-301',created:Date.parse('2026-06-30T12:34:56Z')/1000,type:'charge',source:'synthetic-bifocal-401',amount:12345,fee:345,net:12000},
  {...base,id:'synthetic-bifocal-302',created:Date.parse('2026-06-29T00:00:00Z')/1000,type:'refund',status:'pending',source:'synthetic-bifocal-402',amount:-2345,net:-2345},
  {...base,id:'synthetic-bifocal-303',created:Date.parse('2026-06-28T00:00:00Z')/1000,type:'stripe_fee',amount:-125,net:-125},
  {...base,id:'synthetic-bifocal-304',created:Date.parse('2026-06-27T00:00:00Z')/1000,type:'adjustment',amount:0,net:0}
 ]
 if((!after && phase.startsWith('first-')) || after) {
  const status=Number(phase.replace(/^first-/,'').replace(/^later-/,''))
  if([401,403,429].includes(status))return Response.json({error:{message:'Bearer synthetic-bifocal-60'}},{status})
  if(phase.endsWith('redirect'))return new Response(null,{status:302,headers:{location:'https://foreign.example.test/private'}})
 }
 if(phase==='pages') {
  const start=after?Number(after.split('-').at(-1))+1:1000
  return Response.json({object:'list',url:'/v1/balance_transactions',has_more:true,data:Array.from({length:100},(_,i)=>({...fixtures[0],id:'synthetic-bifocal-'+(start+i)}))})
 }
 if(phase==='bytes')return Response.json({object:'list',url:'/v1/balance_transactions',has_more:true,data:[{...fixtures[0],id:'synthetic-bifocal-'+(after?Number(after.split('-').at(-1))+1:9000)}],ignored:'x'.repeat(800000)})
 if(after)assert.equal(after,'synthetic-bifocal-302')
 const body={object:'list',url:'/v1/balance_transactions',has_more:!after,data:after?fixtures.slice(2):fixtures.slice(0,2)}
 if(after) {
  if(phase==='duplicate')body.data[0]=fixtures[0]
  if(phase==='empty-page')body.data=[]
  if(phase==='currency')body.data[0].currency='eur'
  if(phase==='net')body.data[0].net=-124
  if(phase==='missing-net')delete body.data[0].net
  if(phase==='missing-source')delete body.data[0].source
  if(phase==='expanded-source')body.data[0].source={id:'synthetic-bifocal-403'}
  if(phase==='unsafe')body.data[0].amount=9007199254740992
  if(phase==='out-of-order')body.data[0].created=Date.parse('2026-06-30T13:00:00Z')/1000
  if(phase==='outside')body.data[0].created=Date.parse('2026-07-01')/1000
  if(phase==='incomplete')delete body.has_more
  if(phase==='status')body.data[0].status='draft'
  if(phase==='credential')body.data[0].description='Bearer synthetic-bifocal-60'
  if(phase==='escaped-credential')return new Response(JSON.stringify(body).replace('"has_more"','"ignored":"synthetic-bifocal-\\u00360","has_more"'),{headers:{'content-type':'application/json'}})
  if(phase==='precision')return new Response(JSON.stringify(body).replace('"amount":-125','"amount":9007199254740990.1'),{headers:{'content-type':'application/json'}})
  if(phase==='malformed')return new Response('{"object":"list"',{headers:{'content-type':'application/json'}})
  if(phase==='deadline')return new Promise(resolve=>setTimeout(()=>resolve(Response.json(body)),16000))
 }
 return Response.json(body)
}
