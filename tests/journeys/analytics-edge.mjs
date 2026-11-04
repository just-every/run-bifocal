import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, rm } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from 'node:net'
import {execFileSync} from 'node:child_process'
const exportFields=['artifact_id','snapshot_id','snapshot_digest','metric','dimensions_json','value','numerator','denominator','unit','state','source_json','observed_at']
/** Only documented provider HTTPS are faked from the pinned published protocols in
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
 const state={phase:'success',calls:[],inserted:[],jira:'success'}
 // Self-authored responses follow the Jira REST v3 schema and documented OAuth
 // gateway. They establish native behavior, never a live provider grant.
 const cloudId='11223344-a1b2-3b33-c444-def123456789',siteUrl='https://synthetic-bifocal.atlassian.net'
 const issue=(id,key,typeId,type,statusId,status,resolved)=>({id,key,self:siteUrl+'/rest/api/3/issue/'+id,fields:{project:{id:'10000',key:'BIF',name:'Synthetic work'},issuetype:{id:typeId,name:type},status:{id:statusId,name:status},created:'2026-06-01T09:00:00.000+0000',updated:'2026-06-30T18:00:00.000+0000',resolutiondate:resolved}})
 const issues=[issue('10101','BIF-11','1','Task','3','Done','2026-06-30T17:00:00.000+0000'),issue('10102','BIF-12','2','Bug','1','Open',null),issue('10103','BIF-13','1','Task','2','In progress',null),issue('10104','BIF-14','2','Bug','3','Done','2026-06-29T17:00:00.000+0000')]

 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-analytics',host:'127.0.0.1',port,inspectorPort:0,cf:false,modulesRoot:resolve('dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(analyticsPersist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:'synthetic-bifocal-2@example.test',BIFOCAL_VANE_ORIGIN:vaneOrigin,SETUP_TOKEN:'synthetic-bifocal-1'.repeat(3)},outboundService:async request=>{
  const url=new URL(request.url);state.calls.push({host:url.hostname,path:url.pathname,method:request.method,query:url.search})
  assert.equal(url.protocol,'https:');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-60');assert.equal(request.headers.has('cookie'),false)
  assert.ok([new URL(vaneOrigin).hostname,'bigquery.googleapis.com','api.atlassian.com'].includes(url.hostname),'no arbitrary host or telemetry egress')
  if(url.hostname==='api.atlassian.com') {
   assert.equal(request.method,'GET');assert.equal(request.headers.get('cookie'),null)
   if(state.jira==='revoked'||state.jira==='expired')return Response.json({error:'synthetic-bifocal-refused'},{status:state.jira==='expired'?401:403})
   if(state.jira==='rate')return Response.json({error:'synthetic-bifocal-rate'},{status:429})
   if(state.jira==='redirect')return new Response(null,{status:302,headers:{location:'https://foreign.example.test/private'}})
   if(url.pathname==='/oauth/token/accessible-resources')return Response.json([{id:cloudId,url:siteUrl,name:'Discarded site name',avatarUrl:'https://foreign.example.test/avatar',scopes:state.jira==='scope'?['read:jira-user']:['read:jira-work']},{id:'21223344-a1b2-3b33-c444-def123456789',url:'https://other-synthetic-bifocal.atlassian.net',scopes:['read:confluence-content.all']}])
   assert.equal(url.pathname,`/ex/jira/${cloudId}/rest/api/3/search/jql`)
   assert.deepEqual([...url.searchParams.keys()].sort(),['failFast','fields','jql','maxResults',...(url.searchParams.has('nextPageToken')?['nextPageToken']:[])].sort())
   assert.equal(url.searchParams.get('jql'),'project = 10000 ORDER BY id ASC')
   assert.equal(url.searchParams.get('fields'),'project,issuetype,status,created,updated,resolutiondate');assert.equal(url.searchParams.get('maxResults'),'100');assert.equal(url.searchParams.get('failFast'),'true')
   const next=url.searchParams.get('nextPageToken')
   assert.ok(next===null||next==='synthetic-bifocal-next'||state.jira==='overflow'&&/^synthetic-bifocal-page-/.test(next))
   if(next&&state.jira==='expired-page')return Response.json({error:'synthetic-bifocal-expired'},{status:401})
   if(state.jira==='empty')return Response.json({isLast:true,issues:[]})
   if(state.jira==='overflow') {
    const page=next?Number(next.split('-').at(-1)):0
    return Response.json({isLast:false,nextPageToken:'synthetic-bifocal-page-'+(page+1),issues:[issue(String(20000+page),'BIF-'+(100+page),'1','Task','1','Open',null)]})
   }
   if(!next&&state.onJiraPage){const act=state.onJiraPage;state.onJiraPage=null;await act()}
   const selected=structuredClone(next?issues.slice(2):issues.slice(0,2))
   if(state.jira==='marker')selected[0].fields.status.name='__BIFOCAL_NULL__'
   if(state.jira==='nulls') {selected[0].fields.created=null;selected[0].fields.updated=null;selected[0].fields.resolutiondate=null}
   if(state.jira==='changed')selected[0].fields.status={id:'1',name:'Open'}
   if(state.jira==='foreign-project')selected[0].fields.project.id='20000'
   if(state.jira==='foreign-key')selected[0].key='FOREIGN-11'
   if(state.jira==='foreign-self')selected[0].self='https://foreign.example.test/rest/api/3/issue/10101'
   if(state.jira==='sensitive')selected[0].fields.description='synthetic-bifocal-private-description'
   if(state.jira==='people')selected[0].fields.assignee={displayName:'synthetic-bifocal-private-person'}
   if(state.jira==='custom')selected[0].fields.customfield_10001='synthetic-bifocal-private-custom'
   if(state.jira==='echo')selected[0].fields.status.name='synthetic-bifocal-60'
   if(state.jira==='duplicate'&&next)selected[0]=structuredClone(issues[0])
   if(state.jira==='missing-field')delete selected[0].fields.updated
   const data={isLast:!!next,issues:selected,...(!next?{nextPageToken:'synthetic-bifocal-next'}:{})}
   if(state.jira==='warnings')data.warnings=[{type:'synthetic-bifocal-truncated',message:'synthetic-bifocal-private-warning'}]
   if(state.jira==='truncated')delete data.isLast
   if(state.jira==='cursor') {data.isLast=false;data.nextPageToken='synthetic-bifocal-next'}
   if(state.jira==='last-cursor')data.nextPageToken='synthetic-bifocal-next'
   return Response.json(data)
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
 return {origin,vaneOrigin,state,cloudId,siteUrl,database:()=>mf.getD1Database('DB'),close:()=>mf.dispose()}
}
