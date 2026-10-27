import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {dump,load,JSON_SCHEMA} from 'js-yaml'
import {unzipSync,strFromU8,zipSync,strToU8} from 'fflate'
import {proveDBTPredicates} from './dbt-predicate-import.mjs'
import {modelProjectFixtures,proveDBTExecution} from './model-project-fixtures.mjs'
import {proveMetricTooling} from './metric-tooling.mjs'
import {proveChartTooling} from './chart-tooling.mjs'
import {provePolicyTooling} from './policy-tooling.mjs'
import {proveBoardTooling} from './board-tooling.mjs'
import {proveRecurringTooling} from './recurring-tooling.mjs'
import {proveEnvironmentTooling} from './environment-tooling.mjs'

export async function proveModelImports({origin,context,page,call,upload,proveScreen,signInMember}){
 const dataset='synthetic-bifocal-model-imports',csv='invoice,region,revenue,internal-note\n1,West,$10.01,Restricted source detail\n2,East,$20.02,Other source detail\n3,West,-$0.03,Return detail\n4,East,,Missing revenue detail\n'
 await upload(dataset,csv)
 const expected=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json
c=sqlite3.connect(':memory:');c.execute('CREATE TABLE invoices(invoice INTEGER,region TEXT,cents INTEGER)')
c.executemany('INSERT INTO invoices VALUES(?,?,?)',[(1,'West',1001),(2,'East',2002),(3,'West',-3),(4,None,None)])
print(json.dumps({'all':c.execute('SELECT sum(cents),count(distinct region) FROM invoices').fetchone(),'west':c.execute("SELECT sum(cents),count(distinct region) FROM invoices WHERE region='West'").fetchone()}))`],{encoding:'utf8'}))
 const projects=modelProjectFixtures(dataset,'synthetic-bifocal-july'),saved=[]
 projects[0].files[0].content='# connection password: synthetic-bifocal-private-source\n'+projects[0].files[0].content
 const post=async(id,action,data,expected=200)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers:{Origin:origin,'X-Import-Kind':'model','X-Import-Dataset':id},data});assert.equal(r.status(),expected,await r.text());return r.json()}
 const prepare=async(input,catchup=false)=>{const bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex'),u=await post(input.projectId,'uploads',{name:'synthetic-bifocal-project.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')});return post(input.projectId,'plan',{uploadId:u.uploadId,...(catchup?{catchup:true}:{})})}
 const apply=async(id,plan)=>{await post(id,'apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},403);for(let i=0;i<20;i++){const a=await post(id,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(a.job.state==='completed'){const r=await post(id,'reconcile',{planId:plan.planId});assert.equal(r.ok,true);return}}assert.fail('Project import did not complete')}
 for(const input of projects){
  const plan=await prepare(input)
  assert.equal(plan.counts.rejected,0,JSON.stringify(plan));assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report));assert.deepEqual(plan.project.report.issues,[]);assert.ok(plan.project.definition.views.every(v=>v.query.semantic.dimensions.every(d=>d.column!=='internal-note')))
  await apply(input.projectId,plan)
  const originalFiles=await context.request.get(origin+'/api/operator/import/original/'+plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':input.projectId}});assert.equal(originalFiles.status(),200,await originalFiles.text());const originals=(await originalFiles.json()).originals;assert.equal(originals[0].original.status,'retained');assert.deepEqual(JSON.parse(Buffer.from(originals[0].original.base64,'base64').toString()).files,input.files)
  const imported=await call('/model-imports/'+input.projectId),native=dump(imported.definition),body={document:native,importProject:input.projectId,importRevision:imported.revision}
  assert.deepEqual(imported.input.files,input.files)
  const exported=await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:imported.revision},200)
  assert.deepEqual(exported.definition,imported.definition)
  assert.deepEqual(exported.sources.map(s=>[s.table,s.dataset,s.revision,s.grain]),[[input.format==='tmdl'?'Sales':'sales',dataset,(await call('/datasets/'+dataset)).revision,['invoice']]])
  assert.deepEqual(exported.sources.map(s=>s.file),[input.files[0].path])
  assert.deepEqual(exported.sources[0].columns,input.format==='tmdl'?[{source:'Invoice',column:'invoice'},{source:'Revenue',column:'revenue'},{source:'Region',column:'region'}]:['lookml','metabase','tableau'].includes(input.format)?[{source:'invoice',column:'invoice'},{source:'region',column:'region'},{source:'revenue',column:'revenue'}]:[{source:'invoice',column:'invoice'},{source:'region',column:'region'}])
  assert.deepEqual(exported.measures.map(m=>m.measure).sort(),input.format==='tmdl'?['revenuesum']:['revenue-sum','unique-regions'])
  assert.ok(!JSON.stringify(exported).includes('synthetic-bifocal-private-source'))
  assert.equal(exported.input,undefined);assert.equal(exported.ownerId,undefined)
  const reopened=await call('/model-authoring/review',{document:dump(exported.definition),importProject:input.projectId,importRevision:exported.project.revision},200)
  assert.equal(reopened.compatible,true);assert.equal(reopened.impacts[0].answer.totals[input.format==='tmdl'?'revenuesum':'revenue-sum'].value,'30.00')
  await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:'synthetic-bifocal-stale'},409)
  assert.deepEqual(load((await call('/model-authoring/format',body,200)).document,{schema:JSON_SCHEMA}),imported.definition)
  const review=await call('/model-authoring/review',body,200);assert.equal(review.compatible,true,JSON.stringify(review));assert.equal(review.imported.format,input.format)
  const measure=input.format==='tmdl'?'revenuesum':'revenue-sum',value=review.impacts[0].answer.totals[measure]
  assert.equal(value.value,(expected.all[0]/100).toFixed(2));if(input.format!=='tmdl')assert.equal(review.impacts[0].answer.totals['unique-regions'].value,String(expected.all[1]))
  const model=await call('/model-authoring/create',{...body,reviewedDigest:review.digest}),path='/models/'+model.modelId+'/branches/'+model.branchId
  const publication=await call(path+'/validate',{},200);await call(path+'/approve',{digest:publication.digest},200);await call(path+'/promote',{environment:'staging',digest:publication.digest},200);await call(path+'/promote',{environment:'production',digest:publication.digest},200)
  const answer=await call('/models/'+model.modelId+'/production/run',{viewId:'sales'})
  assert.equal(answer.answer.totals[measure].value,value.value);assert.equal(answer.context.modelImport.projectId,input.projectId);assert.equal(answer.context.modelImport.revision,imported.revision)
  const report=await call('/reports',{queryId:answer.queryId,title:input.format+' source revenue'}),dashboard=await call('/dashboards',{queryId:answer.queryId,title:input.format+' source revenue'})
  assert.deepEqual(report.answer,answer.answer);assert.deepEqual(dashboard.context.modelImport,answer.context.modelImport)
  const question=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['region'],filters:[{column:'region',op:'eq',value:'West'}]})
  assert.equal(question.answer.totals[measure].value,(expected.west[0]/100).toFixed(2));assert.equal(question.context.modelImport.digest,imported.digest)
  await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['internal-note'],filters:[]},403)
  const empty=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:[],filters:[{column:'region',op:'eq',value:'Absent'}]})
  assert.equal(empty.answer.totals[measure].value,input.format==='lookml'?'0.00':null)
  for(const format of ['csv','xlsx']){const exported=await context.request.post(origin+'/api/operator/explore/'+question.queryId+'/export',{headers:{Origin:origin},data:{scope:'summary',format}});assert.equal(exported.status(),200);if(format==='csv')assert.match(await exported.text(),/9\.98/);else{const zip=unzipSync(await exported.body()),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);assert.match(sheet,/<v>9\.98<\/v>/)}}
  saved.push({input,plan,imported,model,answer,report,question})
  if(['metabase','tableau'].includes(input.format)){
   await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor()
   assert.equal(await page.getByLabel('Model format',{exact:true}).inputValue(),input.format);assert.deepEqual(JSON.parse(await page.getByLabel('Source bindings (JSON)',{exact:true}).inputValue()),input.bindings);assert.match(await page.getByRole('table',{name:'Source measure translations'}).innerText(),/sales.revenue_sum/);assert.equal(await page.getByRole('button',{name:'Export rebuilt model',exact:true}).count(),1);await proveScreen('model-import-'+input.format)
  }
 }
 // Source query predicates and grouping survive exact mappings and exported
 // native execution. Later exploration can only intersect these restrictions.
 const scopedDataset='synthetic-bifocal-metabase-scoped'
 await upload(scopedDataset,csv.replace('region,revenue','territory,amount'))
 for(const serialization of ['json','yaml']){
  const input=structuredClone(projects.find(p=>p.format==='metabase'));input.projectId='synthetic-bifocal-metabase-scoped-'+serialization
  input.bindings.sales={dataset:scopedDataset,grain:['invoice'],columns:{region:'territory',revenue:'amount'}}
  input.formats['sales.row_count']={unit:'count',scale:0};input.formats['sales.present_count']={unit:'count',scale:0}
  const card=JSON.parse(input.files[0].content),field=id=>['field',id,null]
  card.dataset_query.query={...card.dataset_query.query,filter:['and',['=',field(2),'West'],['between',field(3),0,20]],breakout:[field(2)],aggregation:[...card.dataset_query.query.aggregation,['count'],['count',field(3)]]}
  card.result_metadata=[{name:'region',source:'breakout',base_type:'type'+'/'+'Text'},...card.result_metadata,{name:'row_count',base_type:'type'+'/'+'Integer'},{name:'present_count',base_type:'type'+'/'+'Integer'}]
  for(const [index,output] of card.result_metadata.entries())if(index){output.source='aggregation';output.field_ref=['aggregation',index-1]}
  input.files[0].content=JSON.stringify(card)
  if(serialization==='yaml')input.files=input.files.map((f,index)=>({path:f.path.replace('.json','.yaml'),content:dump({...JSON.parse(f.content),[['serdes','meta'].join('/')]:[{model:['Card','Table','Database'][index],id:String([37,12,9][index])}]})}))
  const plan=await prepare(input);assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report.issues))
  assert.deepEqual(plan.project.definition.views[0].query.filters,[{column:'territory',op:'eq',value:'West'},{column:'amount',op:'gte',value:'0'},{column:'amount',op:'lte',value:'20'}]);assert.deepEqual(plan.project.definition.views[0].query.groupBy,['territory'])
  await apply(input.projectId,plan);const imported=await call('/model-imports/'+input.projectId),exported=await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:imported.revision},200)
  assert.deepEqual(exported.sources[0].columns,[{source:'invoice',column:'invoice'},{source:'region',column:'territory'},{source:'revenue',column:'amount'}]);assert.deepEqual(exported.definition,imported.definition)
  const body={document:dump(exported.definition),importProject:input.projectId,importRevision:imported.revision},review=await call('/model-authoring/review',body,200)
  assert.equal(review.compatible,true);const actual=review.impacts[0].answer
  assert.equal(actual.filteredRows,1);assert.deepEqual(actual.rows.map(r=>[r.dimensions,r.values['revenue-sum'].value,r.values['unique-regions'].value,r.values['row-count'].value,r.values['present-count'].value]),[[['West'],'10.01','1','1','1']])
  const model=await call('/model-authoring/create',{...body,reviewedDigest:review.digest}),path='/models/'+model.modelId+'/branches/'+model.branchId,publication=await call(path+'/validate',{},200)
  await call(path+'/approve',{digest:publication.digest},200);await call(path+'/promote',{environment:'staging',digest:publication.digest},200);await call(path+'/promote',{environment:'production',digest:publication.digest},200)
  const broad=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['territory'],filters:[]})
  assert.deepEqual(broad.answer.rows,actual.rows);assert.equal(broad.answer.totals['revenue-sum'].value,'10.01')
  const east=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['territory'],filters:[{column:'territory',op:'eq',value:'East'}]})
  assert.deepEqual(east.answer.rows,[]);assert.equal(east.answer.totals['revenue-sum'].value,null);assert.equal(east.answer.totals['row-count'].value,'0')
  const r=await context.request.post(origin+'/api/operator/explore/'+broad.queryId+'/export',{headers:{Origin:origin},data:{scope:'summary',format:'csv'}});assert.equal(r.status(),200);assert.match(await r.text(),/10\.01/)
  await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.equal(await page.getByRole('button',{name:'Export rebuilt model',exact:true}).count(),1);await proveScreen('metabase-scoped-'+serialization)
 }
 const scopedCurrent=await call('/datasets/'+scopedDataset);await call('/datasets/'+scopedDataset+'/erase',{confirmDataset:scopedDataset,reviewedRevision:scopedCurrent.revision},200)
 for(const serialization of ['json','yaml'])await call('/model-imports/synthetic-bifocal-metabase-scoped-'+serialization,undefined,404)
 // Native dbt projects retain tests and dependency lineage without pretending
 // that storing SQL is an executable transformation or a passing quality test.
 const dbtProjects=[]
 const dbtEnvelope=(id,files)=>({...structuredClone(projects[1]),projectId:id,files})
 const raw=dbtEnvelope('synthetic-bifocal-dbt-core',[
  {path:'dbt_project.yml',content:'name: synthetic_bifocal\nversion: 1.0.0\nconfig-version: 2\n'},
  {path:'models/schema.yml',content:'version: 2\nmodels:\n  - name: sales\n    columns:\n      - name: invoice\n        tests: [not_null, unique]\nsources:\n  - name: raw\n    tables:\n      - name: invoices\n'},
  {path:'models/sales.sql',content:"select invoice, region, revenue from {{ source('raw', 'invoices') }}"}
 ])
 const manifest={metadata:{dbt_schema_version:'https://schemas.getdbt.com/dbt/manifest/v12.json'},nodes:{
  'model.synthetic_bifocal.sales':{unique_id:'model.synthetic_bifocal.sales',name:'sales',resource_type:'model',original_file_path:'models/sales.sql',raw_code:"select * from {{ source('raw', 'invoices') }}",columns:{invoice:{name:'invoice',data_type:'integer'}},depends_on:{nodes:['source.synthetic_bifocal.raw.invoices']}},
  'test.synthetic_bifocal.invoice_unique':{unique_id:'test.synthetic_bifocal.invoice_unique',name:'invoice_unique',resource_type:'test',test_metadata:{name:'unique',kwargs:{column_name:'invoice'}},depends_on:{nodes:['model.synthetic_bifocal.sales']}}
 },sources:{'source.synthetic_bifocal.raw.invoices':{unique_id:'source.synthetic_bifocal.raw.invoices',name:'invoices',resource_type:'source',identifier:'invoices'}},macros:{}}
 const cloud=dbtEnvelope('synthetic-bifocal-dbt-cloud',[{path:'target/manifest.json',content:JSON.stringify(manifest)}])
 for(const input of [raw,cloud]){
  const plan=await prepare(input);assert.equal(plan.counts.rejected,0);assert.equal(plan.project.report.compatible,false);assert.equal(plan.project.definition,null)
  const inventory=plan.project.report.project.resources
  assert.deepEqual(inventory.map(r=>r.id).sort(),input===raw?['model.sales','project','source.raw.invoices','test.sales.invoice.tests.0','test.sales.invoice.tests.1']:['model.synthetic_bifocal.sales','source.synthetic_bifocal.raw.invoices','test.synthetic_bifocal.invoice_unique'])
  const model=inventory.find(r=>r.kind==='model');assert.deepEqual(model.dependencies,input===raw?['source.raw.invoices']:['source.synthetic_bifocal.raw.invoices']);assert.equal(model.file,input===raw?'models/sales.sql':'target/manifest.json')
  assert.deepEqual(inventory.filter(r=>r.kind==='test').map(r=>r.dependencies),input===raw?[['model.sales'],['model.sales']]:[['model.synthetic_bifocal.sales']])
  assert.deepEqual(input===raw?model.definition.schema.columns[0].tests:inventory.find(r=>r.kind==='test').definition.test_metadata,input===raw?['not_null','unique']:{name:'unique',kwargs:{column_name:'invoice'}})
  if(input===raw){assert.equal(model.definition.translation.state,'translated');assert.deepEqual(model.definition.translation.bindings[0].columns,{invoice:'invoice',region:'region',revenue:'revenue'});assert.deepEqual(inventory.filter(r=>r.kind==='test').map(r=>[r.definition.translation.test,r.definition.translation.results[0].failures]),[['not_null',0],['unique',0]]);assert.ok(plan.project.report.issues.some(i=>i.code==='no_supported_measures'))}
  else assert.ok(plan.project.report.issues.some(i=>i.code==='dbt_resource_execution_pending'&&i.object===model.id))
  assert.deepEqual(plan.project.sources.map(s=>s.id),[dataset])
  await apply(input.projectId,plan)
  const imported=await call('/model-imports/'+input.projectId);assert.deepEqual(imported.report.project.resources,inventory);assert.deepEqual(imported.input.files,input.files)
  await call('/model-authoring/review',{document:dump(saved[0].imported.definition),importProject:input.projectId,importRevision:imported.revision},409)
  const edited=structuredClone(input);edited.files[0].content+='\n';const replacement=await prepare(edited,true);await apply(input.projectId,replacement)
  const revised=await call('/model-imports/'+input.projectId);assert.notEqual(revised.revision,imported.revision);assert.deepEqual(revised.report.project.resources.map(r=>r.dependencies),inventory.map(r=>r.dependencies))
  await post(input.projectId,'undo',{planId:replacement.planId});assert.equal((await call('/model-imports/'+input.projectId)).revision,imported.revision)
  dbtProjects.push({input,plan})
 }
 // SQL projection lineage and generic checks are interpreted over reviewed
 // records. No original SQL or template is sent to a database or executed.
 const core=structuredClone(raw);core.projectId='synthetic-bifocal-dbt-projection'
 core.files[1].content+='\n'+projects[1].files[0].content.replace("ref('invoices')","ref('sales')").replace('expr: revenue','expr: net')
 core.files[2].content="select invoice, region, revenue as net from {{ ref('staging') }}"
 core.files.push({path:'models/staging.sql',content:"select invoice, region, revenue from {{ source('raw','invoices') }}"})
 core.bindings.sales.columns={net:'revenue'}
 const resolvedManifest={metadata:manifest.metadata,nodes:{},sources:{'source.synthetic_bifocal.raw.invoices':{...manifest.sources['source.synthetic_bifocal.raw.invoices'],source_name:'raw'}},semantic_models:{'semantic_model.synthetic_bifocal.sales':{unique_id:'semantic_model.synthetic_bifocal.sales',...load(core.files[1].content).semantic_models[0],depends_on:{nodes:['model.synthetic_bifocal.sales']}}}}
 for(const name of ['staging','sales'])resolvedManifest.nodes['model.synthetic_bifocal.'+name]={unique_id:'model.synthetic_bifocal.'+name,name,resource_type:'model',raw_code:core.files.find(f=>f.path==='models/'+name+'.sql').content,depends_on:{nodes:[name==='sales'?'model.synthetic_bifocal.staging':'source.synthetic_bifocal.raw.invoices']}}
 for(const name of ['not_null','unique'])resolvedManifest.nodes['test.synthetic_bifocal.'+name]={unique_id:'test.synthetic_bifocal.'+name,name,resource_type:'test',test_metadata:{name,kwargs:{column_name:'invoice'}},depends_on:{nodes:['model.synthetic_bifocal.sales']}}
 const resolvedCloud={...structuredClone(core),projectId:'synthetic-bifocal-dbt-cloud-projection',files:[{path:'target/manifest.json',content:JSON.stringify(resolvedManifest)}]}
 for(const input of [core,resolvedCloud]){
  const plan=await prepare(input);assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report.issues));assert.deepEqual(plan.project.definition.views.map(v=>v.id),['sales'])
  const resources=plan.project.report.project.resources,model=resources.find(r=>r.kind==='model'&&r.name==='sales'),checks=resources.filter(r=>r.kind==='test')
  assert.equal(model.definition.translation.bindings[0].root,input===core?'source.raw.invoices':'source.synthetic_bifocal.raw.invoices');assert.deepEqual(model.definition.translation.bindings[0].columns,{invoice:'invoice',region:'region',net:'revenue'});assert.deepEqual(checks.map(r=>[r.definition.translation.test,r.definition.translation.results[0].rows,r.definition.translation.results[0].failures]),[['not_null',4,0],['unique',4,0]])
  await apply(input.projectId,plan);const imported=await call('/model-imports/'+input.projectId),exported=await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:imported.revision},200)
  assert.equal(exported.definition.views[0].query.measures[0].column,'revenue');const review=await call('/model-authoring/review',{document:dump(exported.definition),importProject:input.projectId,importRevision:imported.revision},200);assert.equal(review.compatible,true);assert.equal(review.impacts[0].answer.totals['revenue-sum'].value,'30.00');assert.equal(review.impacts[0].answer.totals['unique-regions'].value,'2')
  await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.match(await page.getByRole('table',{name:'Source project inventory'}).innerText(),/staging/);await proveScreen(input===core?'dbt-projection':'dbt-cloud-projection')
  dbtProjects.push({input,plan})
 }
 await proveDBTPredicates({core,resolvedManifest,resolvedCloud,prepare,apply,call,upload,post,page,origin,proveScreen})
 for(const failure of ['not_null','unique']){
  const id='synthetic-bifocal-dbt-failed-'+failure.replace('_','-'),source=id+'-source'
  await upload(source,csv.replace('4,East,,',failure==='not_null'?',East,,':'3,East,,'))
  const input=structuredClone(core);input.projectId=id;input.bindings.sales.dataset=source
  const plan=await prepare(input);assert.equal(plan.project.report.compatible,false);assert.ok(plan.project.report.issues.some(i=>i.code==='dbt_quality_check_failed'&&i.message.startsWith(failure)))
  const checks=plan.project.report.project.resources.filter(r=>r.kind==='test');assert.equal(checks.find(r=>r.definition.translation.test===failure).definition.translation.results[0].failures,1)
  await apply(id,plan);const imported=await call('/model-imports/'+id);await call('/model-imports/'+id+'/export',{reviewedRevision:imported.revision},409)
  const current=await call('/datasets/'+source);await call('/datasets/'+source+'/erase',{confirmDataset:source,reviewedRevision:current.revision},200);await call('/model-imports/'+id,undefined,404)
 }
 // SQL modifiers and mixed manifest envelopes must not become identity lineage
 // or built-in quality results merely because a physical name also exists.
 const distinctSource='synthetic-bifocal-dbt-distinct-source'
 await upload(distinctSource,'distinct,invoice,region,revenue\n10,1,West,$10.01\n20,1,West,$10.01\n')
 const distinct=structuredClone(core);distinct.projectId='synthetic-bifocal-dbt-distinct'
 distinct.bindings.sales={dataset:distinctSource,grain:['distinct'],columns:{invoice:'distinct',net:'revenue'}}
 distinct.files=distinct.files.slice(0,3);distinct.files[1].content=distinct.files[1].content.replace('tests: [not_null, unique]','tests: []')
 distinct.files[2].content="select distinct invoice, region, revenue AS net FROM {{ source('raw','invoices') }}"
 const distinctPlan=await prepare(distinct)
 assert.equal(distinctPlan.project.report.compatible,false,'DISTINCT must retain a diagnostic instead of mapping the modifier as a column')
 assert.ok(distinctPlan.project.report.issues.some(i=>i.code==='unsupported_dbt_sql'))
 await apply(distinct.projectId,distinctPlan);const distinctImported=await call('/model-imports/'+distinct.projectId)
 await call('/model-imports/'+distinct.projectId+'/export',{reviewedRevision:distinctImported.revision},409)
 await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(distinct.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.match(await page.locator('#model-import-current').innerText(),/unsupported_dbt_sql/);assert.equal(await page.getByRole('button',{name:'Export rebuilt model',exact:true}).count(),0);await proveScreen('dbt-distinct-refused')
 const distinctCurrent=await call('/datasets/'+distinctSource);await call('/datasets/'+distinctSource+'/erase',{confirmDataset:distinctSource,reviewedRevision:distinctCurrent.revision},200);await call('/model-imports/'+distinct.projectId,undefined,404);await post(distinct.projectId,'apply',{planId:distinctPlan.planId,reviewedFingerprint:distinctPlan.fingerprint},410)
 for(const failure of ['sql','mapping','hook','custom-test','manifest-test','manifest-shadow-sql','manifest-shadow-macro','manifest-shadow-metadata']){
  const input=structuredClone(failure.startsWith('manifest-')?resolvedCloud:core);input.projectId='synthetic-bifocal-dbt-refused-'+failure
  if(failure==='sql')input.files[2].content+=' where invoice > 1'
  if(failure==='mapping')input.bindings.sales.columns.net='invoice'
  if(failure==='hook')input.files[0].content+='on-run-start: ["select 1"]\n'
  if(failure==='custom-test')input.files[1].content=input.files[1].content.replace('tests: [not_null, unique]','tests: [{unique: {config: {where: "invoice > 1"}}}]')
  if(failure==='manifest-test'){const changed=JSON.parse(input.files[0].content);changed.nodes['test.synthetic_bifocal.unique'].raw_code='{{ test_not_null(**_dbt_generic_test_kwargs) }}';input.files[0].content=JSON.stringify(changed)}
  if(failure.startsWith('manifest-shadow-')){const changed=JSON.parse(input.files[0].content),test=changed.nodes['test.synthetic_bifocal.unique'];test.test='unique';test.column='invoice';if(failure==='manifest-shadow-sql')test.raw_code='select invoice from secret_table';if(failure==='manifest-shadow-macro')test.depends_on.macros=['macro.synthetic_bifocal.custom_unique'];if(failure==='manifest-shadow-metadata')delete test.test_metadata;input.files[0].content=JSON.stringify(changed)}
  const plan=await prepare(input);assert.equal(plan.project.report.compatible,false,failure);assert.ok(plan.project.report.issues.some(i=>({sql:['unsupported_dbt_sql'],mapping:['dbt_projection_binding_mismatch'],hook:['unsupported_property'], 'custom-test':['unsupported_dbt_test'],'manifest-test':['unsupported_dbt_test'],'manifest-shadow-sql':['unsupported_dbt_test','unsupported_property'],'manifest-shadow-macro':['unsupported_dbt_test','unsupported_property'],'manifest-shadow-metadata':['unsupported_dbt_test','unsupported_property']}[failure]).includes(i.code)),JSON.stringify(plan.project.report.issues))
  if(failure.startsWith('manifest-shadow-'))assert.equal(plan.project.report.project.resources.find(r=>r.id==='test.synthetic_bifocal.unique').definition.translation,undefined,'A refused manifest check must never claim execution')
  await apply(input.projectId,plan);const imported=await call('/model-imports/'+input.projectId);await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:imported.revision},409);if(failure==='manifest-shadow-sql'){await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.match(await page.locator('#model-import-current').innerText(),/unsupported_property/);assert.equal(await page.getByRole('button',{name:'Export rebuilt model',exact:true}).count(),0);await proveScreen('dbt-manifest-test-refused')}dbtProjects.push({input,plan})
 }
 // Adding a manifest must never hide an unsupported uploaded SQL definition.
 const sql={path:'tests/revenue_check.sql',content:"select {{ run_query('select 1') }} from {{ ref('sales') }}"}
 for(const [suffix,extra] of [['empty',[{path:'target/manifest.json',content:JSON.stringify({...manifest,nodes:{},sources:{}})}]],['source',[]],['resolved',cloud.files]]){
  const input=dbtEnvelope('synthetic-bifocal-dbt-sql-'+suffix,[...projects[1].files,sql,...extra]),plan=await prepare(input)
  assert.equal(plan.project.report.compatible,false,'Uploaded SQL stays incompatible with '+suffix+' manifest inventory')
  const inventory=plan.project.report.project.resources,resource=inventory.find(r=>r.file===sql.path)
  assert.ok(resource,'Uploaded SQL remains inventoried with '+suffix+' manifest inventory')
  assert.equal(resource.id,'test.revenue_check');assert.equal(resource.kind,'test');assert.equal(resource.sourceExpression,JSON.stringify({sql:sql.content}));assert.equal(resource.definition.sql,sql.content);assert.deepEqual(resource.dependencies,['model.sales'])
  assert.ok(plan.project.report.issues.some(i=>i.code==='dbt_resource_execution_pending'&&i.file===sql.path&&i.object===resource.id&&i.sourceExpression===JSON.stringify({sql:sql.content})),'Unsupported uploaded SQL retains its diagnostic')
  if(suffix==='resolved')assert.deepEqual(inventory.find(r=>r.id==='model.synthetic_bifocal.sales').dependencies,['source.synthetic_bifocal.raw.invoices'])
  await apply(input.projectId,plan)
  const imported=await call('/model-imports/'+input.projectId)
  assert.equal(imported.report.compatible,false);assert.deepEqual(imported.report.project.resources,inventory);assert.deepEqual(imported.report.issues,plan.project.report.issues);assert.deepEqual(imported.input.files,input.files)
  const exported=await call('/model-authoring/format',{document:dump(imported.definition),importProject:input.projectId,importRevision:imported.revision},409)
  assert.equal(exported.error,'exact_compatible_project_required','Untranslated SQL cannot be exported as native YAML')
  if(suffix==='empty'){
   await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor()
   assert.match(await page.getByRole('table',{name:'Source project inventory'}).innerText(),/test.revenue_check/);assert.match(await page.locator('#model-import-current').innerText(),/dbt_resource_execution_pending/);assert.equal(await page.getByRole('link',{name:'Review imported model',exact:true}).count(),0)
   await proveScreen('dbt-manifest-sql-retained')
  }
  await call('/model-authoring/review',{document:dump(imported.definition),importProject:input.projectId,importRevision:imported.revision},409)
  dbtProjects.push({input,plan})
 }
 const unsafe=structuredClone(cloud);unsafe.projectId='synthetic-bifocal-dbt-unresolved';const broken=structuredClone(manifest);broken.nodes['model.synthetic_bifocal.sales'].depends_on.nodes=['model.synthetic_bifocal.sales','model.synthetic_bifocal.missing'];broken.nodes['model.synthetic_bifocal.sales'].raw_code="{{ run_query('select 1') }}";unsafe.files[0].content=JSON.stringify(broken)
 const unsafePlan=await prepare(unsafe);assert.equal(unsafePlan.project.report.compatible,false);assert.deepEqual(unsafePlan.project.report.issues.filter(i=>['missing_dbt_dependency','cyclic_dbt_dependency'].includes(i.code)).map(i=>i.code).sort(),['cyclic_dbt_dependency','missing_dbt_dependency']);assert.match(unsafePlan.project.report.project.resources.find(r=>r.kind==='model').definition.raw_code,/run_query/);await apply(unsafe.projectId,unsafePlan);dbtProjects.push({input:unsafe,plan:unsafePlan})
 const pbip={...structuredClone(projects[3]),projectId:'synthetic-bifocal-pbip',format:'pbip',files:[
  {path:'Sales.pbip',content:JSON.stringify({version:'1.0',artifacts:[{report:{path:'Sales.Report'}}],settings:{enableAutoRecovery:true}})},
  {path:'Sales.Report/definition.pbir',content:JSON.stringify({version:'4.0',datasetReference:{byPath:{path:'../Sales.SemanticModel'}}})},
  {path:'Sales.SemanticModel/definition.pbism',content:JSON.stringify({version:'4.0',settings:{}})},
  {path:'Sales.SemanticModel/definition/tables/Sales.tmdl',content:projects[3].files[0].content}
 ]}
 const pbipPlan=await prepare(pbip);assert.equal(pbipPlan.counts.rejected,0);assert.equal(pbipPlan.project.report.compatible,false);assert.deepEqual(pbipPlan.project.report.project.resources.map(r=>[r.id,r.dependencies]),[
  ['Sales.pbip',['Sales.Report/definition.pbir']],['Sales.Report/definition.pbir',['Sales.SemanticModel/definition.pbism']],['Sales.SemanticModel/definition.pbism',['Sales.SemanticModel/definition/tables/Sales.tmdl']],['Sales.SemanticModel/definition/tables/Sales.tmdl',[]]
 ]);assert.equal(pbipPlan.project.definition.views[0].query.measures[0].column,'revenue');assert.ok(pbipPlan.project.report.issues.some(i=>i.code==='pbip_report_translation_pending'));await apply(pbip.projectId,pbipPlan);const pbipRead=await call('/model-imports/'+pbip.projectId);assert.deepEqual(pbipRead.input.files,pbip.files);await call('/model-authoring/review',{document:dump(pbipRead.definition),importProject:pbip.projectId,importRevision:pbipRead.revision},409);dbtProjects.push({input:pbip,plan:pbipPlan})
 const folder=await mkdtemp(join(tmpdir(),'bifocal-pbip-picker-'))
 try{
  for(const file of pbip.files){const target=join(folder,file.path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,file.content)}
  const browserProject='synthetic-bifocal-pbip-browser'
  await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click()
  await page.getByLabel('Project ID',{exact:true}).fill(browserProject);await page.getByLabel('Model format',{exact:true}).selectOption('pbip')
  await page.getByLabel('Project fiscal calendar',{exact:true}).selectOption(JSON.stringify(pbip.context.calendar))
  await page.getByLabel('Original project folder',{exact:true}).setInputFiles(folder)
  await page.getByLabel('Source bindings (JSON)',{exact:true}).fill(JSON.stringify(pbip.bindings));await page.getByLabel('Measure formats (JSON)',{exact:true}).fill(JSON.stringify(pbip.formats))
  await page.getByRole('button',{name:'Preview semantic import',exact:true}).click();await page.getByRole('status').filter({hasText:'Review the source compatibility'}).waitFor()
  const inventory=await page.getByRole('table',{name:'Source project inventory'}).innerText()
  for(const file of pbip.files)assert.ok(inventory.includes(file.path),'Folder picker preserves '+file.path)
  assert.equal(await page.getByText('missing_pbip_dependency',{exact:false}).count(),0)
  await proveScreen('pbip-folder-review')
  await page.getByLabel('I reviewed this exact project plan and its unresolved items').check();await page.getByRole('button',{name:'Import reviewed project',exact:true}).click();await page.getByRole('status').filter({hasText:'Project imported and reconciled'}).waitFor()
  const imported=await call('/model-imports/'+browserProject)
  assert.deepEqual([...imported.input.files].sort((a,b)=>a.path.localeCompare(b.path)),[...pbip.files].sort((a,b)=>a.path.localeCompare(b.path)))
  assert.equal(imported.report.compatible,false,'Untranslated report semantics remain explicit after folder import')
  await proveScreen('pbip-folder-imported')
 }finally{await rm(folder,{recursive:true,force:true})}
 // Select actual filesystem directories through the browser, including a
 // singular dbt test whose directory determines its resource kind.
 const singular=structuredClone(raw);singular.projectId='synthetic-bifocal-dbt-singular'
 singular.files.push({path:'tests/nonnegative_revenue.sql',content:"select * from {{ ref('sales') }} where revenue < 0"})
 const singularPlan=await prepare(singular)
 assert.deepEqual(singularPlan.project.report.project.resources.map(r=>[r.id,r.kind,r.file,r.dependencies]).sort(),[
  ['project','project','dbt_project.yml',[]],['model.sales','model','models/sales.sql',['source.raw.invoices']],
  ['source.raw.invoices','source','models/schema.yml',[]],['test.sales.invoice.tests.0','test','models/schema.yml',['model.sales']],
  ['test.sales.invoice.tests.1','test','models/schema.yml',['model.sales']],['test.nonnegative_revenue','test','tests/nonnegative_revenue.sql',['model.sales']]
 ].sort())
 const folderRoot=await mkdtemp(join(tmpdir(),'bifocal-project-folders-'))
 try{
  for(const [source,control,label] of [[pbip,pbipPlan,'pbip'],[singular,singularPlan,'dbt-singular-test']]){
   const input=structuredClone(source);input.projectId='synthetic-bifocal-browser-'+label
   const directory=join(folderRoot,label)
   for(const file of input.files){const target=join(directory,file.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,file.content)}
   await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click()
   await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByLabel('Model format',{exact:true}).selectOption(input.format)
   await page.getByLabel('Project fiscal calendar',{exact:true}).selectOption(JSON.stringify(input.context.calendar))
   await page.getByLabel('Source bindings (JSON)',{exact:true}).fill(JSON.stringify(input.bindings));await page.getByLabel('Measure formats (JSON)',{exact:true}).fill(JSON.stringify(input.formats))
   // Flat selection is refused before creating a plan instead of silently
   // converting a singular test to a model or breaking PBIP dependencies.
   await page.getByLabel('Original project files',{exact:true}).setInputFiles(source.files.map(f=>join(directory,f.path)))
   await page.getByRole('button',{name:'Preview semantic import',exact:true}).click();await page.getByRole('status').filter({hasText:'Choose the project root folder'}).waitFor()
   assert.equal(await page.locator('#model-import-review').isVisible(),false)
   if(label==='dbt-singular-test'){
    await page.getByLabel('Original project folder',{exact:true}).setInputFiles(join(directory,'tests'))
    await page.getByRole('button',{name:'Preview semantic import',exact:true}).click();await page.getByRole('status').filter({hasText:'Choose the dbt project root containing'}).waitFor()
    assert.equal(await page.locator('#model-import-review').isVisible(),false)
   }
   await page.getByLabel('Original project folder',{exact:true}).setInputFiles(directory)
   assert.equal(await page.getByLabel('Original project files',{exact:true}).evaluate(el=>el.files.length),0)
   const selected=await page.getByLabel('Original project folder',{exact:true}).evaluate(el=>Array.from(el.files,f=>f.webkitRelativePath))
   assert.deepEqual(selected.sort(),input.files.map(f=>label+'/'+f.path).sort())
   const response=page.waitForResponse(r=>r.url()===origin+'/api/operator/import/plan'&&r.request().headers()['x-import-dataset']===input.projectId)
   await page.getByRole('button',{name:'Preview semantic import',exact:true}).click();const browserPlan=await (await response).json()
   await page.getByRole('status').filter({hasText:'Review the source compatibility'}).waitFor()
   assert.equal(browserPlan.counts.rejected,0,JSON.stringify(browserPlan))
   assert.deepEqual([...browserPlan.project.input.files].sort((a,b)=>a.path.localeCompare(b.path)),[...input.files].sort((a,b)=>a.path.localeCompare(b.path)))
   assert.deepEqual([...browserPlan.project.report.project.resources].sort((a,b)=>a.id.localeCompare(b.id)),[...control.project.report.project.resources].sort((a,b)=>a.id.localeCompare(b.id)))
   assert.deepEqual(browserPlan.project.report.issues.map(i=>[i.code,i.object]).sort(),control.project.report.issues.map(i=>[i.code,i.object]).sort())
   const inventory=page.locator('#model-import-report table').filter({has:page.getByText('Source object',{exact:true})}).first()
   assert.match(await inventory.innerText(),label==='pbip'?/Sales\.Report\/definition\.pbir/:/test\.nonnegative_revenue/)
   await proveScreen('model-folder-'+label+'-review')
   await page.getByLabel('I reviewed this exact project plan and its unresolved items').check();await page.getByRole('button',{name:'Import reviewed project',exact:true}).click()
   await page.getByRole('status').filter({hasText:'Project imported and reconciled'}).waitFor()
   const imported=await call('/model-imports/'+input.projectId)
   assert.deepEqual(imported.input.files,browserPlan.project.input.files);assert.deepEqual(imported.report.project.resources,browserPlan.project.report.project.resources)
   assert.equal(await page.getByRole('link',{name:'Review imported model',exact:true}).count(),0)
   await proveScreen('model-folder-'+label+'-imported');dbtProjects.push({input,plan:browserPlan})
  }
 }finally{await rm(folderRoot,{recursive:true,force:true})}
 const unsafePBIP=structuredClone(pbip);unsafePBIP.projectId='synthetic-bifocal-pbip-unsafe';unsafePBIP.files[1].content=JSON.stringify({version:'4.0',datasetReference:{byPath:{path:'../../outside'}}});unsafePBIP.files.push({path:'Sales.Report/report.json',content:'{"visuals":[]}'});const unsafePBIPPlan=await prepare(unsafePBIP);assert.equal(unsafePBIPPlan.project.report.compatible,false);assert.ok(unsafePBIPPlan.project.report.issues.some(i=>i.code==='unsafe_pbip_path'));assert.ok(unsafePBIPPlan.project.report.issues.some(i=>i.code==='unsupported_pbip_file'&&i.file==='Sales.Report/report.json'));await apply(unsafePBIP.projectId,unsafePBIPPlan);dbtProjects.push({input:unsafePBIP,plan:unsafePBIPPlan})
 const missingPBIP=structuredClone(pbip);missingPBIP.projectId='synthetic-bifocal-pbip-missing';missingPBIP.files=missingPBIP.files.filter(f=>!f.path.endsWith('definition.pbism'));const missingPBIPPlan=await prepare(missingPBIP);assert.equal(missingPBIPPlan.project.report.compatible,false);assert.ok(missingPBIPPlan.project.report.issues.some(i=>i.code==='missing_pbip_dependency'&&i.message.includes('Sales.SemanticModel/definition.pbism')));await apply(missingPBIP.projectId,missingPBIPPlan);dbtProjects.push({input:missingPBIP,plan:missingPBIPPlan})
 const card={id:37,name:'sales',dataset_query:{database:9,type:'query',query:{'source-table':12,aggregation:[['sum',['field',4,null]]]}},result_metadata:[{name:'revenue',base_type:'type'+'/'+'Decimal'}]},mbTable={id:12,name:'invoices',db_id:9,fields:[{id:4,name:'revenue',base_type:'type'+'/'+'Decimal'}]},mbDatabase={id:9,name:'warehouse',engine:'postgres',details:{}}
 const twb='<workbook><datasources><datasource name="sales"><connection class="textscan"><relation type="table" table="invoices"/></connection><column name="[revenue]" datatype="real"/><column name="[revenue_sum]" datatype="real"><calculation class="tableau" formula="SUM([revenue])"/></column></datasource></datasources><worksheets><worksheet name="Revenue"><table><view><datasource-dependencies datasource="sales"/></view></table></worksheet></worksheets></workbook>'
 const nativeProjects=[
  {...dbtEnvelope('synthetic-bifocal-metabase-api',[{path:'card.json',content:JSON.stringify(card)},{path:'table.json',content:JSON.stringify(mbTable)},{path:'database.json',content:JSON.stringify(mbDatabase)}]),format:'metabase'},
  {...dbtEnvelope('synthetic-bifocal-metabase-yaml',[{path:'card.yaml',content:dump({...card,[['serdes','meta'].join('/')]:[{model:'Card',id:'37'}]})},{path:'table.yaml',content:dump({...mbTable,[['serdes','meta'].join('/')]:[{model:'Table',id:'12'}]})},{path:'database.yaml',content:dump({...mbDatabase,[['serdes','meta'].join('/')]:[{model:'Database',id:'9'}]})}]),format:'metabase'},
  {...dbtEnvelope('synthetic-bifocal-tableau-twb',[{path:'sales.twb',content:twb}]),format:'tableau'},
  {...dbtEnvelope('synthetic-bifocal-tableau-twbx',[{path:'sales.twbx',content:Buffer.from(zipSync({'sales.twb':strToU8(twb)})).toString('base64')}]),format:'tableau'}
 ]
 for(const input of nativeProjects){const plan=await prepare(input);assert.equal(plan.counts.rejected,0);assert.equal(plan.project.report.compatible,false);const inventory=plan.project.report.project.resources
  if(input.format==='metabase'){assert.deepEqual(inventory.map(r=>[r.id,r.dependencies]),[['Card.37',['Database.9','Table.12']],['Table.12',['Database.9']],['Database.9',[]]]);assert.deepEqual(inventory[0].definition.dataset_query,card.dataset_query);assert.deepEqual(inventory[1].definition.fields,mbTable.fields);assert.ok(plan.project.report.issues.some(i=>i.code==='measure_format_required'&&i.object==='sales.revenue'))}
  else{assert.deepEqual(inventory.map(r=>[r.id,r.dependencies]),[['datasource.sales',[]],['datasource.sales.[revenue]',['datasource.sales']],['datasource.sales.[revenue_sum]',['datasource.sales']],['worksheet.Revenue',['datasource.sales']]]);assert.deepEqual(inventory[2].definition.calculations,['SUM([revenue])']);assert.ok(plan.project.report.issues.some(i=>i.code==='tableau_content_translation_pending'))}
  await apply(input.projectId,plan);const current=await call('/model-imports/'+input.projectId);assert.deepEqual(current.report.project.resources,inventory);assert.deepEqual(current.input.files,input.files);await call('/model-authoring/review',{document:dump(saved[0].imported.definition),importProject:input.projectId,importRevision:current.revision},409);dbtProjects.push({input,plan})
 }
 const badXML={...structuredClone(nativeProjects[2]),projectId:'synthetic-bifocal-tableau-entity',files:[{path:'sales.twb',content:'<!DOCTYPE workbook [<!ENTITY injected SYSTEM "https://synthetic-bifocal.invalid">]><workbook>&injected;</workbook>'}]};const badXMLPlan=await prepare(badXML);assert.equal(badXMLPlan.project.report.compatible,false);assert.ok(badXMLPlan.project.report.issues.some(i=>i.code==='tableau_active_xml'));await apply(badXML.projectId,badXMLPlan);dbtProjects.push({input:badXML,plan:badXMLPlan})
 for(const [name,entries,code] of [['traversal',{'../sales.twb':strToU8(twb)},'unsafe_tableau_archive'],['expanded',{'sales.twb':strToU8('x'.repeat(262145))},'unsafe_tableau_archive'],['binary',{'sales.twb':strToU8(twb),'Data/source.hyper':new Uint8Array([1,2,3])},'unsupported_tableau_archive_item']]){const input={...structuredClone(nativeProjects[3]),projectId:'synthetic-bifocal-tableau-'+name,files:[{path:'sales.twbx',content:Buffer.from(zipSync(entries)).toString('base64')}]},plan=await prepare(input);assert.equal(plan.project.report.compatible,false);assert.ok(plan.project.report.issues.some(i=>i.code===code),JSON.stringify(plan.project.report.issues));await apply(input.projectId,plan);dbtProjects.push({input,plan})}
 // Source filters and permissions must never disappear into a wider native
 // aggregate. Unsupported expressions stay visible and cannot export or publish.
 for(const format of ['metabase','tableau']){
  const source=projects.find(input=>input.format===format)
  for(const problem of ['filter','expression','connection']){
   const input=structuredClone(source);input.projectId='synthetic-bifocal-'+format+'-'+problem
   if(format==='metabase'){const card=JSON.parse(input.files[0].content);if(problem==='filter')card.dataset_query.query.filter=['or',['=', ['field',2,null],'West'],['=', ['field',2,null],'East']];else if(problem==='connection'){const database=JSON.parse(input.files[2].content);database.details={ssl:true};input.files[2].content=JSON.stringify(database)}else card.dataset_query.query.aggregation[0]=['sum',['+', ['field',3,null],1]];input.files[0].content=JSON.stringify(card)}
   else input.files[0].content=problem==='connection'?input.files[0].content.replace('class="textscan"','class="textscan" directory="."'):problem==='filter'?input.files[0].content.replace('</datasource>','<filter column="[region]"/></datasource>'):input.files[0].content.replace('SUM([revenue])','WINDOW_SUM(SUM([revenue]))')
   const plan=await prepare(input);assert.equal(plan.project.report.compatible,false);assert.ok(plan.project.report.issues.some(i=>problem!=='expression'?['unsupported_property','unsupported_tableau_property','metabase_execution_pending','unsupported_metabase_predicate'].includes(i.code):i.code==='metabase_execution_pending'||i.code==='unsupported_tableau_calculation'))
   await apply(input.projectId,plan);const current=await call('/model-imports/'+input.projectId)
   await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:current.revision},409)
   await call('/model-authoring/review',{document:dump(saved[0].imported.definition),importProject:input.projectId,importRevision:current.revision},409)
   dbtProjects.push({input,plan})
  }
 }
 const unchanged=await call('/models/'+saved[0].model.modelId+'/production/run',{viewId:'sales'});assert.deepEqual(unchanged.answer,saved[0].answer.answer,'Unexecutable project revisions cannot alter the published model')
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(raw.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();await page.getByText('Full source compatibility report',{exact:true}).click();assert.match(await page.locator('#model-import-current pre').innerText(),/source.raw.invoices/);assert.match(await page.locator('#model-import-current pre').innerText(),/not_null/);assert.equal(await page.getByRole('link',{name:'Review imported model',exact:true}).count(),0);assert.match(await page.getByRole('table',{name:'Source project inventory'}).innerText(),/model.sales/);await page.getByText('Full source compatibility report',{exact:true}).click();await proveScreen('dbt-project-lineage')
 // Original files load from a real git working tree, then use the same browser
 // and exact-review door as any owner-authored native model.
 const git=await mkdtemp(join(tmpdir(),'bifocal-model-git-'))
 const authorName=execFileSync('git',['log','-1','--format=%an'],{encoding:'utf8'}).trim(),authorEmail=execFileSync('git',['log','-1','--format=%ae'],{encoding:'utf8'}).trim()
 try{execFileSync('git',['init','-q',git]);await writeFile(join(git,'model.yaml'),dump(saved[0].imported.definition));execFileSync('git',['-C',git,'add','model.yaml']);execFileSync('git',['-C',git,'-c','user.name='+authorName,'-c','user.email='+authorEmail,'commit','-qm','Author reviewed fiscal model'],{env:{...process.env,GIT_AUTHOR_NAME:authorName,GIT_AUTHOR_EMAIL:authorEmail,GIT_COMMITTER_NAME:authorName,GIT_COMMITTER_EMAIL:authorEmail}});const tracked=await readFile(join(git,'model.yaml'),'utf8');await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor();await page.getByLabel('Open native model YAML').setInputFiles(join(git,'model.yaml'));await page.getByRole('status').filter({hasText:'Native YAML loaded'}).waitFor();assert.equal(await page.getByLabel('Model document').inputValue(),tracked);await page.getByRole('button',{name:'Review model',exact:true}).click();await page.getByRole('status').filter({hasText:'Review complete'}).waitFor();await proveScreen('model-git-review')}finally{await rm(git,{recursive:true,force:true})}
 const original=saved[0],uiInput=structuredClone(projects[0]);uiInput.projectId='synthetic-bifocal-browser-model'
 await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project fiscal calendar',{exact:true}).selectOption(JSON.stringify(uiInput.context.calendar));await page.getByLabel('Project ID',{exact:true}).fill(uiInput.projectId);await page.getByLabel('Model format',{exact:true}).selectOption('lookml');await page.getByLabel('Original project files',{exact:true}).setInputFiles(uiInput.files.map(f=>({name:f.path,mimeType:'text'+'/'+'plain',buffer:Buffer.from(f.content)})));await page.getByLabel('Source bindings (JSON)',{exact:true}).fill(JSON.stringify(uiInput.bindings));await page.getByLabel('Measure formats (JSON)',{exact:true}).fill(JSON.stringify(uiInput.formats));await page.getByRole('button',{name:'Preview semantic import',exact:true}).click();await page.getByRole('status').filter({hasText:'Review the source compatibility'}).waitFor();await proveScreen('model-project-review');await page.getByLabel('I reviewed this exact project plan and its unresolved items').check();await page.getByRole('button',{name:'Import reviewed project',exact:true}).click();await page.getByRole('status').filter({hasText:'Project imported and reconciled'}).waitFor();await proveScreen('model-project-imported');const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export rebuilt model',exact:true}).click();const download=await downloaded;assert.equal(download.suggestedFilename(),uiInput.projectId+'.native.json');const browserExport=JSON.parse(await readFile(await download.path(),'utf8'));assert.deepEqual(browserExport.definition,(await call('/model-imports/'+uiInput.projectId)).definition);assert.deepEqual(browserExport.sources.map(s=>s.dataset),[dataset]);await page.getByRole('status').filter({hasText:'Rebuilt model and source mapping exported'}).waitFor();await page.getByRole('link',{name:'Review imported model',exact:true}).click();await page.getByRole('status').filter({hasText:'Imported definition loaded'}).waitFor();await page.getByRole('button',{name:'Review model',exact:true}).click();await page.getByRole('status').filter({hasText:'Review complete'}).waitFor();await proveScreen('model-translated-review')
 const unsupported=structuredClone(projects[0]);unsupported.projectId='synthetic-bifocal-unsupported-model';unsupported.files[0].content=unsupported.files[0].content.replace('explore: sales {}','explore: sales { sql_always_where: ${sales.region} = \'West\' ;; }')
 const blocked=await prepare(unsupported);assert.equal(blocked.project.report.compatible,false);assert.ok(blocked.project.report.issues.some(i=>i.object.includes('sql_always_where')&&i.sourceExpression.includes('West')));await apply(unsupported.projectId,blocked)
 await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(unsupported.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.equal(await page.getByRole('link',{name:'Review imported model',exact:true}).count(),0);await proveScreen('model-unresolved-project')
 await call('/model-imports/'+unsupported.projectId+'/export',{reviewedRevision:(await call('/model-imports/'+unsupported.projectId)).revision},409)
 assert.equal(await page.getByRole('button',{name:'Export rebuilt model',exact:true}).count(),0)
 // Native invitation and confirmation use the unchanged native handlers;
 // only mail delivery is replaced, while import checks use the emitted Worker.
 const mailHeaders={Origin:origin,'X-Bifocal-Test-Mail':'synthetic-bifocal-mail'}
 for(const role of ['admin','member']){
  const email='synthetic-bifocal-import-'+role+'@example.test'
  const invited=await context.request.post(origin+'/auth/invite',{headers:mailHeaders,data:{email,displayName:'Synthetic import '+role,role}})
  assert.equal(invited.status(),202,await invited.text())
  const reader=await context.browser().newContext({ignoreHTTPSErrors:true})
  try{
   if(signInMember)await signInMember(reader,email)
   else{
    const outbox=await(await context.request.get(origin+'/__model-mail')).json(),message=outbox.find(m=>m.to.includes(email));assert.ok(message)
    const link=message.text.match(/https?:[^\s]+/)[0],token=new URL(link).searchParams.get('token');assert.ok(token)
    const confirmed=await reader.request.post(origin+'/auth/confirm',{headers:mailHeaders,data:{token},maxRedirects:0});assert.equal(confirmed.status(),303,await confirmed.text())
   }
   const session=await reader.request.get(origin+'/auth/session');assert.equal(session.status(),200);assert.equal((await session.json()).operator.role,role)
   for(const path of ['/model-imports/'+original.input.projectId,'/import/history','/import/original/'+original.plan.planId]){
    const r=await reader.request.get(origin+'/api/operator'+path,{headers:{'X-Import-Kind':'model','X-Import-Dataset':original.input.projectId}});assert.equal(r.status(),401,await r.text())
   }
   for(const action of ['uploads','plan','apply','reconcile','undo']){
    const r=await reader.request.post(origin+'/api/operator/import/'+action,{headers:{Origin:origin,'X-Import-Kind':'model','X-Import-Dataset':original.input.projectId},data:{planId:original.plan.planId,reviewedFingerprint:original.plan.fingerprint}});assert.equal(r.status(),401,await r.text())
   }
   for(const [action,data] of [['export',{reviewedRevision:original.imported.revision}],['erase',{confirmProject:original.input.projectId,reviewedRevision:original.imported.revision}]]){
    const r=await reader.request.post(origin+'/api/operator/model-imports/'+original.input.projectId+'/'+action,{headers:{Origin:origin},data});assert.equal(r.status(),401,await r.text())
   }
   assert.equal((await call('/model-imports/'+original.input.projectId)).revision,original.imported.revision)
  }finally{await reader.close()}
 }
 const cancelled=structuredClone(projects[0]);cancelled.projectId='synthetic-bifocal-cancelled-model';const cancelledPlan=await prepare(cancelled);await post(cancelled.projectId,'undo',{planId:cancelledPlan.planId})
 const stale=structuredClone(projects[0]);stale.projectId='synthetic-bifocal-stale-model';const stalePlan=await prepare(stale);await upload(dataset,csv.replace('$10.01','$11.01'),true);await post(stale.projectId,'apply',{planId:stalePlan.planId,reviewedFingerprint:stalePlan.fingerprint},409)
 const anonymous=await context.browser().newContext({ignoreHTTPSErrors:true});try{assert.equal((await anonymous.request.get(origin+'/api/operator/model-imports/'+projects[0].projectId)).status(),401)}finally{await anonymous.close()}
 await call('/model-imports/'+original.input.projectId+'/export',{reviewedRevision:original.imported.revision},409)
 const unsigned=await context.browser().newContext({ignoreHTTPSErrors:true})
 try{assert.equal((await unsigned.request.get(origin+'/api/operator/model-imports/'+projects[0].projectId)).status(),401);assert.equal((await unsigned.request.post(origin+'/api/operator/model-imports/'+projects[0].projectId+'/export',{headers:{Origin:origin},data:{reviewedRevision:original.imported.revision}})).status(),401)}finally{await unsigned.close()}
 assert.equal((await context.request.post(origin+'/api/operator/model-imports/'+original.input.projectId+'/export',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{reviewedRevision:original.imported.revision}})).status(),401)
 const foreign=await context.request.post(origin+'/api/operator/import/plan',{headers:{Origin:'https://synthetic-bifocal.invalid','X-Import-Kind':'model','X-Import-Dataset':projects[0].projectId},data:{uploadId:'synthetic-bifocal-denied'}});assert.equal(foreign.status(),401)
 await call('/model-authoring/review',{document:dump(original.imported.definition),importProject:projects[0].projectId,importRevision:'stale'},409)
 const source=await call('/datasets/'+dataset);const erased=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200);assert.ok(erased.modelProjects.length>=projects.length)
 for(const item of saved){const originals=await context.request.get(origin+'/api/operator/import/original/'+item.plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':item.input.projectId}});assert.equal(originals.status(),200,await originals.text());assert.ok((await originals.json()).originals.every(o=>o.original.status==='unavailable'));await call('/model-imports/'+item.input.projectId,undefined,404);await call('/model-imports/'+item.input.projectId+'/export',{reviewedRevision:item.imported.revision},404);await call('/models/'+item.model.modelId,undefined,404);await call('/queries/'+item.answer.queryId,undefined,404);await call('/reports/'+item.report.id,undefined,404);await post(item.input.projectId,'apply',{planId:item.plan.planId,reviewedFingerprint:item.plan.fingerprint},410)}
 for(const [input,plan] of [[unsupported,blocked],[cancelled,cancelledPlan],[stale,stalePlan]]){await call('/model-imports/'+input.projectId,undefined,404);await post(input.projectId,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410)}
 for(const {input,plan} of dbtProjects){await call('/model-imports/'+input.projectId,undefined,404);const originals=await context.request.get(origin+'/api/operator/import/original/'+plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':input.projectId}});assert.equal(originals.status(),200);assert.ok((await originals.json()).originals.every(o=>o.original.status==='unavailable'));await post(input.projectId,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410)}
 console.log('Source model imports: executable LookML, dbt Semantic Layer, MetricFlow, TMDL, Cube, bounded dbt Core and Cloud projections and quality checks, scoped Metabase aggregates and Tableau source measures, plus diagnostic PBIP inventories; shared review, exact source SQL parity, native publication, governed exploration and exports, git YAML, explicit gaps, stale refusal and full source withdrawal passed')
}

/** Real CLI and Terraform model changes share exact native review and fences. */
export async function proveModelLifecycle({origin,context,definition,upload}){
 const page=await context.newPage()
 const proveScreen=async(label)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(button=>!button.textContent.trim()).length),0,'Every control has text');if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/'+label+'-'+width+'.png',fullPage:true})}}
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{resolve}=await import('node:path')
 const run=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'bifocal-model-tools-')),session=join(directory,'session'),document=join(directory,'model.native.json'),plan=join(directory,'create.plan.json')
 const cookie=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ')
 const toolDirectory=resolve('.cache/bifocal-tools'),terraform=join(toolDirectory,'terraform'),provider=join(toolDirectory,'terraform-provider-run-bifocal')
 const cli=async(command,args=[],ok=true)=>{
  try{const result=await run(process.execPath,['src/bifocal/models/validation/cli.mjs',command,'--origin',origin,'--session-file',session,...args],{maxBuffer:8<<20});assert.equal(ok,true,'Expected CLI refusal');return JSON.parse(result.stdout)}catch(error){if(ok)throw error;assert.match(error.stderr??'',/refused|reviewed plan|required/);return null}
 }
 const call=async(path,data,method=data===undefined?'GET':'POST')=>{const response=await context.request.fetch(origin+'/api/operator'+path,{method,headers:{Origin:origin},...(data===undefined?{}:{data})});assert.ok(response.ok(),await response.text());return response.json()}
 try{
  await writeFile(session,cookie,{mode:0o600});await writeFile(document,JSON.stringify(definition))
  const review=await cli('plan',['--file',document,'--plan-file',plan]);assert.equal(review.compatible,true)
  const savedPlan=await readFile(plan,'utf8');assert.ok(!savedPlan.includes(cookie));assert.ok(!savedPlan.includes('answer'));assert.ok(!savedPlan.includes('securityScope'))
  await cli('apply',['--plan-file',plan,'--approve','0'.repeat(64)],false)
  const created=await cli('apply',['--plan-file',plan,'--approve',review.digest]),flags=['--model',created.modelId,'--branch',created.branchId]
  const exported=join(directory,'export.native.json');await cli('export',[...flags,'--output',exported]);const native=JSON.parse(await readFile(exported,'utf8'));assert.deepEqual(native,review.definition)
  // A real single-answer dashboard round trip serializes definitions, never row bytes or grants.
  const draft=join(directory,'dashboard.native.json');await writeFile(draft,JSON.stringify({version:1,title:'Fiscal revenue from git',definition:native.views[0].query}))
  const dashboardReview=await cli('dashboard-import',['--file',draft,'--plan-file',join(directory,'dashboard.plan.json')]),dashboard=await cli('dashboard-import',['--file',draft,'--approve',dashboardReview.digest]),dashboardExport=join(directory,'dashboard-export.native.json');await cli('dashboard-export',['--id',dashboard.id,'--output',dashboardExport])
  assert.deepEqual(JSON.parse(await readFile(dashboardExport,'utf8')),{version:1,title:'Fiscal revenue from git',definition:dashboard.definition})
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/dashboards/'+dashboard.id);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();assert.match(await page.locator('#totals').innerText(),/69\.06/);await proveScreen('model-cli-dashboard')}
  const config=join(directory,'terraform.rc'),tf=join(directory,'main.tf.json')
  await writeFile(config,`provider_installation {\n dev_overrides { "just-every/run-bifocal" = ${JSON.stringify(toolDirectory)} }\n direct {}\n}\n`,{mode:0o600})
  const tfDefinition=structuredClone(native);let resource,reviewSequence=0
  const writeConfig=async()=>{const source=join(directory,'tf-document.json');await writeFile(source,JSON.stringify(tfDefinition));const reviewed=await cli('plan',['--file',source,'--plan-file',join(directory,'tf-review-'+reviewSequence+++'.json'),...(resource?['--model',resource.model_id,'--branch',resource.branch_id]:[])]);return writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_model_branch:{main:{document:JSON.stringify(tfDefinition),review_digest:reviewed.digest}}}}))}
  const tfRun=async(args,ok=true)=>{try{const result=await run(terraform,args,{cwd:directory,env:{...process.env,TF_CLI_CONFIG_FILE:config,BIFOCAL_SESSION_FILE:session,TF_IN_AUTOMATION:'1'},maxBuffer:8<<20});assert.equal(ok,true,'Expected Terraform refusal');return result.stdout}catch(error){if(ok)throw error;assert.match(error.stderr??'',/Bifocal refused|stale|published_branch/);return error.stderr}}
  await readFile(provider);await writeConfig()
  await tfRun(['plan','-input=false','-no-color','-out=create.tfplan']);await tfRun(['apply','-input=false','-no-color','create.tfplan'])
  let state=JSON.parse(await readFile(join(directory,'terraform.tfstate'),'utf8'));resource=state.resources[0].instances[0].attributes
  assert.ok(resource.model_id&&resource.branch_id);assert.equal(resource.branch_version,1)
  const tfPath='/models/'+resource.model_id+'/branches/'+resource.branch_id,old=await call(tfPath)
  tfDefinition.views[0].query.filters.push({column:'region',op:'eq',value:'West'});await writeConfig()
  await tfRun(['plan','-input=false','-no-color','-out=change.tfplan'])
  // An independent CLI editor invalidates the saved Terraform plan atomically.
  const conflictPlan=join(directory,'conflict.plan.json'),conflict=await cli('plan',['--file',exported,'--plan-file',conflictPlan,'--model',resource.model_id,'--branch',resource.branch_id])
  await cli('apply',['--plan-file',conflictPlan,'--approve',conflict.digest]);const concurrent=await call(tfPath)
  await tfRun(['apply','-input=false','-no-color','change.tfplan'],false);assert.deepEqual(await call(tfPath),concurrent)
  await writeConfig();await tfRun(['plan','-input=false','-no-color','-out=current.tfplan']);await tfRun(['apply','-input=false','-no-color','current.tfplan'])
  const updated=await call(tfPath);assert.equal(updated.version,3);assert.notEqual(updated.revision_id,old.revision_id);assert.deepEqual(updated.definition.views[0].query.filters,tfDefinition.views[0].query.filters)
  // Terraform import discovers an actual CLI-created native resource.
  await tfRun(['destroy','-auto-approve','-input=false','-no-color'])
  const ownSource='synthetic-bifocal-dashboard-tools',ownCSV='invoice,date,region,revenue\n1,07/01/2026,West,$10.01\n2,07/02/2026,East,$20.02\n'
  await upload(ownSource,ownCSV)
  const ownDocument=JSON.parse(await readFile(dashboardExport,'utf8'));ownDocument.definition.dataset=ownSource
  const unauthenticated=await fetch(origin+'/api/operator/dashboard-definitions/review',{method:'POST',headers:{'content-type':'application'+'/'+'json',Origin:origin},body:JSON.stringify({document:ownDocument})});assert.equal(unauthenticated.status,401)
  assert.equal((await context.request.post(origin+'/api/operator/dashboard-definitions/review',{headers:{Origin:'https://foreign.example.test'},data:{document:ownDocument}})).status(),401)
  const ownFile=join(directory,'own-dashboard.json');await writeFile(ownFile,JSON.stringify(ownDocument));const ownReview=await cli('dashboard-import',['--file',ownFile,'--plan-file',join(directory,'own-dashboard-review.json')]);const dashboardDocument=JSON.stringify(ownDocument),dashboardConfig={terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_dashboard_snapshot:{main:{document:dashboardDocument,review_digest:ownReview.digest}}}}
  await writeFile(tf,JSON.stringify(dashboardConfig));await tfRun(['plan','-input=false','-no-color','-out=dashboard.tfplan'])
  await upload(ownSource,ownCSV.replace('$10.01','$11.01'),true)
  const queriesBefore=await call('/queries');await tfRun(['apply','-input=false','-no-color','dashboard.tfplan'],false);assert.deepEqual(await call('/queries'),queriesBefore,'Stale dashboard plans create neither an answer nor an artifact')
  const freshDashboard=await cli('dashboard-import',['--file',ownFile,'--plan-file',join(directory,'own-dashboard-fresh.json')]);dashboardConfig.resource.bifocal_dashboard_snapshot.main.review_digest=freshDashboard.digest;await writeFile(tf,JSON.stringify(dashboardConfig));await tfRun(['plan','-input=false','-no-color','-out=dashboard-current.tfplan']);await tfRun(['apply','-input=false','-no-color','dashboard-current.tfplan'])
  const dashboardState=JSON.parse(await readFile(join(directory,'terraform.tfstate'),'utf8')).resources[0].instances[0].attributes
  assert.equal((await call('/dashboards/'+dashboardState.id)).answer.totals.revenue.value,'31.03')
  await tfRun(['destroy','-auto-approve','-input=false','-no-color']);assert.equal((await call('/dashboards/'+dashboardState.id)).id,dashboardState.id,'Terraform release preserves immutable history')
  dashboardConfig.resource.bifocal_dashboard_snapshot.main.document=await readFile(dashboardExport,'utf8');delete dashboardConfig.resource.bifocal_dashboard_snapshot.main.review_digest;await writeFile(tf,JSON.stringify(dashboardConfig));await tfRun(['import','-input=false','-no-color','bifocal_dashboard_snapshot.main',dashboard.id]);await tfRun(['plan','-input=false','-no-color','-detailed-exitcode'])
  await tfRun(['destroy','-auto-approve','-input=false','-no-color'])
  await writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_model_branch:{main:{document:JSON.stringify(native)}}}}))
  await tfRun(['import','-input=false','-no-color','bifocal_model_branch.main',created.modelId+':'+created.branchId])
  const publication=await cli('validate',flags);assert.equal(publication.compatible,true)
  await cli('approve',[...flags,'--digest',publication.digest]);await cli('promote',[...flags,'--digest',publication.digest,'--environment','production'],false)
  await cli('promote',[...flags,'--digest',publication.digest,'--environment','staging']);await cli('promote',[...flags,'--digest',publication.digest,'--environment','production'])
  await tfRun(['destroy','-auto-approve','-input=false','-no-color'],false)
  const beforeSource=await call('/datasets/'+native.views[0].query.dataset),branchFile=join(directory,'branch.native.json'),changed=structuredClone(native)
  changed.views[0].query.filters.push({column:'region',op:'eq',value:'West'});await writeFile(branchFile,JSON.stringify(changed))
  const branched=await cli('branch',['--model',created.modelId,'--file',branchFile]),branchFlags=['--model',created.modelId,'--branch',branched.branchId],diff=await cli('validate',branchFlags)
  assert.equal(diff.definitionDiff.length,1);assert.deepEqual(diff.definitionDiff[0].before,native.views[0]);assert.notDeepEqual(diff.definitionDiff[0].after,native.views[0])
  await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor();await page.getByRole('button',{name:'Open model '+created.modelId.slice(0,8)+' · revision 1 · branch '+branched.branchId.slice(0,8),exact:true}).click();await page.getByRole('status').filter({hasText:'Saved revision loaded'}).waitFor();await page.getByRole('button',{name:'Review publication'}).click();await page.getByRole('status').filter({hasText:'Publication review complete'}).waitFor();assert.match(await page.locator('#publication-results').innerText(),/definitionDiff/);await proveScreen('model-tools-semantic-review')
  const productionBefore=await cli('status',['--model',created.modelId]),development=await cli('preview',[...branchFlags,'--view',native.views[0].id,'--digest',diff.digest]);assert.equal(development.environment,'development');assert.equal(development.revision,branched.revision);assert.equal(development.productionSends,0);assert.equal(development.sourceWrites,0);assert.deepEqual(await cli('status',['--model',created.modelId]),productionBefore)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/queries/'+development.queryId);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();await proveScreen('model-tools-development-preview')}
  await cli('approve',[...branchFlags,'--digest',diff.digest]);await cli('promote',[...branchFlags,'--digest',diff.digest,'--environment','staging'])
  const staged=await cli('run',['--model',created.modelId,'--environment','staging','--view',native.views[0].id]);assert.equal(staged.productionSends,0);assert.equal(staged.sourceWrites,0);assert.deepEqual(await call('/datasets/'+native.views[0].query.dataset),beforeSource)
  await cli('promote',[...branchFlags,'--digest',diff.digest,'--environment','production'])
  const current=await cli('status',['--model',created.modelId]),rollback=await cli('rollback-plan',['--model',created.modelId,'--revision',created.revision])
  await cli('rollback',['--model',created.modelId,'--revision',created.revision,'--generation',String(current.generation),'--digest',rollback.digest,'--security-resolution','Restore the reviewed original scoped definition.'])
  const restored=await cli('status',['--model',created.modelId]);assert.equal(restored.production,created.revision);assert.equal(restored.staging,created.revision)
  const answer=await cli('run',['--model',created.modelId,'--environment','production','--view',native.views[0].id]);assert.equal(answer.answer.totals.revenue.value,'69.06');assert.equal(answer.revision,created.revision)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/queries/'+answer.queryId);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();await proveScreen('model-cli-rollback')}
  const editPlan=join(directory,'edit.plan.json'),editReview=await cli('plan',[...branchFlags,'--file',branchFile,'--plan-file',editPlan]);await cli('apply',['--plan-file',editPlan,'--approve',editReview.digest]);const editState=await call('/models/'+created.modelId+'/branches/'+branched.branchId)
  await cli('apply',['--plan-file',editPlan,'--approve',editReview.digest],false);assert.deepEqual(await call('/models/'+created.modelId+'/branches/'+branched.branchId),editState)
  // Reports use the actual native report surface, not a representative kind.
  const reportFile=join(directory,'report.native.json'),reportPlan=join(directory,'report.plan.json')
  const reportDocument={version:1,title:'Reviewed git report',definition:native.views[0].query};await writeFile(reportFile,JSON.stringify(reportDocument))
  const reportReview=await cli('report-import',['--file',reportFile,'--plan-file',reportPlan])
  const wrongKind=await context.request.post(origin+'/api/operator/dashboard-definitions/create',{headers:{Origin:origin},data:{document:reportDocument,reviewedDigest:reportReview.digest}});assert.equal(wrongKind.status(),409,'A reviewed report fingerprint cannot approve a dashboard')
  const report=await cli('report-import',['--file',reportFile,'--approve',reportReview.digest])
  const reportExport=join(directory,'report-export.native.json');await cli('report-export',['--id',report.id,'--output',reportExport]);assert.deepEqual(JSON.parse(await readFile(reportExport,'utf8')),reportDocument)
  await writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_report_snapshot:{main:{document:JSON.stringify(reportDocument),review_digest:reportReview.digest}}}}))
  await tfRun(['import','-input=false','-no-color','-state=report.tfstate','bifocal_report_snapshot.main',report.id])
  let reportState=JSON.parse(await readFile(join(directory,'report.tfstate'),'utf8'));assert.equal(reportState.resources[0].instances[0].attributes.query_id,report.queryId)
  await tfRun(['destroy','-auto-approve','-input=false','-no-color','-state=report.tfstate']);assert.deepEqual((await call('/reports/'+report.id)).answer,report.answer)
  await tfRun(['plan','-input=false','-no-color','-state=report.tfstate','-out=report-create.tfplan']);await tfRun(['apply','-input=false','-no-color','-state=report.tfstate','report-create.tfplan'])
  reportState=JSON.parse(await readFile(join(directory,'report.tfstate'),'utf8'));const reportId=reportState.resources[0].instances[0].attributes.id
  assert.notEqual(reportId,report.id);assert.deepEqual((await call('/reports/'+reportId)).answer,report.answer)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/reports/'+reportId);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();assert.match(await page.locator('#totals').innerText(),/69\.06/);await proveScreen('model-terraform-report')}
  assert.ok(!(await readFile(join(directory,'report.tfstate'),'utf8')).includes(cookie));assert.ok(!(await readFile(reportExport,'utf8')).includes('securityScope'))
  // Native civil-time definitions travel without authority and retain history.
  const scheduleFile=join(directory,'schedule.native.json'),schedulePlan=join(directory,'schedule.plan.json')
  const schedule={version:1,id:'synthetic-bifocal-tool-schedule',definition:{name:'Reviewed DST schedule',localDate:'2026-11-01',time:'01:30',timezone:'America/New_York',reportCutoff:'02:00',skipped:'reject',repeated:'both'}}
  await writeFile(scheduleFile,JSON.stringify(schedule))
  assert.equal((await fetch(origin+'/api/operator/schedule-definitions/review',{method:'POST',headers:{Origin:origin,'content-type':'application'+'/'+'json'},body:JSON.stringify({document:schedule,previousVersion:null})})).status,401)
  const foreignSchedule=await context.request.post(origin+'/api/operator/schedule-definitions/review',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{document:schedule,previousVersion:null}});assert.equal(foreignSchedule.status(),401)
  const scheduleReview=await cli('schedule-plan',['--file',scheduleFile,'--plan-file',schedulePlan])
  assert.equal(scheduleReview.resolution.instants.length,2);assert.equal(scheduleReview.productionSends,0);assert.equal(scheduleReview.sourceWrites,0)
  const firstSchedule=await cli('schedule-apply',['--plan-file',schedulePlan,'--approve',scheduleReview.digest]);assert.equal(firstSchedule.version,1)
  const scheduleExport=join(directory,'schedule-export.native.json');await cli('schedule-export',['--schedule',schedule.id,'--output',scheduleExport]);assert.deepEqual(JSON.parse(await readFile(scheduleExport,'utf8')),schedule)
  const setScheduleConfig=async(name)=>{
   const file=join(directory,name+'.plan.json'),review=await cli('schedule-plan',['--file',scheduleFile,'--plan-file',file])
   await writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_schedule_definition:{main:{document:JSON.stringify(schedule),review_digest:review.digest}}}}))
   return {file,review}
  }
  // Use a separate state so published model and dashboard tracking stays intact.
  await setScheduleConfig('schedule-import')
  const scheduleTF=async(args,ok=true)=>tfRun([args[0],'-state=schedule.tfstate',...args.slice(1)],ok)
  await scheduleTF(['import','-input=false','-no-color','bifocal_schedule_definition.main',schedule.id])
  schedule.definition.repeated='later';await writeFile(scheduleFile,JSON.stringify(schedule));await setScheduleConfig('schedule-change')
  await tfRun(['plan','-input=false','-no-color','-state=schedule.tfstate','-out=schedule-stale.tfplan'])
  const concurrentSchedule=await call('/schedules',{id:schedule.id,previousVersion:1,definition:{...schedule.definition,time:'01:45'}})
  await tfRun(['apply','-input=false','-no-color','-state=schedule.tfstate','schedule-stale.tfplan'],false)
  assert.deepEqual(await call('/schedules/'+schedule.id+'/2'),concurrentSchedule,'Stale Terraform schedule apply leaves the concurrent definition unchanged')
  await setScheduleConfig('schedule-current');await tfRun(['plan','-input=false','-no-color','-state=schedule.tfstate','-out=schedule-current.tfplan']);await tfRun(['apply','-input=false','-no-color','-state=schedule.tfstate','schedule-current.tfplan'])
  const currentSchedule=await call('/schedules/'+schedule.id+'/3');assert.equal(currentSchedule.definition.repeated,'later');assert.equal(currentSchedule.definition.dispatcher,'unavailable');assert.equal(currentSchedule.definition.resolution.instants[0].instant,'2026-11-01T06:30:00.000Z')
  // Reapply the earlier portable definition as a new reviewed revision.
  await writeFile(scheduleFile,await readFile(scheduleExport));const restorePlan=join(directory,'schedule-restore.plan.json'),restoreReview=await cli('schedule-plan',['--file',scheduleFile,'--plan-file',restorePlan])
  await cli('schedule-apply',['--plan-file',restorePlan,'--approve',restoreReview.digest]);assert.deepEqual((await call('/schedules/'+schedule.id+'/4')).definition,firstSchedule.definition)
  await cli('schedule-apply',['--plan-file',restorePlan,'--approve',restoreReview.digest],false)
  schedule.definition.repeated='both';await setScheduleConfig('schedule-release')
  await tfRun(['destroy','-auto-approve','-input=false','-no-color','-state=schedule.tfstate']);assert.deepEqual((await call('/schedules/'+schedule.id+'/1')).definition,firstSchedule.definition)
  schedule.id='synthetic-bifocal-terraform-schedule';await writeFile(scheduleFile,JSON.stringify(schedule));await setScheduleConfig('schedule-create')
  await tfRun(['plan','-input=false','-no-color','-state=schedule.tfstate','-out=schedule-create.tfplan']);await tfRun(['apply','-input=false','-no-color','-state=schedule.tfstate','schedule-create.tfplan'])
  const terraformSchedule=await call('/schedules/'+schedule.id+'/1');assert.deepEqual(terraformSchedule.definition,firstSchedule.definition,'Terraform creation uses the same native DST semantics as CLI creation')
  await tfRun(['destroy','-auto-approve','-input=false','-no-color','-state=schedule.tfstate']);assert.deepEqual((await call('/schedules/'+schedule.id+'/1')).definition,firstSchedule.definition)
  const portableSchedule=await readFile(scheduleExport,'utf8'),scheduleState=await readFile(join(directory,'schedule.tfstate.backup'),'utf8')
  for(const content of [portableSchedule,scheduleState]){assert.ok(!content.includes(cookie));assert.ok(!content.includes('createdBy'));assert.ok(!content.includes('explore_activation'))}
  const stateText=await readFile(join(directory,'terraform.tfstate'),'utf8');assert.ok(!stateText.includes(cookie));assert.ok(!stateText.includes('SESSION_SECRET'));assert.ok(!stateText.includes('answer_json'));assert.ok(!stateText.includes('explore_activation'))
  await proveMetricTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf})
  await proveChartTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf})
  await proveBoardTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf})
  await proveRecurringTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf})
  await proveEnvironmentTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf})
  await provePolicyTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf,model:created.modelId,revision:created.revision,viewId:native.views[0].id})
  console.log('Native model tools: real CLI and Terraform create, import, semantic edit, stale saved-plan atomic refusal, explicit staging and production, source preservation, published deletion refusal and coherent rollback passed')
 }finally{await page.close();await rm(directory,{recursive:true,force:true})}
}

/** Native preparation is executable draft work, separate from certification. */
export async function provePreparation({origin,context,page,call,upload,signInMember,proveScreen}){
 const id='synthetic-bifocal-preparation',dataset='synthetic-bifocal-preparation-input',right='synthetic-bifocal-preparation-lookup',more='synthetic-bifocal-preparation-more',duplicate='synthetic-bifocal-preparation-duplicate'
 const csv='item,region,quantity,price,repair\na,West,2,0.10,12\na,West,2,0.10,12\nb,East,3,0.20,bad\nc,,4,,14\n'
 await upload(dataset,csv);await upload(right,'region,label\nWest,Pacific\nEast,Atlantic\n,No region\n');await upload(more,'item,region,quantity,price,repair\nd,West,5,0.30,16\n',false,{columns:{item:'text',region:'text',quantity:'number',price:'number',repair:'text'}});await upload(duplicate,'region,label\nWest,Pacific\nWest,Duplicate\n')
 const numericLookup='synthetic-bifocal-preparation-numeric',numericDuplicates='synthetic-bifocal-preparation-numeric-duplicates'
 await upload(numericLookup,'quantity,label\n2.0,Two\n3.00,Three\n');await upload(numericDuplicates,'id,value\n1,0.10\n1.0,0.100\n')
 const initial=await call('/datasets/'+dataset),path='/preparations/'+id
 const calendar='synthetic-bifocal-preparation-calendar',metricId='synthetic-bifocal-preparation-metric'
 await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Preparation calendar',kind:'fiscal',startMonth:1}})
 const quantityQuery={version:1,dataset,joins:[],filters:[],groupBy:[],measures:[{id:'quantity',op:'sum',column:'quantity',unit:'number',scale:0}],context:{modelVersion:'preparation-impact',metricVersion:'preparation-impact',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const metricDraft=await call('/metrics',{id:metricId,definition:{name:'Published quantity',description:'Quantity before staged deduplication',grain:'item',unit:'number',timezone:'America/New_York',accountingBasis:'accrual',query:quantityQuery}})
 await call('/metrics/'+metricId+'/approve',{revision:1,digest:metricDraft.digest,confirm:'approve',annotation:'Initial review'},200)
 const metricBefore=await call('/metrics/'+metricId+'/run',{})
 const chartDocument={version:1,title:'Published regional quantity',definition:{...quantityQuery,groupBy:['region']},visual:{kind:'bar',dimension:'region',measure:'quantity'}}
 const chartReview=await call('/chart-definitions/review',{document:chartDocument},200),chart=await call('/chart-definitions/create',{document:chartDocument,reviewedDigest:chartReview.digest})
 assert.equal(metricBefore.answer.totals.quantity.value,'11')

 const document={version:1,dataset,steps:[{op:'dedupe'},{op:'calculate',name:'amount',operator:'multiply',left:'quantity',right:'price'},{op:'lookup',dataset:right,left:'region',right:'region',prefix:'lookup-',kind:'left'}]}
 const preview=async(doc,version=null)=>call(path+'/review',{document:doc,previousVersion:version},200)
 const sqlPreview=async(sql,version=null)=>call(path+'/review',{dataset,sql,previousVersion:version},200)
 const review=await preview(document)
 assert.equal(review.compatible,true);assert.equal(review.published,false)
 assert.deepEqual(review.impact.metrics.map(m=>[m.id,m.revision,m.before.quantity.value,m.after.quantity.value,m.publishedChanged]),[[metricId,1,'11','9',false]])
 assert.deepEqual(review.impact.charts.map(c=>[c.id,c.before.quantity.value,c.after.quantity.value,c.publishedChanged]),[[chart.id,'11','9',false]])
 assert.equal((await call('/metrics/'+metricId+'/run',{})).answer.totals.quantity.value,'11')

 assert.deepEqual(review.output.rows,[['a','West','2','0.10','12','0.2','West','Pacific'],['b','East','3','0.20','bad','0.6','East','Atlantic'],['c',null,'4',null,'14',null,null,null]])
 assert.deepEqual(review.diagnostics.map(s=>[s.inputRows,s.outputRows]),[[4,3],[3,3],[3,3]])
 assert.deepEqual(review.output.lineage.amount,[{dataset,revision:initial.revision,column:'quantity'},{dataset,revision:initial.revision,column:'price'}])
 assert.deepEqual(review.output.lineage['lookup-label'].map(r=>[r.dataset,r.column]),[[right,'label'],[dataset,'region'],[right,'region']])
 assert.deepEqual((await sqlPreview(review.sql)).output,review.output,'The SQL form executes the same rows and lineage')
 const editedSQL=review.sql.replace(' * "price"',' + "price"'),edited=await sqlPreview(editedSQL)
 assert.deepEqual(edited.output.rows.map(row=>row[5]),['2.1','3.2',null],'Editing SQL changes executable logic')
 for(const sql of ['SELECT * FROM oa_operators;','DROP TABLE bf_file_tables;','SELECT * FROM INPUT; SELECT * FROM "https://example.test";','SELECT * FROM INPUT -- comment'])await call(path+'/review',{dataset,sql,previousVersion:null},400)
 const inner=await preview({...document,steps:[{op:'join',dataset:right,left:'region',right:'region',prefix:'joined-',kind:'inner'}]})
 assert.equal(inner.output.rows.length,3);assert.deepEqual((await sqlPreview(inner.sql)).output,inner.output)
 const fanout=await preview({...document,steps:[{op:'lookup',dataset:duplicate,left:'region',right:'region',prefix:'joined-',kind:'left'}]})
 assert.deepEqual(fanout.error,{step:1,operation:'lookup',code:'preparation_join_fanout_refused'});assert.equal(fanout.output,null)
 const union=await preview({...document,steps:[{op:'union',dataset:more}]});assert.deepEqual(union.output.rows.map(row=>row[0]),['a','a','b','c','d']);assert.equal(union.output.lineage.item.length,2);assert.deepEqual((await sqlPreview(union.sql)).output,union.output)
 const numeric=await preview({...document,steps:[{op:'lookup',dataset:numericLookup,left:'quantity',right:'quantity',prefix:'numeric-',kind:'left'}]});assert.deepEqual(numeric.output.rows.map(row=>row.at(-1)),['Two','Two','Three',null],'Typed numeric keys compare values rather than decimal spelling')
 const numericDedupe=await preview({version:1,dataset:numericDuplicates,steps:[{op:'dedupe'}]});assert.deepEqual(numericDedupe.output.rows,[['1','0.10']])
 const preciseDataset='synthetic-bifocal-preparation-precise'
 await upload(preciseDataset,'left,right\n0.000000059604644775390625,0.5\n0.000000059604644775390625,0.5\n')
 const precise={version:1,dataset:preciseDataset,steps:[{op:'calculate',name:'product',operator:'multiply',left:'left',right:'right'},{op:'dedupe'},{op:'cast',column:'product',type:'number'},{op:'calculate',name:'halved',operator:'multiply',left:'product',right:'right'}]}
 const preciseResult=await preview(precise)
 assert.equal(preciseResult.compatible,true,JSON.stringify(preciseResult.error))
 assert.deepEqual(preciseResult.output.rows,[['0.000000059604644775390625','0.5','0.0000000298023223876953125','0.00000001490116119384765625']])
 assert.deepEqual((await call(path+'/review',{dataset:preciseDataset,sql:preciseResult.sql,previousVersion:null},200)).output,preciseResult.output)
 const badUnion=await preview({...document,steps:[{op:'union',dataset:right}]});assert.equal(badUnion.error.code,'preparation_union_schema_mismatch')
 const cast=await preview({...document,steps:[{op:'cast',column:'repair',type:'number'}]})
 assert.deepEqual(cast.error,{step:1,operation:'cast',code:'preparation_type_conversion_failed'});assert.equal(cast.output,null)
 assert.equal(cast.impact.metrics[0].after,null);assert.equal(cast.impact.metrics[0].error.code,'preparation_type_conversion_failed')
 const blockedChart=await call('/charts/'+chart.id)
 assert.deepEqual(blockedChart.answer,chart.answer);assert.deepEqual(blockedChart.preparationErrors,[{preparationId:id,step:1,operation:'cast',code:'preparation_type_conversion_failed',publishedChanged:false}])
 await page.goto(origin+'/app/charts/'+chart.id);assert.match(await page.getByRole('alert').innerText(),/step 1/);assert.equal(await page.getByRole('alert').getAttribute('data-code'),'preparation_type_conversion_failed');await proveScreen('preparation-affected-chart')

 const validCast=await preview({...document,steps:[{op:'cast',column:'quantity',type:'text'}]});assert.equal(validCast.output.columns[2].type,'text');assert.deepEqual((await sqlPreview(validCast.sql)).output,validCast.output)
 assert.deepEqual((await call('/charts/'+chart.id)).preparationErrors,[],'A repaired review clears the failed-draft warning')
 const unpivot=await preview({...document,steps:[{op:'dedupe'},{op:'unpivot',columns:['quantity','price'],name:'field',value:'value'}]})
 assert.deepEqual(unpivot.output.rows.map(row=>row.slice(-2)),[['quantity','2'],['price','0.10'],['quantity','3'],['price','0.20'],['quantity','4'],['price',null]])
 assert.deepEqual((await sqlPreview(unpivot.sql)).output,unpivot.output)
 const pivotDoc={...document,steps:[...document.steps.slice(0,1),{op:'unpivot',columns:['quantity','price'],name:'field',value:'value'},{op:'pivot',groupBy:['item','region','repair'],column:'field',value:'value',values:['quantity','price']}]}
 const pivot=await preview(pivotDoc);assert.deepEqual(pivot.output.rows,[['a','West','12','2','0.10'],['b','East','bad','3','0.20'],['c',null,'14','4',null]]);assert.deepEqual((await sqlPreview(pivot.sql)).output,pivot.output)
 const duplicatePivot=await preview({...pivotDoc,steps:pivotDoc.steps.slice(1)});assert.equal(duplicatePivot.error.code,'preparation_pivot_duplicate_cell')
 const missingDomain=structuredClone(pivotDoc);missingDomain.steps[2].values=['quantity'];assert.equal((await preview(missingDomain)).error.code,'preparation_pivot_domain_mismatch')
 await call(path+'/save',{document,previousVersion:null,reviewedDigest:'stale'},409)
 const v1=await call(path+'/save',{document,previousVersion:null,reviewedDigest:review.digest});assert.equal(v1.version,1)
 await call(path+'/save',{document,previousVersion:null,reviewedDigest:review.digest},409)
 const failed=await preview({...document,steps:[{op:'cast',column:'repair',type:'number'}]},1)
 await call(path+'/save',{document:{...document,steps:[{op:'cast',column:'repair',type:'number'}]},previousVersion:1,reviewedDigest:failed.digest},409)
 assert.equal((await call(path)).version,1,'A failed type conversion leaves the working revision intact')
 const changed={...document,steps:[{op:'dedupe'}]},r2=await preview(changed,1),v2=await call(path+'/save',{document:changed,previousVersion:1,reviewedDigest:r2.digest});assert.equal(v2.version,2)
 const restoreReview=await preview(document,2),restored=await call(path+'/restore',{restoreVersion:1,previousVersion:2,reviewedDigest:restoreReview.digest});assert.equal(restored.version,3);assert.deepEqual(restored.output,review.output)
 const history=await call(path);assert.deepEqual(history.revisions.map(r=>r.version),[1,2,3]);assert.deepEqual(history.revisions[0].lineage,{columns:review.output.columns,lineage:review.output.lineage});assert.deepEqual(history.revisions[2].lineage,history.revisions[0].lineage);assert.deepEqual(await call('/datasets/'+dataset),initial,'Preparing and restoring never changes published input data')
 // The owner edits the same executable draft through the installed browser.
 const browserID='synthetic-bifocal-preparation-browser'
 await page.goto(origin+'/app/import#preparation')
 await page.getByLabel('Preparation ID',{exact:true}).fill(browserID);await page.getByLabel('Source dataset ID',{exact:true}).fill(dataset)
 await page.getByRole('button',{name:'Inspect source columns',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Current source schema loaded'}).waitFor()
 assert.match(await page.getByRole('table',{name:'Actual source columns',exact:true}).innerText(),/quantity/)
 assert.equal(await page.evaluate(()=>document.querySelector('#prep-source').getBoundingClientRect().bottom<=document.querySelector('#prep-version').getBoundingClientRect().top),true,'The source schema and draft version do not overlap')
 await page.getByRole('button',{name:'Add step',exact:true}).click();await page.getByLabel('Add operation',{exact:true}).selectOption('calculate');await page.getByRole('button',{name:'Add step',exact:true}).click()
 await page.getByLabel('Step 2: New column name',{exact:true}).fill('amount');await page.getByLabel('Step 2: Left numeric column',{exact:true}).fill('quantity');await page.getByLabel('Step 2: Arithmetic',{exact:true}).selectOption('multiply');await page.getByLabel('Step 2: Right numeric column',{exact:true}).fill('price')
 const browserRows=()=>page.getByRole('table',{name:'Reviewed output rows',exact:true}).locator('tbody tr').evaluateAll(rows=>rows.map(row=>[...row.cells].map(cell=>cell.textContent)))
 await page.getByRole('button',{name:'Review preparation',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Draft reviewed'}).waitFor()
 assert.deepEqual(await browserRows(),[['a','West','2','0.10','12','0.2'],['b','East','3','0.20','bad','0.6'],['c','NULL','4','NULL','14','NULL']])
 const lineage=await page.getByRole('table',{name:'Output schema and column lineage',exact:true}).innerText();assert.ok(lineage.includes(initial.revision));assert.match(lineage,/quantity/);assert.match(lineage,/price/)
 const metricImpactText=await page.getByRole('table',{name:'Certified metric impact',exact:true}).innerText();assert.match(metricImpactText,/quantity: 11/);assert.match(metricImpactText,/quantity: 9/);assert.match(await page.getByRole('table',{name:'Affected charts',exact:true}).innerText(),/Published regional quantity/)
 await proveScreen('preparation-visual-review')
 await page.getByLabel('I reviewed these exact rows, errors, source revisions and digest',{exact:true}).check();await page.getByRole('button',{name:'Save reviewed draft',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Draft saved as revision 1'}).waitFor()
 await page.getByLabel('Editing form',{exact:true}).selectOption('sql');const originalSQL=await page.getByLabel('SQL statements',{exact:true}).inputValue()
 assert.match(originalSQL,/SELECT DISTINCT/);assert.match(originalSQL,/quantity" \* "price/)
 await page.getByLabel('SQL statements',{exact:true}).fill(originalSQL.replace(' * "price"',' + "price"'))
 await page.getByRole('button',{name:'Review preparation',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Draft reviewed'}).waitFor();assert.deepEqual((await browserRows()).map(row=>row[5]),['2.1','3.2','NULL'])
 await proveScreen('preparation-sql-review')
 await page.getByLabel('I reviewed these exact rows, errors, source revisions and digest',{exact:true}).check();await page.getByRole('button',{name:'Save reviewed draft',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Draft saved as revision 2'}).waitFor()
 await page.getByLabel('SQL statements',{exact:true}).fill('SELECT * REPLACE (CAST("repair" AS NUMBER) AS "repair") FROM INPUT;')
 await page.getByRole('button',{name:'Review preparation',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Draft blocked at step 1'}).waitFor()
 assert.equal(await page.getByRole('table',{name:'Preparation validation error',exact:true}).getAttribute('data-code'),'preparation_type_conversion_failed');assert.equal(await page.getByRole('button',{name:'Save reviewed draft',exact:true}).isDisabled(),true)
 assert.equal((await call('/preparations/'+browserID)).version,2)
 await proveScreen('preparation-conversion-error')
 await page.goto(origin+'/app/charts/'+chart.id);assert.equal(await page.getByRole('alert').getAttribute('data-code'),'preparation_type_conversion_failed');assert.equal((await call('/metrics/'+metricId+'/run',{})).answer.totals.quantity.value,'11');await proveScreen('preparation-browser-affected-chart')
 await page.goto(origin+'/app/import#preparation');await page.getByLabel('Preparation ID',{exact:true}).fill(browserID);await page.getByRole('button',{name:'Load saved preparation',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Current saved draft loaded'}).waitFor()

 await page.getByLabel('Saved revision',{exact:true}).selectOption('1');await page.getByRole('button',{name:'Review selected revision for restore',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Prior revision reviewed'}).waitFor()
 assert.deepEqual((await browserRows()).map(row=>row[5]),['0.2','0.6','NULL'])
 await page.getByLabel('I reviewed these exact rows, errors, source revisions and digest',{exact:true}).check();await page.getByRole('button',{name:'Restore reviewed draft revision',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Prior draft restored as revision 3'}).waitFor()
 await page.getByRole('button',{name:'Load saved preparation',exact:true}).click();await page.locator('#prep-status').filter({hasText:'Current saved draft loaded'}).waitFor();assert.equal(await page.getByLabel('Step 2: Arithmetic',{exact:true}).inputValue(),'multiply')
 assert.deepEqual((await call('/preparations/'+browserID)).revisions.map(r=>r.version),[1,2,3]);assert.deepEqual(await call('/datasets/'+dataset),initial)
 await proveScreen('preparation-restored')
 assert.equal((await context.request.post(origin+'/api/operator'+path+'/review',{headers:{Origin:'https://foreign.example.test'},data:{document,previousVersion:3}})).status(),401)
 const member=await context.browser().newContext({ignoreHTTPSErrors:true})
 try{
  const email='synthetic-bifocal-preparation-member@example.test'
  assert.equal((await member.request.get(origin+'/api/operator'+path)).status(),401)
  assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email,displayName:'Preparation member',role:'member'}})).status(),202)
  await signInMember(member,email)
  const session=await member.request.get(origin+'/auth/session');assert.equal(session.status(),200);const identity=await session.json();assert.equal(identity.kind,'native');assert.equal(identity.operator.role,'member');assert.equal(identity.operator.email,email)
  assert.equal((await member.request.get(origin+'/api/operator'+path)).status(),401)
  for(const action of ['review','save','restore'])assert.equal((await member.request.post(origin+'/api/operator'+path+'/'+action,{headers:{Origin:origin},data:{document,previousVersion:3,restoreVersion:1,reviewedDigest:restoreReview.digest}})).status(),401)
 }finally{await member.close()}
 const stale=await preview(document,3)
 await preview({...document,steps:[{op:'cast',column:'repair',type:'number'}]},3);assert.equal((await call('/charts/'+chart.id)).preparationErrors.length,1)
 await upload(dataset,csv.replace('2,0.10','2,0.11'),true);assert.deepEqual((await call('/charts/'+chart.id)).preparationErrors,[],'Obsolete draft warnings disappear when a pinned source changes')
 await call(path+'/save',{document,previousVersion:3,reviewedDigest:stale.digest},409)
 const currentRestoreReview=await preview(document,3)
 await call(path+'/restore',{restoreVersion:1,previousVersion:3,reviewedDigest:currentRestoreReview.digest},409)
 const current=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
 await call('/charts/'+chart.id,undefined,404)
 await call(path,undefined,404);await call(path+'/restore',{restoreVersion:1,previousVersion:null,reviewedDigest:currentRestoreReview.digest},404)
 console.log('Native preparation: executable graph and edited SQL, exact values, explicit join and pivot refusals, lineage, reviewed revisions, non-owner isolation, source drift and erasure passed')
}

/** Emitted production Worker and native mail confirmation, with only the
 * official SendGrid Mail Send v3 network boundary replaced. */
export async function proveNativePreparation({imports=false}={}){
 const {createRequire}=await import('node:module'),{readdir,mkdir}=await import('node:fs/promises'),{resolve}=await import('node:path'),{createServer}=await import('node:net'),{chromium}=await import('@playwright/test')
 const persist=await mkdtemp(join(tmpdir(),'bifocal-native-preparation-')),socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
 const origin='https://127.0.0.1:'+port,headers={Origin:origin},messages=[]
 const require=createRequire(import.meta.url),wrangler=createRequire(require.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=wrangler('miniflare')
 let mf,browser
 try{
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json'],{env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},stdio:'pipe'})
  const modules=[{type:'ESModule',path:resolve('dist/server/index.js')},...(await readdir('dist/server/assets')).filter(n=>n.endsWith('.js')).map(n=>({type:'ESModule',path:resolve('dist/server/assets',n)}))]
  mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-preparation-provider',host:'127.0.0.1',port,https:true,inspectorPort:0,cf:false,modulesRoot:resolve('./dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('./dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(persist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'false',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),SETUP_TOKEN:'synthetic-bifocal-3'.repeat(3),MAIL_PROVIDER:'sendgrid',MAIL_FROM:'synthetic-bifocal-2@example.test',MAIL_API_KEY:'synthetic-bifocal-92'},outboundService:async request=>{
   const url=new URL(request.url);assert.equal(url.origin,'https://api.sendgrid.com');assert.equal(url.pathname,'/v3/mail/send');assert.equal(request.method,'POST');assert.equal(request.headers.has('cookie'),false)
   messages.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-bifocal-'+messages.length}})
  }}));await mf.ready
  browser=await chromium.launch({headless:true,...process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{},args:['--use-mock-keychain','--password-store=basic','--no-sandbox']})
  const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage()
  const call=async(path,data,expected=data===undefined?200:201)=>{const r=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers,...data===undefined?{}:{data}});assert.equal(r.status(),expected,await r.text());return r.json()}
  const bootstrap=await context.request.post(origin+'/auth/bootstrap',{headers,data:{token:'synthetic-bifocal-3'.repeat(3),displayName:'Native preparation owner',returnTo:'/app'},maxRedirects:0});assert.equal(bootstrap.status(),303,await bootstrap.text())
  await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])
  const upload=async(dataset,data,catchup=false,options={})=>{
   const input={version:1,datasetId:dataset,filename:'synthetic-bifocal-1.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:null,formulaTreatment:'literal-text',data,...options},bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex')
   const post=async(action,data)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers:{...headers,'X-Import-Dataset':dataset},data});assert.equal(r.status(),200,await r.text());return r.json()}
   const u=await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')}),p=await post('plan',{uploadId:u.uploadId,...catchup?{catchup:true}:{}})
   for(let i=0;i<20;i++){const a=await post('apply',{planId:p.planId,reviewedFingerprint:p.fingerprint});if(a.job.state==='completed')return p}assert.fail('Shared source apply did not complete')
  }
  const signInMember=async(member,email)=>{
   const message=messages.find(m=>m.personalizations[0].to[0].email===email);assert.ok(message,'The real invitation reaches the mail boundary')
   const text=message.content.find(c=>c.type===['text','plain'].join('/')).value,link=text.match(/https:\/\/\S+/)?.[0];assert.ok(link);assert.equal(new URL(link).origin,origin)
   const memberPage=await member.newPage();await memberPage.goto(link);await Promise.all([memberPage.waitForURL(origin+'/app'),memberPage.getByRole('button',{name:'Confirm',exact:true}).click()]);await memberPage.close()
  }
  const proveScreen=async(label)=>{
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow at '+width);assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0,'All controls have visible text');if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png'),fullPage:true});if(await page.locator('#prep-review').isVisible())await page.locator('#prep-review').screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-detail-'+width+'.png')})}}
  }
  await provePreparation({origin,context,page,call,upload,signInMember,proveScreen})
  await proveDBTExecution({origin,context,call,upload,signInMember})
  if(imports){await call('/calendars',{id:'synthetic-bifocal-july',previousVersion:null,definition:{name:'July fiscal year',kind:'fiscal',startMonth:7}});await proveModelImports({origin,context,page,call,upload,proveScreen,signInMember})}
  await context.close()
 }finally{await browser?.close();await mf?.dispose();await rm(persist,{recursive:true,force:true})}
}
