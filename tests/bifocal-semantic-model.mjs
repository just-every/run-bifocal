import {proveMigrationProjects} from './journeys/migration-projects.mjs'
import {provePortalBoundary} from './journeys/portal-tenants.mjs'
import assert from 'node:assert/strict'
import {proveMachineDoors} from './journeys/machine-doors.mjs'
import {proveCalculations} from './journeys/calculations.mjs'
import {proveModelLifecycle,proveNativePreparation} from './journeys/model-import.mjs'
import {proveExploration} from './bifocal-exploration.mjs'
import {provePivotTooling} from './journeys/pivot-tooling.mjs'
import {proveCompositionTooling} from './journeys/composition-tooling.mjs'
import {proveLargeExploration} from './journeys/large-exploration.mjs'
import {proveDashboardTv} from './journeys/dashboard-tv.mjs'
import {proveDashboardInteractions} from './journeys/dashboard-interactions.mjs'
import {proveDashboardSnapshots,proveRdlImports} from './journeys/dashboard-snapshots.mjs'
import {createHash} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {promises as filesystem} from 'node:fs'
const {mkdtemp,mkdir,rm,readFile,writeFile}=filesystem
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {dump,load,JSON_SCHEMA} from 'js-yaml'


export async function proveSemanticModels() {
if(process.env.BIFOCAL_PREPARATION_ONLY==='1'||process.env.BIFOCAL_MODEL_IMPORT_ONLY==='1')return proveNativePreparation({imports:process.env.BIFOCAL_MODEL_IMPORT_ONLY==='1'})
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
const origin=`http://127.0.0.1:${port}`,persist=await mkdtemp(join(tmpdir(),'bifocal-semantics-')),headers={Origin:origin},setup='synthetic-bifocal-1'.repeat(3)
const wrangler=['node_modules/wrangler/bin/wrangler.js'],config=['--config','dist/server/machine-boundary-wrangler.json'],env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
let output='',worker
let browser
try {
 const configuration=JSON.parse(await readFile('dist/server/wrangler.json','utf8'))
 configuration.main='machine-boundary.mjs';configuration.no_bundle=false;configuration.vars.RER_DEV_KEY='synthetic-bifocal-9'.repeat(3)
 await writeFile('dist/server/machine-boundary-wrangler.json',JSON.stringify(configuration))
 await writeFile('dist/server/machine-boundary.mjs',(await readFile('tests/journeys/machine-boundary-worker.mjs','utf8')).replace('../../dist/server/index.js','./index.js'))
 execFileSync(process.execPath,[...wrangler,'d1','migrations','apply','foundation','--local','--persist-to',persist,...config],{env,stdio:'pipe'})
 worker=spawn(process.execPath,[...wrangler,'dev','--inspector-port','0','--local','--persist-to',persist,'--ip','127.0.0.1',...config,'--port',String(port),'--var',`AUTH_ORIGIN:${origin}`,'--var','AUTH_LOCAL:true','--var','OWNER_EMAIL:synthetic-bifocal-1@example.test','--var','MAIL_FROM:synthetic-bifocal-2@example.test','--var',`SESSION_SECRET:${'synthetic-bifocal-2'.repeat(3)}`,'--var',`SETUP_TOKEN:${setup}`,'--var',`INSTALLATION_KEY:${createHash('sha256').update('synthetic-bifocal-6').digest('hex')}`],{env,stdio:['ignore','pipe','pipe']})
 worker.stdout.on('data',b=>output+=b);worker.stderr.on('data',b=>output+=b)
 for(let i=0;i<120;i++){if(worker.exitCode!==null)throw Error(output);try{if((await fetch(origin+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 assert.equal((await fetch(origin+'/health')).status,200,output)
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--use-mock-keychain','--password-store=basic','--no-sandbox']})
 const context=await browser.newContext(),page=await context.newPage()
 const call=async(path,data,expected=data===undefined?200:201,extra={})=>{const r=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers:{...headers,...extra},...(data===undefined?{}:{data})});assert.equal(r.status(),expected,await r.text());return r.json()}
 assert.equal((await context.request.post(origin+'/auth/bootstrap',{headers,data:{token:setup,displayName:'Synthetic owner',returnTo:'/app'},maxRedirects:0})).status(),303)
 await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])
 const proveScreen=async(label,{widths=[1440,390],resize=true}={})=>{for(const width of widths){if(resize)await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow at '+width);assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0,'No icon-only control lacks a tooltip');if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png'),fullPage:true})}}}
 await page.goto(origin+'/app/queries');await page.getByRole('status').filter({hasText:'Paste a definition'}).waitFor();await proveScreen('answers-exploration-navigation');await page.getByRole('link',{name:'Explore a question',exact:true}).click();await page.getByRole('status').filter({hasText:'No published models yet'}).waitFor()
 await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'No source data yet'}).waitFor();await proveScreen('model-empty')
 await page.goto(origin+'/app/questions');await page.getByRole('status').filter({hasText:'No published models yet'}).waitFor();await proveScreen('explore-no-model');await page.goto(origin+'/app/models')
 await call('/calendars',{id:'synthetic-bifocal-july',previousVersion:null,definition:{name:'July fiscal year',kind:'fiscal',startMonth:7}})
 await call('/calendars',{id:'synthetic-bifocal-retail',previousVersion:null,definition:{name:'Retail 445',kind:'445',startMonth:2,startDay:1,weekStartsOn:0,anchor:'on-or-after'}})
 const upload=async(dataset,data,catchup=false,options={})=>{
  const input={version:1,datasetId:dataset,filename:'synthetic-bifocal-1.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:null,formulaTreatment:'literal-text',data,...options},bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex')
  const post=async(action,data)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers:{...headers,'X-Import-Dataset':dataset},data});assert.equal(r.status(),200,await r.text());return r.json()}
  let u
  const chunkBytes=65536,totalChunks=Math.ceil(bytes.length/chunkBytes)
  for(let index=0;index<totalChunks;index++){const chunk=bytes.subarray(index*chunkBytes,(index+1)*chunkBytes);u=await post('uploads',{...u?{uploadId:u.uploadId}:{},name:'synthetic-bifocal-1.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks,index,chunkSha256:createHash('sha256').update(chunk).digest('hex'),base64:chunk.toString('base64')})}
  const p=await post('plan',{uploadId:u.uploadId,...(catchup?{catchup:true}:{})})
  for(let i=0;i<20;i++){const a=await post('apply',{planId:p.planId,reviewedFingerprint:p.fingerprint});if(a.job.state==='completed')return p}
  assert.fail('Shared source apply did not complete')
 }
 if(process.env.BIFOCAL_CHART_ONLY==='1'){await proveModelLifecycle({origin,context,definition:{views:[],quality:[]},upload});await context.close();return}
 if(process.env.BIFOCAL_MIGRATION_ONLY==='1'){await proveMigrationProjects({origin,context,call});await context.close();return}
 if(process.env.BIFOCAL_PORTAL_BOUNDARY_ONLY==='1'){await provePortalBoundary({origin,context});await context.close();return}
 if(process.env.BIFOCAL_RDL_ONLY==='1'){await proveRdlImports({origin,context,page,proveScreen});await context.close();return}
 if(process.env.BIFOCAL_MACHINE_ONLY==='1'){await proveMachineDoors({origin,context,page,call,upload,proveScreen});await context.close();return}
 if(process.env.BIFOCAL_DASHBOARD_ONLY==='1'){await proveDashboardInteractions({origin,context,page,upload,proveScreen});await proveDashboardSnapshots({origin,context,page,upload,proveScreen,directory:process.env.BIFOCAL_PROOF_DIR});await context.close();return}
 if(process.env.BIFOCAL_TV_ONLY==='1'){await proveDashboardTv({origin,context,page,call,upload,proveScreen});await context.close();return}
 if(process.env.BIFOCAL_LARGE_EXPORT_ONLY==='1'){await proveLargeExploration({origin,context,page,call,upload,proveScreen});await context.close();return}
 if(process.env.BIFOCAL_EXPLORATION_ONLY==='1'){await provePivotTooling({origin,context,page,call,upload,proveScreen});await proveCompositionTooling({origin,context,page,call,upload,proveScreen});await context.close();return}
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
 await proveModelLifecycle({origin,context,page,definition,proveScreen,upload})
 await proveDashboardTv({origin,context,page,call,upload,proveScreen})
 await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor()
 const report=await call('/reports',{queryId:answer.queryId,title:'Fiscal revenue'});assert.deepEqual(report.answer,answer.answer)
 const dashboard=await call('/dashboards',{queryId:answer.queryId,title:'Fiscal revenue'});assert.deepEqual(dashboard.answer,answer.answer)
 assert.equal((await call('/dashboards/'+dashboard.id+'/refresh',{maxAgeSeconds:31536000},200)).cards[0].status,'fresh')
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
 const withdrawnTv=(await call('/dashboards/'+dashboard.id+'/refresh',{maxAgeSeconds:31536000},200)).cards[0];assert.equal(withdrawnTv.status,'failed');assert.equal(withdrawnTv.error,'published_model_changed');assert.equal(withdrawnTv.withdraw,true);assert.equal(withdrawnTv.answer,undefined)
 assert.equal((await call('/queries/'+answer.queryId)).answer.totals.revenue.value,'69.06')
 await call('/calendars',{id:'synthetic-bifocal-retail',previousVersion:1,definition:{name:'New retail revision',kind:'445',startMonth:3,startDay:1,weekStartsOn:0,anchor:'on-or-after'}})
 await page.reload();await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor();await page.getByRole('button',{name:'Open model '+saved.modelId.slice(0,8)+' · revision '+revised.version+' · branch '+saved.branchId.slice(0,8),exact:true}).click();await page.getByRole('status').filter({hasText:'Saved revision loaded'}).waitFor();assert.match(await page.getByLabel('Model document').inputValue(),/synthetic-bifocal-retail/);assert.equal(await page.getByLabel('Fiscal calendar',{exact:true}).inputValue(),JSON.stringify({id:'synthetic-bifocal-retail',version:1}));assert.equal(await page.getByLabel('Date column',{exact:true}).inputValue(),'date');assert.equal(await page.getByLabel('As of',{exact:true}).inputValue(),'2026-08-15');await proveScreen('model-reopened')
 await proveExploration({origin,context,page,call,upload,proveScreen,definition})
 await provePivotTooling({origin,context,page,call,upload,proveScreen})
 await proveCompositionTooling({origin,context,page,call,upload,proveScreen})
 await proveCalculations({origin,context,page,call,upload,proveScreen})
 await proveNativePreparation({imports:true})
 await proveMigrationProjects({origin,context,call})
 await provePortalBoundary({origin,context})
 await proveMachineDoors({origin,context,page,call,upload,proveScreen})
 const current=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
 await call('/models/'+saved.modelId,undefined,404);await call('/queries/'+answer.queryId,undefined,404)
 assert.equal((await context.request.get(origin+'/api/operator/model-authoring/'+saved.modelId+'/'+saved.branchId+'/document')).status(),404)
 await context.request.post(origin+'/auth/signout',{headers,form:{}});assert.equal((await context.request.get(origin+'/api/operator/model-authoring')).status(),401);assert.equal((await context.request.get(origin+'/api/operator/explore')).status(),401);assert.equal((await context.request.post(origin+'/api/operator/explore/'+answer.queryId+'/export',{headers,data:{scope:'underlying',format:'csv'}})).status(),401)
 console.log('Semantic models: native YAML authoring and revision review, exact fiscal SQL parity, fanout and grain refusals, immutable cross-door answers, current authority and source erasure passed')
 await context.close()
}catch(error){console.error(output.split('\n').filter(line=>new RegExp('error|exception|fatal|signal|aborted|Boundary fixture','i').test(line)).join('\n'));throw error}finally{
 if(browser)await browser.close()
 worker?.kill('SIGTERM')
 if(worker)await new Promise(r=>worker.exitCode!==null||worker.signalCode!==null?r():worker.once('exit',r))
 await rm(persist,{recursive:true,force:true})
 // wrangler dev keeps its scratch (.wrangler/tmp) beside the config it runs, which here is the emitted Worker; the artifact producer refuses that folder in dist/server, so leave the build output as rer build wrote it.
 await rm('dist/server/.wrangler',{recursive:true,force:true})
 for(const file of ['dist/server/machine-boundary-wrangler.json','dist/server/machine-boundary.mjs'])await rm(file,{force:true})
}
}
await proveSemanticModels()
