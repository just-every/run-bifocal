import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {dump,load,JSON_SCHEMA} from 'js-yaml'


export async function proveSemanticModels() {
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
const origin=`http://127.0.0.1:${port}`,persist=await mkdtemp(join(tmpdir(),'bifocal-semantics-')),headers={Origin:origin},setup='synthetic-bifocal-1'.repeat(3)
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
 const proveScreen=async(label)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow at '+width);assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0,'No icon-only control lacks a tooltip');if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png'),fullPage:true})}}}
 await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'No source data yet'}).waitFor();await proveScreen('model-empty')
 await call('/calendars',{id:'synthetic-bifocal-july',previousVersion:null,definition:{name:'July fiscal year',kind:'fiscal',startMonth:7}})
 await call('/calendars',{id:'synthetic-bifocal-retail',previousVersion:null,definition:{name:'Retail 445',kind:'445',startMonth:2,startDay:1,weekStartsOn:0,anchor:'on-or-after'}})
 const upload=async(dataset,data,catchup=false)=>{
  const input={version:1,datasetId:dataset,filename:'synthetic-bifocal-1.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:null,formulaTreatment:'literal-text',data},bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex')
  const post=async(action,data)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers:{...headers,'X-Import-Dataset':dataset},data});assert.equal(r.status(),200,await r.text());return r.json()}
  const u=await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')})
  const p=await post('plan',{uploadId:u.uploadId,...(catchup?{catchup:true}:{})})
  for(let i=0;i<20;i++){const a=await post('apply',{planId:p.planId,reviewedFingerprint:p.fingerprint});if(a.job.state==='completed')return}
  assert.fail('Shared source apply did not complete')
 }
 const dataset='synthetic-bifocal-invoices',csv='invoice,date,region,revenue\n1,06/30/2026,West,$100.00\n2,07/01/2026,West,$10.01\n3,07/31/2026,East,$20.02\n4,08/01/2026,West,$4.00\n5,08/02/2026,East,$5.00\n6,08/15/2026,West,$30.03\n7,08/16/2026,East,$200.00\n'
 await upload(dataset,csv)
 await upload('synthetic-bifocal-tickets','ticket,invoice\nt1,2\nt2,2\n')
 await page.reload();await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor()
 await page.getByLabel('Source dataset').selectOption(dataset);await page.getByLabel('Grain columns',{exact:true}).fill('invoice');await page.getByLabel('Group columns').fill('region');await page.getByLabel('Hierarchy columns').fill('region, invoice');await page.getByLabel('Fiscal calendar',{exact:true}).selectOption(JSON.stringify({id:'synthetic-bifocal-july',version:1}));await page.getByLabel('Date column',{exact:true}).selectOption('date');await page.getByLabel('As of').fill('2026-08-15');await page.getByRole('button',{name:'Use form definition'}).click()
 await page.getByRole('status').filter({hasText:'Definition prepared'}).waitFor()
 const definition=load(await page.getByLabel('Model document').inputValue(),{schema:JSON_SCHEMA})
 const nativeYAML=dump(definition,{noRefs:true})
 // Exercise actual indented YAML, loaded through the browser's native file input.
 await page.getByLabel('Open native model YAML').setInputFiles({name:'synthetic-bifocal-1.yaml',mimeType:'application/octet-stream',buffer:Buffer.from(nativeYAML)})
 await page.getByRole('status').filter({hasText:'Native YAML loaded'}).waitFor()
 const review=await call('/model-authoring/review',{document:nativeYAML},200)
 assert.equal(review.compatible,true)
 // Independent SQLite integer-cent reference, with fixed business window bounds.
 const expected=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json
