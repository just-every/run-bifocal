import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, rm } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from 'node:net'
import {execFileSync} from 'node:child_process'
const exportFields=['artifact_id','snapshot_id','snapshot_digest','metric','dimensions_json','value','numerator','denominator','unit','state','source_json','observed_at']
/** Only Vane, Google and Square HTTPS are faked from published protocols in
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
 const state={phase:'success',calls:[],inserted:[],squarePhase:'success',squareCalls:[]}
 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-analytics',host:'127.0.0.1',port,inspectorPort:0,cf:false,modulesRoot:resolve('./dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('./dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(analyticsPersist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:['synthetic-bifocal-1','example.test'].join('@'),SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:['synthetic-bifocal-2','example.test'].join('@'),BIFOCAL_VANE_ORIGIN:vaneOrigin,SETUP_TOKEN:'synthetic-bifocal-1'.repeat(3)},outboundService:async request=>{
  const url=new URL(request.url);state.calls.push({host:url.hostname,path:url.pathname,method:request.method})
  assert.equal(url.protocol,'https:');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-60');assert.equal(request.headers.has('cookie'),false)
  assert.ok([new URL(vaneOrigin).hostname,'bigquery.googleapis.com','connect.squareup.com','connect.squareupsandbox.com'].includes(url.hostname),'no arbitrary host or telemetry egress')
  if(['connect.squareup.com','connect.squareupsandbox.com'].includes(url.hostname))return squareResponse(request,state)
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
 const database=await mf.getD1Database('DB')
 // Synthetic native mail capture supplies the sign-in fixture. Confirmation,
 // sessions and every tested business request use the real emitted Worker.
 const {createOperatorAuth}=await import('../../src/modules/operator-auth/index.mjs')
 let message
 const auth=createOperatorAuth({db:database,config:{origin,local:true,OWNER_EMAIL:['synthetic-bifocal-1','example.test'].join('@'),SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:['synthetic-bifocal-2','example.test'].join('@')},clientIp:()=> '127.0.0.1',mailSender:{async send(value){message=value;return {status:'development'}}}})
 const signInAs=async(context,email,inviter)=>{
  message=null
  const cookie=inviter?(await inviter.cookies(origin)).map(c=>c.name+'='+c.value).join('; '):''
  const request=new Request(origin+'/auth/'+(inviter?'invite':'magic-link'),{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,Cookie:cookie}})
  if(inviter)await auth.invite(request,{email,displayName:'Square member',role:'member'})
  else await auth.requestMagicLink(request,{email})
  const link=message?.text?.match(/https?:[^\s]+/)?.[0]
  assert.ok(link,'Native synthetic mail supplies its sign-in link')
  const response=await context.request.post(origin+'/auth/confirm',{headers:{Origin:origin},data:{token:new URL(link).searchParams.get('token')},maxRedirects:0})
  assert.equal(response.status(),303,await response.text())
  const session=await context.request.get(origin+'/auth/session');assert.equal(session.status(),200,await session.text());return session.json()
 }
 return {origin,vaneOrigin,state,database,signInAs,close:()=>mf.dispose()}
}

// Self-authored, official-schema HTTPS edge specimens; no live Square receipt.
const usd=amount=>({amount,currency:'USD'})
const squareOrders=()=>[
 {id:'synthetic-bifocal-sale',location_id:'synthetic-bifocal-location',state:'COMPLETED',created_at:'2026-06-10T10:00:00Z',updated_at:'2026-06-11T11:00:00Z',closed_at:'2026-06-10T10:10:00Z',version:3,total_money:usd(11785),total_tax_money:usd(800),total_discount_money:usd(500),total_tip_money:usd(1200),total_service_charge_money:usd(285),return_amounts:{total_money:usd(2500),tax_money:usd(150),discount_money:usd(100),tip_money:usd(0),service_charge_money:usd(50)},net_amounts:{total_money:usd(9285),tax_money:usd(650),discount_money:usd(400),tip_money:usd(1200),service_charge_money:usd(235)},customer_id:'synthetic-bifocal-private-customer',fulfillments:[{type:'PICKUP',pickup_details:{recipient:{display_name:'Unnecessary customer data'}}}],line_items:[{uid:'synthetic-bifocal-item-1',quantity:'2',total_money:usd(9000)},{uid:'synthetic-bifocal-item-2',quantity:'1',total_money:usd(2785)}]},
 {id:'synthetic-bifocal-void',location_id:'synthetic-bifocal-location',state:'CANCELED',created_at:'2026-06-11T10:00:00Z',version:1,total_money:usd(0),total_tax_money:usd(0),total_discount_money:usd(0),total_tip_money:usd(0),total_service_charge_money:usd(0)},
 {id:'synthetic-bifocal-return',location_id:'synthetic-bifocal-location',state:'COMPLETED',created_at:'2026-06-12T10:00:00Z',total_money:usd(0),return_amounts:{total_money:usd(1250)},net_amounts:{total_money:usd(-1250)}},
 {id:'synthetic-bifocal-nonapi',location_id:'synthetic-bifocal-location',state:'OPEN',created_at:'2026-06-13T10:00:00Z',total_money:usd(2200)}
]
async function squareResponse(request,state){
 const url=new URL(request.url),body=await request.json(),phase=state.squarePhase
 assert.equal(url.pathname,'/v2/orders/search');assert.equal(url.search,'');assert.equal(request.method,'POST');assert.equal(request.headers.get('square-version'),'2026-09-16')
 assert.deepEqual(Object.keys(body).sort(),(body.cursor?['location_ids','return_entries','limit','query','cursor']:['location_ids','return_entries','limit','query']).sort())
 assert.deepEqual(body.location_ids,['synthetic-bifocal-location']);assert.equal(body.return_entries,false);assert.equal(body.limit,500)
 assert.deepEqual(body.query,{filter:{date_time_filter:{created_at:{start_at:'2026-06-01T00:00:00Z',end_at:'2026-07-01T00:00:00Z'}}},sort:{sort_field:'CREATED_AT',sort_order:'ASC'}})
 state.squareCalls.push({host:url.hostname,body})
 const page=body.cursor?Number(body.cursor.split('-').at(-1)):0
 if(page&&['401','403','429'].includes(phase))return Response.json({errors:[{category:'AUTHENTICATION_ERROR',code:'UNAUTHORIZED',detail:'synthetic-bifocal-private-diagnostic'}]},{status:Number(phase)})
 if(page&&phase==='redirect')return new Response(null,{status:302,headers:{location:'https://foreign.example.test/order'}})
 if(page&&phase==='errors')return Response.json({errors:[{category:'API_ERROR',code:'INTERNAL_SERVER_ERROR',detail:'synthetic-bifocal-private-diagnostic'}]})
 if(page&&state.squarePause)await state.squarePause()
 if(page&&phase==='missing')return Response.json({})
 if(phase==='empty')return Response.json({})
 if(phase==='rows'||phase==='pages'||phase==='bytes'||phase==='deadline'){
  if(phase==='deadline')await new Promise(resolve=>setTimeout(resolve,8000))
  const count=phase==='rows'?500:1,orders=Array.from({length:count},(_,i)=>({...squareOrders()[3],id:'synthetic-bifocal-bounded-'+page+'-'+i,...(phase==='bytes'?{metadata:{padding:'x'.repeat(800000)}}:{})}))
  return Response.json({orders,cursor:'synthetic-bifocal-cursor-'+(page+1)})
 }
 let orders=squareOrders().slice(page?2:0,page?4:2)
 if(page&&phase==='loop')orders[0].id='synthetic-bifocal-loop'
 if(page&&phase==='duplicate')orders[0]={...squareOrders()[0]}
 if(page&&phase==='conflict')orders[0]={...squareOrders()[0],version:4,total_money:usd(1)}
 if(page&&phase==='foreign')orders[0].location_id='synthetic-bifocal-other'
 if(page&&phase==='unsafe')orders[0].net_amounts.total_money.amount=Number.MAX_SAFE_INTEGER+1
 if(page&&phase==='currency')orders[0].net_amounts.total_money.currency='CAD'
 if(page&&phase==='credential')orders[0].metadata={private:'synthetic-bifocal-60'}
 if(page&&phase==='incomplete')orders=[]
 if(page&&phase==='changed')orders[1].total_money=usd(2300)
 return Response.json({orders,...(!page||phase==='loop'||phase==='incomplete'?{cursor:'synthetic-bifocal-cursor-1'}:{})})
}
