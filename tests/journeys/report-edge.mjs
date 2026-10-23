import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { importDataset } from './content-governance.mjs'
import { proveReportCustody } from './report-custody.mjs'

/** Real emitted Worker, D1 and HTTPS native auth. Only SendGrid's fixed Mail
 * Send v3 HTTPS boundary is faked from the official schema cited in transport. */
export async function proveReportProvider(persist){
 const directory=join(persist,'report-provider'),socket=createServer()
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',directory,'--config','dist/server/wrangler.json'],{stdio:'pipe',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
 const require=createRequire(import.meta.url),wrangler=createRequire(require.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=wrangler('miniflare')
 const origin='https://127.0.0.1:'+port,state={messages:[],calls:[]}
 const modules=[{type:'ESModule',path:resolve('dist/server/index.js')},...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>({type:'ESModule',path:resolve('dist/server/assets',name)}))]
 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-report-provider',host:'127.0.0.1',port,https:true,inspectorPort:0,cf:false,modulesRoot:resolve('dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(directory,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'false',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),SETUP_TOKEN:'synthetic-bifocal-3'.repeat(3),MAIL_PROVIDER:'sendgrid',MAIL_FROM:'synthetic-bifocal-2@example.test',MAIL_API_KEY:'synthetic-bifocal-92'},outboundService:async request=>{
  const url=new URL(request.url);state.calls.push({host:url.hostname,path:url.pathname,method:request.method})
  assert.equal(url.origin,'https://api.sendgrid.com');assert.equal(url.pathname,'/v3/mail/send');assert.equal(request.method,'POST')
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-92');assert.equal(request.headers.has('cookie'),false)
  const body=await request.json()
  assert.deepEqual(body.personalizations[0].to,[{email:'synthetic-bifocal-1@example.test'}]);assert.equal(body.from.email,'synthetic-bifocal-2@example.test')
  assert.equal(body.attachments.length,1);assert.equal(body.attachments[0].type,'application/json');assert.equal(body.attachments[0].disposition,'attachment')
  const artifact=JSON.parse(Buffer.from(body.attachments[0].content,'base64').toString())
  assert.ok(artifact.runId&&artifact.sourceCutoffs.length&&artifact.definitionVersions.metrics.revision)
  state.messages.push(body)
  return new Response(null,{status:202,headers:{'x-message-id':'synthetic-bifocal-'+state.messages.length}})
 }}))
 let browser
 try{
  await mf.ready
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  const owner=await browser.newContext({ignoreHTTPSErrors:true}),page=await owner.newPage()
  const bootstrap=await owner.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:'synthetic-bifocal-3'.repeat(3),displayName:'Synthetic report owner',returnTo:'/app'},maxRedirects:0})
  assert.equal(bootstrap.status(),303,await bootstrap.text())
  await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])
  const fixtures=await importDataset(origin,owner)
  const reports=await proveReportCustody(origin,owner,null,fixtures,page,'accepted',state)
  const stagedModel=await proveProductionStaging(origin,owner,fixtures,state)
  const receipt=await owner.request.post(origin+'/api/operator/datasets/'+fixtures.dataset+'/erase',{headers:{Origin:origin},data:{confirmDataset:fixtures.dataset,reviewedRevision:fixtures.revision}})
  assert.equal(receipt.status(),200,await receipt.text());assert.ok((await receipt.json()).stores.some(store=>store.store==='bf_report_controlled_artifacts'&&store.rows===4))
  await reports.erased();assert.equal(state.messages.length,2)
  assert.equal((await owner.request.get(origin+'/api/operator/models/'+stagedModel)).status(),404)
  await owner.close()
 }finally{await browser?.close();await mf.dispose()}
}

async function proveProductionStaging(origin,owner,fixtures,state){
 const call=async(path,data,status=200)=>{const response=await owner.request.post(origin+'/api/operator/models'+path,{headers:{Origin:origin},data});assert.equal(response.status(),status,await response.text());return response.json()}
 const sourceBefore=await(await owner.request.get(origin+'/api/operator/datasets/'+fixtures.dataset)).json(),callsBefore=state.calls.length
 const query={version:1,dataset:fixtures.dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'}],context:{modelVersion:'synthetic-bifocal-946',metricVersion:'synthetic-bifocal-947',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-report-year',version:1},rounding:'half-even'}}
 const model=await call('',{definition:{views:[{id:'review',kind:'report',query,rowRules:[]}],quality:[{view:'review',measure:'revenue',expected:'999.00'}]}},201)
 const branch='/'+model.modelId+'/branches/'+model.branchId
 const preview=await call(branch+'/validate',{});assert.equal(preview.compatible,true)
 await call(branch+'/approve',{digest:preview.digest})
 await call(branch+'/promote',{environment:'staging',digest:preview.digest})
 const answer=await call('/'+model.modelId+'/staging/run',{viewId:'review'},201)
 assert.equal(answer.answer.totals.revenue.value,'999.00')
 assert.deepEqual(await(await owner.request.get(origin+'/api/operator/datasets/'+fixtures.dataset)).json(),sourceBefore)
 assert.equal(state.calls.length,callsBefore,'staging preview and execution make no production outbound request in production mode')
 console.log('Semantic staging: production HTTPS native session, real query/quality preview and stage execution, unchanged source records and zero observed outbound requests passed')
 return model.modelId
}