c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE invoices(day TEXT,cents INTEGER)')
c.executemany('INSERT INTO invoices VALUES(?,?)',[('2026-06-30',10000),('2026-07-01',1001),('2026-07-31',2002),('2026-08-01',400),('2026-08-02',500),('2026-08-15',3003),('2026-08-16',20000)])
print(json.dumps([c.execute('SELECT sum(cents),count(*) FROM invoices WHERE day>=? AND day<=?',(start,'2026-08-15')).fetchone() for start in ['2026-07-01','2026-08-02']]))`],{encoding:'utf8'}))
 assert.equal(review.impacts[0].answer.totals.revenue.value,(expected[0][0]/100).toFixed(2));assert.equal(review.impacts[0].answer.filteredRows,expected[0][1])
 await call('/model-authoring/create',{document:nativeYAML,reviewedDigest:'stale'},409)
 await page.getByRole('button',{name:'Review model',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('status').filter({hasText:'Review complete'}).waitFor();await proveScreen('model-review')
 await page.getByLabel('I reviewed this exact model and its source results').check()
 const [saveResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/model-authoring/create')),page.getByRole('button',{name:'Save reviewed revision'}).click()]);assert.equal(saveResponse.status(),201);const saved=await saveResponse.json()
 await page.getByRole('status').filter({hasText:'Reviewed revision saved'}).waitFor();assert.equal(await page.getByLabel('Date column',{exact:true}).inputValue(),'date');assert.equal(await page.getByLabel('As of',{exact:true}).inputValue(),'2026-08-15')
 const yamlResponse=await context.request.get(origin+'/api/operator/model-authoring/'+saved.modelId+'/'+saved.branchId+'/document');assert.equal(yamlResponse.status(),200);assert.match(await yamlResponse.text(),/slowlyChanging: reject-duplicate-grain/)
 await page.getByRole('button',{name:'Review publication'}).click();await page.getByRole('status').filter({hasText:'Publication review complete'}).waitFor();await page.getByLabel('I approve this exact revision for staging and production').check();await page.getByRole('button',{name:'Publish reviewed revision'}).click();await page.getByRole('status').filter({hasText:'Reviewed model published'}).waitFor();await proveScreen('model-published')
 await page.getByRole('button',{name:'Run published model'}).click();await page.getByRole('status').filter({hasText:'Published answers saved'}).waitFor()
 const href=await page.getByRole('link',{name:'Open revenue answer'}).getAttribute('href'),answer=await call(href.replace('/app',''))
 assert.equal(answer.answer.totals.revenue.value,'69.06');assert.equal(answer.definition.fiscal.asOf,'2026-08-15');assert.equal(answer.context.calendar.id,'synthetic-bifocal-july')
 const report=await call('/reports',{queryId:answer.queryId,title:'Fiscal revenue'});assert.deepEqual(report.answer,answer.answer)
 const dashboard=await call('/dashboards',{queryId:answer.queryId,title:'Fiscal revenue'});assert.deepEqual(dashboard.answer,answer.answer)
 const retail=structuredClone(definition);retail.views[0].query.context.calendar={id:'synthetic-bifocal-retail',version:1}
 const retailReview=await call('/model-authoring/review',{document:dump(retail)},200);assert.equal(retailReview.impacts[0].answer.totals.revenue.value,(expected[1][0]/100).toFixed(2));assert.equal(retailReview.impacts[0].answer.filteredRows,expected[1][1])
 const year=structuredClone(retail);year.views[0].query.fiscal.window='year-to-date';assert.equal((await call('/model-authoring/review',{document:dump(year)},200)).impacts[0].answer.totals.revenue.value,'169.06')
 const bad=structuredClone(definition);bad.views[0].query.joins=[{dataset:'synthetic-bifocal-tickets',as:'tickets',left:'invoice',right:'invoice',duplicates:'reject',cardinality:'many-to-one'}]
 const rejected=await call('/model-authoring/review',{document:dump(bad)},200);assert.equal(rejected.compatible,false);assert.equal(rejected.impacts[0].error,'join_fanout_refused');await call('/model-authoring/create',{document:dump(bad),reviewedDigest:rejected.digest},409)
 await page.getByLabel('Model document').fill(dump(bad));await page.getByRole('button',{name:'Review model',exact:true}).click();await page.getByRole('status').filter({hasText:'Model refused'}).waitFor();await proveScreen('model-fanout-refused')
 bad.views[0].query.joins=[];bad.views[0].query.semantic.grain=['region'];const duplicate=await call('/model-authoring/review',{document:dump(bad)},200);assert.equal(duplicate.impacts[0].error,'duplicate_model_grain')
 bad.views[0].query.semantic.grain=['invoice'];bad.views[0].query.semantic.dimensions.find(d=>d.column==='revenue').type='number';assert.equal((await call('/model-authoring/review',{document:dump(bad)},200)).impacts[0].error,'semantic_dimension_type_changed')
 // Effective-date dimension joins preserve invoice grain at both interval boundaries.
 await upload('synthetic-bifocal-history','region,tier,start,end\nWest,Prior,01/01/2026,08/01/2026\nWest,Current,08/01/2026,\nEast,East,01/01/2026,\n')
 await page.reload();await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor()
 await page.getByLabel('Source dataset',{exact:true}).selectOption(dataset);await page.getByLabel('Grain columns',{exact:true}).fill('invoice');await page.getByLabel('Group columns').fill('history.tier');await page.getByLabel('Fiscal calendar',{exact:true}).selectOption(JSON.stringify({id:'synthetic-bifocal-july',version:1}));await page.getByLabel('Date column',{exact:true}).selectOption('date');await page.getByLabel('As of',{exact:true}).fill('2026-08-15')
 await page.getByText('Add a relationship',{exact:true}).click();await page.getByLabel('Related dataset',{exact:true}).selectOption('synthetic-bifocal-history');await page.getByLabel('Relationship alias').fill('history');await page.getByLabel('Base join column',{exact:true}).selectOption('region');await page.getByLabel('Related join column',{exact:true}).selectOption('region');await page.getByLabel('History lookup date',{exact:true}).selectOption('date');await page.getByLabel('Effective start column',{exact:true}).selectOption('start');await page.getByLabel('Effective end column',{exact:true}).selectOption('end');await page.getByRole('button',{name:'Use form definition'}).click();await page.getByRole('status').filter({hasText:'Definition prepared'}).waitFor()
 const fromForm=load(await page.getByLabel('Model document').inputValue(),{schema:JSON_SCHEMA});assert.deepEqual(fromForm.views[0].query.joins,[{dataset:'synthetic-bifocal-history',as:'history',left:'region',right:'region',duplicates:'reject',cardinality:'many-to-one',effective:{asOf:'date',from:'start',to:'end'}}])
 await page.getByRole('button',{name:'Review model',exact:true}).click();await page.getByRole('status').filter({hasText:'Review complete'}).waitFor();await proveScreen('model-effective-relationship')
 const temporal=structuredClone(definition), tq=temporal.views[0].query
 tq.joins=[{dataset:'synthetic-bifocal-history',as:'history',left:'region',right:'region',duplicates:'reject',cardinality:'many-to-one',effective:{asOf:'date',from:'start',to:'end'}}];tq.groupBy=['history.tier']
 const historyReview=await call('/model-authoring/review',{document:dump(temporal)},200)
 assert.equal(historyReview.compatible,true)
 const temporalAnswer=historyReview.impacts[0].answer
 assert.equal(temporalAnswer.totals.revenue.value,'69.06');assert.equal(temporalAnswer.filteredRows,5);assert.equal(temporalAnswer.joinDiagnostics[0].unmatchedRows,0)
 assert.deepEqual(Object.fromEntries(temporalAnswer.rows.map(r=>[r.dimensions[0],r.values.revenue.value])),{Current:'34.03',East:'25.02',Prior:'10.01'})
 const temporalSnapshot=await call('/queries/run',tq);assert.deepEqual(temporalSnapshot.answer.totals,temporalAnswer.totals)
 const singular=structuredClone(temporal);singular.views[0].query.joins[0].cardinality='one-to-one';assert.equal((await call('/model-authoring/review',{document:dump(singular)},200)).impacts[0].error,'one_to_one_left_grain_violated')
 await upload('synthetic-bifocal-history','region,tier,start,end\nWest,Prior,01/01/2026,08/02/2026\nWest,Current,08/01/2026,\nEast,East,01/01/2026,\n',true)
 const overlap=await call('/model-authoring/review',{document:dump(temporal)},200);assert.equal(overlap.compatible,false);assert.equal(overlap.impacts[0].error,'overlapping_dimension_history')
 assert.equal((await call('/queries/'+temporalSnapshot.queryId+'/rerun',{},200)).reproduced,true)
 const one=structuredClone(definition);one.views[0].query.joins=[{dataset:'synthetic-bifocal-tickets',as:'tickets',left:'invoice',right:'invoice',duplicates:'reject',cardinality:'many-to-many'}];await call('/model-authoring/review',{document:dump(one)},400)
 await call('/model-authoring/review',{document:'views: &items [*items]'},400)
 await call('/model-authoring/review',{document:'!!js'+'/'+'function function() {}'},400)
 await call('/model-authoring/review',{document:'views: []\nviews: []'},400)
 assert.equal((await fetch(origin+'/api/operator/model-authoring')).status,401)
 await call('/model-authoring/review',{document:nativeYAML},401,{Origin:'https://foreign.example.test'})
 // A source replacement invalidates the old review; retained snapshots still reproduce.
 await upload(dataset,csv.replace('$10.01','$11.01'),true)
 await call('/model-authoring/create',{document:nativeYAML,reviewedDigest:review.digest},409)
 assert.equal((await call('/queries/'+answer.queryId+'/rerun',{},200)).reproduced,true)
 const edit={document:dump(retail),modelId:saved.modelId,branchId:saved.branchId,previousVersion:1}
 const edited=await call('/model-authoring/review',edit,200);const revised=await call('/model-authoring/create',{...edit,reviewedDigest:edited.digest});assert.equal(revised.version,2)
 await call('/model-authoring/create',{...edit,reviewedDigest:edited.digest},409)
 const branchPath='/models/'+saved.modelId+'/branches/'+saved.branchId
 const nextPublication=await call(branchPath+'/validate',{},200);assert.equal(nextPublication.compatible,true)
 await call(branchPath+'/promote',{environment:'staging',digest:nextPublication.digest},409)
 await call(branchPath+'/approve',{digest:nextPublication.digest},200);await call(branchPath+'/promote',{environment:'staging',digest:nextPublication.digest},200);await call(branchPath+'/promote',{environment:'production',digest:nextPublication.digest},200)
 assert.equal((await call('/models/'+saved.modelId+'/production/run',{viewId:'revenue'})).answer.totals.revenue.value,'35.03')
 assert.equal((await call('/queries/'+answer.queryId)).answer.totals.revenue.value,'69.06')
 await call('/calendars',{id:'synthetic-bifocal-retail',previousVersion:1,definition:{name:'New retail revision',kind:'445',startMonth:3,startDay:1,weekStartsOn:0,anchor:'on-or-after'}})
 await page.reload();await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor();await page.getByRole('button',{name:/Open model/}).first().click();await page.getByRole('status').filter({hasText:'Saved revision loaded'}).waitFor();assert.match(await page.getByLabel('Model document').inputValue(),/synthetic-bifocal-retail/);assert.equal(await page.getByLabel('Fiscal calendar',{exact:true}).inputValue(),JSON.stringify({id:'synthetic-bifocal-retail',version:1}));assert.equal(await page.getByLabel('Date column',{exact:true}).inputValue(),'date');assert.equal(await page.getByLabel('As of',{exact:true}).inputValue(),'2026-08-15');await proveScreen('model-reopened')
 const current=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
 await call('/models/'+saved.modelId,undefined,404);await call('/queries/'+answer.queryId,undefined,404)
 assert.equal((await context.request.get(origin+'/api/operator/model-authoring/'+saved.modelId+'/'+saved.branchId+'/document')).status(),404)
 await context.request.post(origin+'/auth/signout',{headers,form:{}});assert.equal((await context.request.get(origin+'/api/operator/model-authoring')).status(),401)
 console.log('Semantic models: native YAML authoring and revision review, exact fiscal SQL parity, fanout and grain refusals, immutable cross-door answers, current authority and source erasure passed')
 await context.close()
}finally{if(browser)await browser.close();worker.kill('SIGTERM');await new Promise(r=>worker.exitCode!==null?r():worker.once('exit',r));await rm(persist,{recursive:true,force:true})}
}
await proveSemanticModels()
