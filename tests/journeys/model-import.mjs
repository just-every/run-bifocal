import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {dump} from 'js-yaml'
import {unzipSync,strFromU8,zipSync,strToU8} from 'fflate'
import {modelProjectFixtures} from './model-project-fixtures.mjs'
import {proveMetricTooling} from './metric-tooling.mjs'
import {proveChartTooling} from './chart-tooling.mjs'
import {provePolicyTooling} from './policy-tooling.mjs'
import {proveBoardTooling} from './board-tooling.mjs'
import {proveRecurringTooling} from './recurring-tooling.mjs'
import {proveEnvironmentTooling} from './environment-tooling.mjs'

export async function proveModelImports({origin,context,page,call,upload,proveScreen}){
 const dataset='synthetic-bifocal-model-imports',csv='invoice,region,revenue,internal-note\n1,West,$10.01,Restricted source detail\n2,East,$20.02,Other source detail\n3,West,-$0.03,Return detail\n4,,,Missing revenue detail\n'
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
  assert.ok(plan.project.report.issues.some(i=>i.code==='dbt_resource_execution_pending'&&i.object===model.id));assert.deepEqual(plan.project.sources.map(s=>s.id),[dataset])
  await apply(input.projectId,plan)
  const imported=await call('/model-imports/'+input.projectId);assert.deepEqual(imported.report.project.resources,inventory);assert.deepEqual(imported.input.files,input.files)
  await call('/model-authoring/review',{document:dump(saved[0].imported.definition),importProject:input.projectId,importRevision:imported.revision},409)
  const edited=structuredClone(input);edited.files[0].content+='\n';const replacement=await prepare(edited,true);await apply(input.projectId,replacement)
  const revised=await call('/model-imports/'+input.projectId);assert.notEqual(revised.revision,imported.revision);assert.deepEqual(revised.report.project.resources.map(r=>r.dependencies),inventory.map(r=>r.dependencies))
  await post(input.projectId,'undo',{planId:replacement.planId});assert.equal((await call('/model-imports/'+input.projectId)).revision,imported.revision)
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
   if(format==='metabase'){const card=JSON.parse(input.files[0].content);if(problem==='filter')card.dataset_query.query.filter=['=', ['field',2,null],'West'];else if(problem==='connection'){const database=JSON.parse(input.files[2].content);database.details={ssl:true};input.files[2].content=JSON.stringify(database)}else card.dataset_query.query.aggregation[0]=['sum',['+', ['field',3,null],1]];input.files[0].content=JSON.stringify(card)}
   else input.files[0].content=problem==='connection'?input.files[0].content.replace('class="textscan"','class="textscan" directory="."'):problem==='filter'?input.files[0].content.replace('</datasource>','<filter column="[region]"/></datasource>'):input.files[0].content.replace('SUM([revenue])','WINDOW_SUM(SUM([revenue]))')
   const plan=await prepare(input);assert.equal(plan.project.report.compatible,false);assert.ok(plan.project.report.issues.some(i=>problem!=='expression'?i.code==='unsupported_property'||i.code==='unsupported_tableau_property'||i.code==='metabase_execution_pending':i.code==='metabase_execution_pending'||i.code==='unsupported_tableau_calculation'))
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
 try{execFileSync('git',['init','-q',git]);execFileSync('git',['-C',git,'config','user.name','Run Edit Run fleet']);execFileSync('git',['-C',git,'config','user.email','fleet@runeditrun.com']);await writeFile(join(git,'model.yaml'),dump(saved[0].imported.definition));execFileSync('git',['-C',git,'add','model.yaml']);execFileSync('env',['GIT_AUTHOR_NAME=Run Edit Run fleet','GIT_AUTHOR_EMAIL=fleet@runeditrun.com','GIT_COMMITTER_NAME=Run Edit Run fleet','GIT_COMMITTER_EMAIL=fleet@runeditrun.com','git','-C',git,'commit','-qm','Author reviewed fiscal model']);const tracked=await readFile(join(git,'model.yaml'),'utf8');await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor();await page.getByLabel('Open native model YAML').setInputFiles(join(git,'model.yaml'));await page.getByRole('status').filter({hasText:'Native YAML loaded'}).waitFor();assert.equal(await page.getByLabel('Model document').inputValue(),tracked);await page.getByRole('button',{name:'Review model',exact:true}).click();await page.getByRole('status').filter({hasText:'Review complete'}).waitFor();await proveScreen('model-git-review')}finally{await rm(git,{recursive:true,force:true})}
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
  const outbox=await(await context.request.get(origin+'/__model-mail')).json(),message=outbox.find(m=>m.to.includes(email));assert.ok(message)
  const link=message.text.match(/https?:[^\s]+/)[0],token=new URL(link).searchParams.get('token');assert.ok(token)
  const reader=await context.browser().newContext()
  try{
   const confirmed=await reader.request.post(origin+'/auth/confirm',{headers:mailHeaders,data:{token},maxRedirects:0});assert.equal(confirmed.status(),303,await confirmed.text())
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
 await call('/model-imports/'+original.input.projectId+'/export',{reviewedRevision:original.imported.revision},409)
 assert.equal((await fetch(origin+'/api/operator/model-imports/'+projects[0].projectId)).status,401)
 assert.equal((await fetch(origin+'/api/operator/model-imports/'+projects[0].projectId+'/export',{method:'POST',headers:{Origin:origin,'content-type':'application'+'/'+'json'},body:JSON.stringify({reviewedRevision:original.imported.revision})})).status,401)
 assert.equal((await context.request.post(origin+'/api/operator/model-imports/'+original.input.projectId+'/export',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{reviewedRevision:original.imported.revision}})).status(),401)
 const foreign=await context.request.post(origin+'/api/operator/import/plan',{headers:{Origin:'https://synthetic-bifocal.invalid','X-Import-Kind':'model','X-Import-Dataset':projects[0].projectId},data:{uploadId:'synthetic-bifocal-denied'}});assert.equal(foreign.status(),401)
 await call('/model-authoring/review',{document:dump(original.imported.definition),importProject:projects[0].projectId,importRevision:'stale'},409)
 const source=await call('/datasets/'+dataset);const erased=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200);assert.ok(erased.modelProjects.length>=projects.length)
 for(const item of saved){const originals=await context.request.get(origin+'/api/operator/import/original/'+item.plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':item.input.projectId}});assert.equal(originals.status(),200,await originals.text());assert.ok((await originals.json()).originals.every(o=>o.original.status==='unavailable'));await call('/model-imports/'+item.input.projectId,undefined,404);await call('/model-imports/'+item.input.projectId+'/export',{reviewedRevision:item.imported.revision},404);await call('/models/'+item.model.modelId,undefined,404);await call('/queries/'+item.answer.queryId,undefined,404);await call('/reports/'+item.report.id,undefined,404);await post(item.input.projectId,'apply',{planId:item.plan.planId,reviewedFingerprint:item.plan.fingerprint},410)}
 for(const [input,plan] of [[unsupported,blocked],[cancelled,cancelledPlan],[stale,stalePlan]]){await call('/model-imports/'+input.projectId,undefined,404);await post(input.projectId,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410)}
 for(const {input,plan} of dbtProjects){await call('/model-imports/'+input.projectId,undefined,404);const originals=await context.request.get(origin+'/api/operator/import/original/'+plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':input.projectId}});assert.equal(originals.status(),200);assert.ok((await originals.json()).originals.every(o=>o.original.status==='unavailable'));await post(input.projectId,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410)}
 console.log('Source model imports: executable LookML, dbt Semantic Layer, MetricFlow, TMDL, Cube, Metabase aggregates and Tableau source measures, plus inert dbt Core, Cloud and PBIP inventories; shared review, exact source SQL parity, native publication, governed exploration and exports, git YAML, explicit gaps, stale refusal and full source withdrawal passed')
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
