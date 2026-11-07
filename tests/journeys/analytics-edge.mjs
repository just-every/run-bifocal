import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, rm } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from 'node:net'
import {execFileSync} from 'node:child_process'
const exportFields=['artifact_id','snapshot_id','snapshot_digest','metric','dimensions_json','value','numerator','denominator','unit','state','source_json','observed_at']
/** Only Vane, Google, Smartsheet, Square and HubSpot HTTPS are faked from published
 * protocols. The emitted Worker, assets, D1 and native authorization run. */
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
  if(request.headers.get('X-Bifocal-Test-Mail')==='synthetic-bifocal-mail'&&['/auth/invite','/auth/magic-link','/auth/confirm'].includes(path)){
   const auth=createOperatorAuth({db:env.DB,clientIp:()=> '127.0.0.1',config:{dependencies:true,origin:env.AUTH_ORIGIN,local:true,OWNER_EMAIL:env.OWNER_EMAIL,SESSION_SECRET:env.SESSION_SECRET,MAIL_FROM:env.MAIL_FROM},mailSender:{async send(message){mail.push(message);return {status:'accepted',provider:'resend',providerMessageId:'synthetic-bifocal-mail'}}}});
   return createAuthHandler(auth)(request);
  }
  return worker.fetch(request,env,execution);
 }};`,resolveDir:resolve('.')},bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:*'],mainFields:['module','main'],conditions:['workerd','worker','browser']})
 const modules=[{type:'ESModule',path:resolve('dist/server/analytics-test.mjs'),contents:wrapper.outputFiles[0].text},{type:'ESModule',path:resolve('dist/server/index.js')},...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>({type:'ESModule',path:resolve('dist/server/assets',name)}))]
 const state={phase:'success',smartsheet:'success',squarePhase:'success',squareCalls:[],hubspotPhase:'success',hubspotCalls:[],calls:[],inserted:[]}
 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-analytics',host:'127.0.0.1',port,inspectorPort:0,cf:false,modulesRoot:resolve('dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(analyticsPersist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:'synthetic-bifocal-2@example.test',BIFOCAL_VANE_ORIGIN:vaneOrigin,SETUP_TOKEN:'synthetic-bifocal-1'.repeat(3)},outboundService:async request=>{
  const url=new URL(request.url);state.calls.push({host:url.hostname,path:url.pathname,method:request.method,search:url.search})
  assert.equal(url.protocol,'https:');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-60');assert.equal(request.headers.has('cookie'),false)
  assert.ok([new URL(vaneOrigin).hostname,'bigquery.googleapis.com','api.smartsheet.com','connect.squareup.com','connect.squareupsandbox.com','api.hubapi.com'].includes(url.hostname),'no arbitrary host or telemetry egress')
  if(url.hostname==='api.hubapi.com')return hubspotResponse(request,state)
  if(['connect.squareup.com','connect.squareupsandbox.com'].includes(url.hostname))return squareResponse(request,state)
  if(url.hostname==='api.smartsheet.com') {
   // Self-authored responses from the pinned Sheet, Row, Column, Cell and
   // SheetVersion schemas; only this HTTPS boundary is replaced.
   const phase=state.smartsheet
   if(state.beforeSmartsheetResponse)await state.beforeSmartsheetResponse(url)
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

// Self-authored specimens of the documented legacy CRM v3 deal-list response.
// They prove the bounded native read, never a live HubSpot authorization receipt.
const hubspotDeals=()=>[
 {id:'9007199254740993',createdAt:'2026-06-01T12:00:00.000Z',updatedAt:'2026-06-11T12:00:00.000Z',archived:false,properties:{dealname:'Synthetic pipeline A',pipeline:'default',dealstage:'qualifiedtobuy',createdate:'2026-06-01T12:00:00.000Z',hs_lastmodifieddate:'2026-06-11T12:00:00.000Z',closedate:'2026-07-31T00:00:00.000Z',amount:'123.45',deal_currency_code:'USD',private_note:'synthetic-bifocal-private-contact'}},
 {id:'9007199254740995',createdAt:'2026-06-02T12:00:00.000Z',updatedAt:'2026-06-12T12:00:00.000Z',archived:false,properties:{dealname:'',pipeline:'default',dealstage:'closedlost',amount:'-23.4',deal_currency_code:'USD',closedate:null}},
 {id:'9007199254740997',createdAt:'2026-06-03T12:00:00.000Z',updatedAt:'2026-06-13T12:00:00.000Z',archived:false,properties:{dealname:'Zero',pipeline:'default',dealstage:'qualifiedtobuy',amount:'0',deal_currency_code:'USD'}},
 {id:'9007199254740999',createdAt:'2026-06-04T12:00:00.000Z',updatedAt:'2026-06-14T12:00:00.000Z',archived:false,properties:{pipeline:'default',dealstage:'closedlost',amount:null}},
 {id:'9007199254741001',createdAt:'2026-06-05T12:00:00.000Z',updatedAt:'2026-06-15T12:00:00.000Z',archived:false,properties:{dealname:'Unknown amount',pipeline:'synthetic-bifocal-second',dealstage:'presentationscheduled',amount:'',deal_currency_code:'USD'}}
]
async function hubspotResponse(request,state){
 const url=new URL(request.url),phase=state.hubspotPhase
 assert.equal(request.method,'GET');assert.equal(url.pathname,'/crm/v3/objects/0-3');assert.equal(await request.text(),'')
 assert.deepEqual([...url.searchParams.keys()].sort(),url.searchParams.has('after')?['after','archived','limit','properties']:['archived','limit','properties'])
 assert.equal(url.searchParams.get('limit'),'100');assert.equal(url.searchParams.get('archived'),'false')
 assert.deepEqual(url.searchParams.get('properties').split(','),['dealname','pipeline','dealstage','createdate','hs_lastmodifieddate','closedate','amount','deal_currency_code'])
 const after=url.searchParams.get('after'),page=after==='NTI1Cg%3D%3D'?2:after?Number(after):0
 if(after&&!['pages','bytes','deadline','rows'].includes(phase))assert.equal(after,'NTI1Cg%3D%3D','the documented opaque cursor is encoded once as a query value, never interpreted as a URL')
 state.hubspotCalls.push({path:url.pathname,search:url.search,method:request.method})
 if(page&&['401','403','429'].includes(phase))return Response.json({message:'synthetic-bifocal-private-diagnostic'},{status:Number(phase)})
 if(page&&phase==='redirect')return new Response(null,{status:302,headers:{location:'https://foreign.example.test/deals'}})
 if(page&&state.hubspotPause)await state.hubspotPause()
 if(page&&phase==='missing')return Response.json({})
 if(phase==='empty')return Response.json({results:[]})
 if(['pages','bytes','deadline','rows'].includes(phase)){
  if(phase==='deadline')await new Promise(resolve=>setTimeout(resolve,8000))
  const results=Array.from({length:phase==='rows'?101:1},(_,i)=>({...hubspotDeals()[0],id:String(100000+page*1000+i),properties:{...hubspotDeals()[0].properties,...(phase==='bytes'?{unselected:'x'.repeat(800000)}:{})}}))
  return Response.json({results,paging:{next:{after:String(page+1)}}})
 }
 let results=hubspotDeals().slice(page?2:0,page?5:2)
 if(page&&phase==='deal-warnings')results[0].warnings=[{category:'SYNTHETIC_WARNING',message:'synthetic-bifocal-private-diagnostic',context:{}}]
 if(page&&phase==='duplicate')results[0]=hubspotDeals()[0]
 if(page&&phase==='conflict')results[0]={...hubspotDeals()[0],properties:{...hubspotDeals()[0].properties,amount:'999.00'}}
 if(page&&phase==='archived')results[0].archived=true
 if(page&&phase==='precision')results[0].properties.amount='1.234'
 if(page&&phase==='number')results[0].properties.amount=0.01
 if(page&&phase==='unsafe')results[0].properties.amount='99999999999999.99'
 if(page&&phase==='currency')results[0].properties.deal_currency_code='CAD'
 if(page&&phase==='ambiguous')delete results[0].properties.deal_currency_code
 if(page&&phase==='date')results[0].properties.closedate='2026-02-30T00:00:00.000Z'
 if(page&&phase==='credential')results[0].properties.private_note='synthetic-bifocal-60'
 if(page&&phase==='incomplete')results=[]
 if(page&&phase==='changed'){results[0].properties.amount='50.05';results[0].properties.dealstage='closedwon';results[0].updatedAt='2026-06-20T12:00:00.000Z'}
 return Response.json({results,...(!page||phase==='loop'||phase==='incomplete'?{paging:{next:{after:phase==='bad-cursor'?'invalid\ncursor':'NTI1Cg%3D%3D',link:'https://foreign.example.test/must-never-follow'}}}:phase==='empty-paging'?{paging:{}}:{}),...(page&&phase==='warnings'?{warnings:[{message:'synthetic-bifocal-private-diagnostic'}]}:{}),...(page&&phase==='errors'?{errors:[{message:'synthetic-bifocal-private-diagnostic'}]}:{})})
}
