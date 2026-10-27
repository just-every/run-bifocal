import assert from 'node:assert/strict'
import {dump} from 'js-yaml'

// Extends the existing model import journey through the same public doors.
export async function proveDBTPredicates({core,resolvedManifest,resolvedCloud,prepare,apply,call,upload,post,page,origin,proveScreen}) {
 const dataset='synthetic-bifocal-dbt-predicates'
 await upload(dataset,"row,invoice,region,revenue\n1,1,West,$10.01\n2,2,East,$20.02\n3,3,West,-$0.03\n4,4,,$7.00\n5,,East,$9.00\n6,2,Excluded,$5.00\n7,5,West,\n8,6,West AND O'Brien,$1.23\n")
 const stage="select row, invoice, region as territory, revenue as gross from {{ source('raw','invoices') }} where region <> 'East'"
 const sales="select row, invoice, territory as region, gross as net from {{ ref('staging') }} where territory = 'West' AND gross >= -0.03 AND gross <= 10.01"
 const sourceInput=structuredClone(core);sourceInput.projectId='synthetic-bifocal-dbt-filter-core';sourceInput.bindings.sales.dataset=dataset;sourceInput.bindings.sales.grain=['row']
 sourceInput.files.find(f=>f.path==='models/staging.sql').content=stage;sourceInput.files.find(f=>f.path==='models/sales.sql').content=sales
 const manifest=structuredClone(resolvedManifest)
 manifest.nodes['model.synthetic_bifocal.staging'].raw_code=stage;manifest.nodes['model.synthetic_bifocal.sales'].raw_code=sales
 const cloud={...structuredClone(resolvedCloud),projectId:'synthetic-bifocal-dbt-filter-cloud',bindings:sourceInput.bindings,files:[{path:'target/manifest.json',content:JSON.stringify(manifest)}]}
 const expectedFilters=[{column:'region',op:'ne',value:null},{column:'region',op:'ne',value:'East'},{column:'region',op:'eq',value:'West'},{column:'revenue',op:'gte',value:'-0.03'},{column:'revenue',op:'lte',value:'10.01'}]
 for(const input of [sourceInput,cloud]){
  const plan=await prepare(input);assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report.issues))
  const resources=plan.project.report.project.resources
  assert.deepEqual(resources.filter(r=>r.kind==='model').map(r=>[r.name,r.definition.translation.bindings[0].rows]).sort(),[['sales',2],['staging',5]])
  assert.deepEqual(resources.filter(r=>r.kind==='test').map(r=>[r.definition.translation.test,r.definition.translation.results[0].rows,r.definition.translation.results[0].failures]),[['not_null',2,0],['unique',2,0]])
  await apply(input.projectId,plan);const imported=await call('/model-imports/'+input.projectId)
  const exported=await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:imported.revision},200)
  assert.deepEqual(exported.definition.views[0].query.filters,expectedFilters);assert.equal(exported.sources[0].revision,(await call('/datasets/'+dataset)).revision)
  const body={document:dump(exported.definition),importProject:input.projectId,importRevision:imported.revision},review=await call('/model-authoring/review',body,200)
  assert.equal(review.impacts[0].answer.totals['revenue-sum'].value,'9.98');assert.equal(review.impacts[0].answer.filteredRows,2);assert.equal(review.impacts[0].answer.totals['unique-regions'].value,'1')
  const wider=structuredClone(exported.definition);wider.views[0].query.filters=[];await call('/model-authoring/review',{...body,document:dump(wider)},409)
  const model=await call('/model-authoring/create',{...body,reviewedDigest:review.digest}),path='/models/'+model.modelId+'/branches/'+model.branchId
  const validation=await call(path+'/validate',{},200);await call(path+'/approve',{digest:validation.digest},200);await call(path+'/promote',{environment:'staging',digest:validation.digest},200);await call(path+'/promote',{environment:'production',digest:validation.digest},200)
  const answer=await call('/models/'+model.modelId+'/production/run',{viewId:'sales'});assert.equal(answer.answer.totals['revenue-sum'].value,'9.98')
  const detail=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['invoice'],filters:[]})
  assert.deepEqual(detail.answer.rows.map(row=>[row.dimensions[0],row.values['revenue-sum'].value]),[['1','10.01'],['3','-0.03']])
  const east=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:[],filters:[{column:'region',op:'eq',value:'East'}]})
  assert.equal(east.answer.filteredRows,0);assert.equal(east.answer.totals['revenue-sum'].value,null)
  await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();await page.getByText('Full source compatibility report',{exact:true}).click();assert.match(await page.locator('#model-import-current pre').innerText(),/"rows": 2/);await page.getByText('Full source compatibility report',{exact:true}).click();await proveScreen(input===sourceInput?'dbt-filter-core':'dbt-filter-cloud')
  // Shared Undo must restore both executable filters and their quality scope.
  if(input===sourceInput){const changed=structuredClone(input);changed.files.find(f=>f.path==='models/sales.sql').content=sales.replace("'West'","'Absent'");const next=await prepare(changed,true);await apply(input.projectId,next);assert.equal(next.project.report.project.resources.find(r=>r.name==='sales'&&r.kind==='model').definition.translation.bindings[0].rows,0);await post(input.projectId,'undo',{planId:next.planId});assert.equal((await call('/model-imports/'+input.projectId)).revision,imported.revision)}
 }
 for(const [name,where,rows,total] of [['null','region IS NULL',1,'7.00'],['not-null','region IS NOT NULL',7,'45.23'],['quoted',"region = 'West AND O''Brien'",1,'1.23'],['numeric','revenue = 10.010',1,'10.01']]){
  const input=structuredClone(sourceInput);input.projectId='synthetic-bifocal-dbt-filter-'+name;input.files.find(f=>f.path==='models/staging.sql').content="select row, invoice, region, revenue from {{ source('raw','invoices') }}"
  input.files.find(f=>f.path==='models/sales.sql').content="select row, invoice, region, revenue as net from {{ ref('staging') }} where "+where
  // This branch exercises predicates independently of the quality failure on
  // the intentionally duplicated and null source invoice values.
  input.files[1].content=input.files[1].content.replace('tests: [not_null, unique]','tests: []')
  const plan=await prepare(input);assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report.issues));await apply(input.projectId,plan)
  const current=await call('/model-imports/'+input.projectId),review=await call('/model-authoring/review',{document:dump(current.definition),importProject:input.projectId,importRevision:current.revision},200)
  assert.equal(review.compatible,true);assert.equal(review.impacts[0].answer.filteredRows,rows);assert.equal(review.impacts[0].answer.totals['revenue-sum'].value,total)
 }
 for(const [name,where] of [['or',"territory = 'West' OR territory = 'East'"],['null-equality','gross = NULL'],['type',"gross = '10.01'"],['missing',"missing = 'West'"],['trailing',"territory = 'West' AND"],['statement',"territory = 'West'; select invoice from other"],['comment',"territory = 'West' -- ignored"],['expression','gross + 1 = 2']]){
  const input=structuredClone(sourceInput);input.projectId='synthetic-bifocal-dbt-filter-refused-'+name;input.files.find(f=>f.path==='models/sales.sql').content=sales.slice(0,sales.indexOf(' where '))+' where '+where
  const plan=await prepare(input);assert.equal(plan.project.report.compatible,false,name);assert.ok(plan.project.report.issues.some(i=>['unsupported_dbt_sql','dbt_predicate_binding_mismatch'].includes(i.code)),name)
  await apply(input.projectId,plan);const current=await call('/model-imports/'+input.projectId);await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:current.revision},409)
  await call('/model-authoring/review',{document:dump(current.definition),importProject:input.projectId,importRevision:current.revision},409)
 }
 const source=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200)
 for(const input of [sourceInput,cloud])await call('/model-imports/'+input.projectId,undefined,404)
 console.log('dbt chained predicates: exact filtered totals and quality scope, nulls, aliases, literals, refusal, publication, Undo and source erasure passed')
}
