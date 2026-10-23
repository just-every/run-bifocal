import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {proveScorecards} from './bifocal-scorecards.mjs'
import {proveQualityLineage} from './bifocal-quality-lineage.mjs'

export async function proveCertifiedMetrics() {
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
const origin=`http://127.0.0.1:${port}`,persist=await mkdtemp(join(tmpdir(),'bifocal-governance-')),headers={Origin:origin},setup='synthetic-bifocal-1'.repeat(3)
const wrangler=['node_modules/wrangler/bin/wrangler.js'],config=['--config','dist/server/wrangler.json'],env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
execFileSync(process.execPath,[...wrangler,'d1','migrations','apply','foundation','--local','--persist-to',persist,...config],{env,stdio:'pipe'})
let output=''
const worker=spawn(process.execPath,[...wrangler,'dev','--inspector-port','0','--local','--persist-to',persist,'--ip','127.0.0.1',...config,'--port',String(port),'--var',`AUTH_ORIGIN:${origin}`,'--var','AUTH_LOCAL:true','--var','OWNER_EMAIL:synthetic-bifocal-1@example.test','--var','MAIL_FROM:synthetic-bifocal-2@example.test','--var',`SESSION_SECRET:${'synthetic-bifocal-2'.repeat(3)}`,'--var',`SETUP_TOKEN:${setup}`,'--var',`INSTALLATION_KEY:${createHash('sha256').update('synthetic-bifocal-6').digest('hex')}`],{env,stdio:['ignore','pipe','pipe']})
worker.stdout.on('data',b=>output+=b);worker.stderr.on('data',b=>output+=b)
let browser
try {
 for(let i=0;i<120;i++){if(worker.exitCode!==null)throw Error(output);try{if((await fetch(origin+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 assert.equal((await fetch(origin+'/health')).status,200,output)
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext(),page=await context.newPage()
 const call=async(path,data,expected=data===undefined?200:201,extra={})=>{const r=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers:{...headers,...extra},...(data===undefined?{}:{data})});assert.equal(r.status(),expected,await r.text());return r.json()}
 assert.equal((await context.request.post(origin+'/auth/bootstrap',{headers,data:{token:setup,displayName:'Synthetic owner',returnTo:'/app'},maxRedirects:0})).status(),303)
 await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])
 await call('/calendars',{id:'synthetic-bifocal-calendar',previousVersion:null,definition:{name:'Calendar year',kind:'fiscal',startMonth:1}})
 const dataset='synthetic-bifocal-governance'
 const upload=async(data,catchup=false,lineage)=>{
  const input={version:1,datasetId:dataset,filename:'synthetic-bifocal-1.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:null,formulaTreatment:'literal-text',data,...(lineage?{lineage}:{})},bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex')
  const post=async(action,data)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers:{...headers,'X-Import-Dataset':dataset},data});assert.equal(r.status(),200,await r.text());return r.json()}
  const u=await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')})
  const p=await post('plan',{uploadId:u.uploadId,...(catchup?{catchup:true}:{})})
  for(let i=0;i<20;i++){const a=await post('apply',{planId:p.planId,reviewedFingerprint:p.fingerprint});if(a.job.state==='completed')return p}
  assert.fail('Shared source apply did not complete')
 }
 const today=new Date().toISOString().slice(0,10),us=today.slice(5,7)+'/'+today.slice(8,10)+'/'+today.slice(0,4)
 const good=`invoice,date,customer,revenue,state\n1,${us},c1,$10.01,active\n2,${us},c1,$20.02,active\n3,${us},c2,-$0.03,inactive\n`
 await upload(good)
 const query={version:1,dataset,joins:[],filters:[{column:'state',op:'eq',value:'active'}],groupBy:[],measures:[{id:'customers',op:'count-distinct',column:'customer',unit:'count',scale:0}],context:{modelVersion:'synthetic-bifocal-v1',metricVersion:'synthetic-bifocal-v1',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-calendar',version:1},rounding:'half-even'}}
 const definition={name:'Active customers',description:'Distinct customers with active records',grain:'customer',unit:'count',timezone:'America/New_York',accountingBasis:'accrual',query}
 const metric=await call('/metrics',{id:'synthetic-bifocal-customers',definition})
 await call('/metrics/synthetic-bifocal-customers/run',{},409)
 await call('/metrics/synthetic-bifocal-customers/approve',{revision:1,digest:'stale',confirm:'approve',annotation:'Refused'},409)
 await call('/metrics/synthetic-bifocal-customers/approve',{revision:1,digest:metric.digest,confirm:'approve',annotation:'Initial exact definition'},403,{Authorization:'Bearer synthetic-bifocal-1'})
 for(const path of ['/metrics','/goals','/quality'])assert.equal((await fetch(origin+'/api/operator'+path)).status,401)
 assert.equal((await context.request.post(origin+'/api/operator/metrics/synthetic-bifocal-customers/run',{headers:{Origin:'https://foreign.example.test'},data:{}})).status(),401)
 await page.goto(origin+'/app/metrics/synthetic-bifocal-customers');await page.getByLabel('Dated change annotation').fill('Initial human review');await page.getByLabel('I approve this exact metric definition').check();const [approved]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/metrics/synthetic-bifocal-customers/approve')&&r.request().method()==='POST'),page.getByRole('button',{name:'Certify revision 1'}).click()]);assert.equal(approved.status(),303,approved.status()===303?'':await approved.text());await page.waitForURL(origin+'/app/metrics/synthetic-bifocal-customers');assert.equal((await call('/metrics/synthetic-bifocal-customers')).metric.published_revision,1)
 const before=await call('/metrics/synthetic-bifocal-customers/run',{}),report=await call('/reports',{queryId:before.queryId,title:'Original customer report'}),dashboard=await call('/dashboards',{queryId:before.queryId,title:'Customer dashboard'})
 assert.equal(before.answer.totals.customers.value,'1');assert.equal(before.context.metric.revision,1)
 const next=structuredClone(definition);next.query.filters=[]
 const proposed=await call('/metrics/synthetic-bifocal-customers/propose',{previousRevision:1,definition:next})
 const impact=await call('/metrics/synthetic-bifocal-customers/impact');assert.equal(impact.impact.before.value,'1');assert.equal(impact.impact.after.value,'2');assert.ok(impact.impact.dependencies.some(x=>x.artifact_id===report.id));assert.ok(impact.impact.dependencies.some(x=>x.artifact_id===dashboard.id))
 assert.equal((await call('/metrics/synthetic-bifocal-customers/run',{})).context.metric.revision,1)
 await call('/metrics/synthetic-bifocal-customers/propose',{previousRevision:1,definition},409)
 await call('/metrics/synthetic-bifocal-customers/approve',{revision:1,digest:metric.digest,confirm:'approve',annotation:'Stale'},409)
 await call('/metrics/synthetic-bifocal-customers/approve',{revision:2,digest:proposed.digest,confirm:'approve',annotation:'Include all customer records'},200)
 const after=await call('/metrics/synthetic-bifocal-customers/run',{});assert.equal(after.answer.totals.customers.value,'2');assert.equal(after.context.metric.revision,2)
 const old=await call('/reports/'+report.id);assert.deepEqual(old.answer,before.answer);assert.equal(old.context.metric.revision,1)
 assert.equal((await call('/queries/'+before.queryId+'/rerun',{},200)).reproduced,true)
 const history=await call('/metrics/synthetic-bifocal-customers');assert.equal(history.revisions.length,2);assert.ok(history.revisions.every(r=>r.approved_at&&r.annotation))
 const proveScreen=async(path,label)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+path);await page.locator('h1').waitFor();if(/^\/app\/(queries|reports|dashboards)\//.test(path))await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow at '+width);const icons=await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length);assert.equal(icons,0,'Touched screens contain no icon-only buttons');if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png'),fullPage:true})}}}
 await proveScreen('/app/metrics','metrics');await proveScreen('/app/metrics/synthetic-bifocal-customers','metric-history')
 const revenue=structuredClone(definition);revenue.name='USD revenue';revenue.unit='money';revenue.grain='invoice';revenue.query.filters=[];revenue.query.measures=[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'}]
 const rev=await call('/metrics',{id:'synthetic-bifocal-revenue',definition:revenue});await call('/metrics/synthetic-bifocal-revenue/approve',{revision:1,digest:rev.digest,confirm:'approve',annotation:'Revenue owner review'},200)
 const tools={origin,context,page,call,upload,dataset,good,us,today,proveScreen,report,dashboard}
 await proveScorecards(tools)
 await proveQualityLineage(tools)
 // Full source erasure removes definitions and quality derivatives while keeping human targets.
 const current=await call('/datasets/'+dataset)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
 await call('/metrics/synthetic-bifocal-customers',undefined,404);await call('/reports/'+report.id,undefined,404)
 assert.equal((await call('/quality')).rules.length,0)
 const unknown=await call('/goals/synthetic-bifocal-revenue-goal');assert.equal(unknown.actual.state,'unknown');assert.equal(unknown.actual.forecast,null);assert.equal(unknown.versions.length,2);assert.equal(unknown.checkins.length,1)
 await proveScreen('/app/goals/synthetic-bifocal-revenue-goal','goal-unknown')
 await context.request.post(origin+'/auth/signout',{headers,form:{}})
 assert.equal((await context.request.get(origin+'/api/operator/quality')).status(),401)
 assert.equal((await context.request.get(origin+'/api/operator/goals')).status(),401)
 console.log('Certified metrics: exact revisions, owner approval, paired dependency impact, immutable reports, authorization and erasure passed')
 await context.close()
}finally{if(browser)await browser.close();worker.kill('SIGTERM');await new Promise(r=>worker.exitCode!==null?r():worker.once('exit',r));await rm(persist,{recursive:true,force:true})}

}
await proveCertifiedMetrics()
