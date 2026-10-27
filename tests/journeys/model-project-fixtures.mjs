// Original synthetic source files in the documented source languages. Expected
// values are calculated separately from these declarations by the journey.
const lookml=`view: sales {
 sql_table_name: invoices ;;
 dimension: invoice { type: number primary_key: yes sql: \${TABLE}.invoice ;; }
 dimension: region { type: string sql: \${TABLE}.region ;; }
 dimension: revenue { type: number sql: \${TABLE}.revenue ;; }
 measure: revenue_sum { type: sum sql: \${TABLE}.revenue ;; }
 measure: unique_regions { type: count_distinct sql: \${TABLE}.region ;; }
}
explore: sales {}`
const semantic=`semantic_models:
  - name: sales
    model: ref('invoices')
    entities:
      - name: invoice
        type: primary
        expr: invoice
    dimensions:
      - name: region
        type: categorical
        expr: region
    measures:
      - name: revenue_sum
        agg: sum
        expr: revenue
      - name: unique_regions
        agg: count_distinct
        expr: region
`
const cube=`cubes:
  - name: sales
    sql_table: invoices
    dimensions:
      - name: invoice
        sql: invoice
        type: number
        primary_key: true
      - name: region
        sql: region
        type: string
    measures:
      - name: revenue_sum
        sql: revenue
        type: sum
      - name: unique_regions
        sql: region
        type: count_distinct
`
const tmdl=`table Sales
    column Invoice
        dataType: int64
        sourceColumn: invoice
    column Revenue
        dataType: decimal
        sourceColumn: revenue
    column Region
        dataType: string
        sourceColumn: region
    measure RevenueSum = SUM('Sales'[Revenue])
`
export function modelProjectFixtures(dataset,calendar){
 return ['lookml','dbt','metricflow','tmdl','cube'].map(format=>{
  const name=format==='tmdl'?'Sales':'sales',revenue=format==='tmdl'?'RevenueSum':'revenue_sum'
  return {version:1,projectId:'synthetic-bifocal-'+format,format,files:[{path:format==='lookml'?'sales.model.lkml':format==='tmdl'?'Sales.tmdl':'sales.yaml',content:format==='lookml'?lookml:format==='tmdl'?tmdl:format==='cube'?cube:semantic}],bindings:{[name]:{dataset,grain:['invoice']}},formats:{[name+'.'+revenue]:{unit:'money',scale:2,sourceCurrency:'USD'},...(format==='tmdl'?{}:{[name+'.unique_regions']:{unit:'count',scale:0}})},context:{modelVersion:'source-model',metricVersion:'source-measures',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 })
}

/** Bounded dbt execution through the same owner HTTP door as preparations.
 * Original project files enter through the reviewed shared import door. */
export async function proveDBTExecution({origin,context,call,upload,signInMember}){
 const {default:assert}=await import('node:assert/strict'),{createHash}=await import('node:crypto')
 const dataset='synthetic-bifocal-90',projectId='synthetic-bifocal-91',path='/preparations/synthetic-bifocal-94/dbt-review'
 const csv='id,quantity,price,repair\n1,2,0.10,12\n2,3,0.20,13\n3,4,,14\n'
 const sourceOptions={columns:{id:'number',quantity:'number',price:'number',repair:'text'}}
 await upload(dataset,csv,false,sourceOptions)
 const original=await call('/datasets/'+dataset)
 const input={...modelProjectFixtures(dataset,'synthetic-bifocal-july')[1],projectId,bindings:{a_sales:{dataset,grain:['id']},z_stage:{dataset,grain:['id']}},formats:{},files:[
  {path:'dbt_project.yml',content:'name: synthetic_bifocal_91\nversion: 1.0.0\nconfig-version: 2\n'},
  {path:'models/schema.yml',content:'version: 2\nmodels:\n  - name: a_sales\n    columns:\n      - name: id\n        tests: [not_null, unique]\nsources:\n  - name: raw\n    tables:\n      - name: invoices\n'},
  {path:'models/a_sales.sql',content:"SELECT id, (quantity * price) AS amount, CAST(repair AS INTEGER) AS repaired FROM {{ ref('z_stage') }}"},
  {path:'models/z_stage.sql',content:"SELECT id, quantity, CAST(price AS NUMBER) AS price, repair FROM {{ source('raw', 'invoices') }}"}
 ]}
 const importProject=async document=>{
  const post=async(action,data)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers:{Origin:origin,'X-Import-Kind':'model','X-Import-Dataset':document.projectId},data});assert.equal(r.status(),200,await r.text());return r.json()}
  const bytes=Buffer.from(JSON.stringify(document)),digest=createHash('sha256').update(bytes).digest('hex')
  const uploaded=await post('uploads',{name:'synthetic-bifocal-91.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')})
  const plan=await post('plan',{uploadId:uploaded.uploadId});assert.equal(plan.counts.rejected,0)
  for(let i=0;i<20;i++){
   const result=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})
   if(result.job.state==='completed'){assert.equal((await post('reconcile',{planId:plan.planId})).ok,true);return call('/model-imports/'+document.projectId)}
  }
  assert.fail('dbt source project import did not complete')
 }
 const imported=await importProject(input),body={projectId,bindings:{'source.raw.invoices':dataset}}
 const review=()=>call(path,body,200)
 const result=await review()
 assert.equal(result.compatible,true,JSON.stringify(result));assert.equal(result.published,false)
 assert.deepEqual(result.project,{id:projectId,revision:imported.revision})
 const stage=result.order.indexOf('model.z_stage'),sales=result.order.indexOf('model.a_sales')
 assert.ok(result.order.indexOf('source.raw.invoices')<stage&&stage<sales,'Native review runs each dependency before its consumer regardless of file and name order')
 assert.deepEqual(result.outputs['model.a_sales'].rows,[['1','0.2','12'],['2','0.6','13'],['3',null,'14']])
 assert.deepEqual(result.tests.map(t=>[t.test,t.status,t.failures]).sort(),[['not_null','passed',0],['unique','passed',0]])
 assert.deepEqual(result.outputs['model.a_sales'].lineage.amount,[{dataset,revision:original.revision,column:'quantity'},{dataset,revision:original.revision,column:'price'}])
 assert.deepEqual(result.sources,[{dataset,revision:original.revision}])
 assert.deepEqual(await call('/datasets/'+dataset),original,'dbt review leaves the authorized source unchanged')
 const again=await review();assert.deepEqual(again,result,'Identical project and source versions produce an identical review')
 const missing=await call(path,{projectId,bindings:{}},200);assert.equal(missing.compatible,false);assert.ok(missing.diagnostics.some(d=>d.code==='dbt_explicit_source_binding_required'))
 await call(path,{projectId,bindings:{'model.a_sales':dataset}},400)
 const jinja=structuredClone(input);jinja.projectId='synthetic-bifocal-92';jinja.files[2].content="{{ run_query('DELETE FROM bf_file_tables') }} SELECT * FROM {{ ref('z_stage') }}"
 await importProject(jinja)
 const unsupported=await call(path,{...body,projectId:jinja.projectId},200)
 assert.equal(unsupported.compatible,false);assert.ok(unsupported.diagnostics.some(d=>d.resource==='model.a_sales'&&d.code==='unsupported_dbt_sql'));assert.equal(unsupported.outputs['model.a_sales'],undefined)
 const hooks=structuredClone(input);hooks.projectId='synthetic-bifocal-93';hooks.files[0].content+='on-run-start: ["DELETE FROM bf_file_tables"]\n'
 await importProject(hooks)
 const hooked=await call(path,{...body,projectId:hooks.projectId},200)
 assert.equal(hooked.compatible,false);assert.ok(hooked.diagnostics.some(d=>d.code==='unsupported_dbt_configuration'));assert.deepEqual(hooked.outputs,{})
 assert.deepEqual(await call('/datasets/'+dataset),original,'Unsafe declarations never execute against stored source data')
 assert.equal((await context.request.post(origin+'/api/operator'+path,{headers:{Origin:'https://foreign.example.test'},data:body})).status(),401)
 const member=await context.browser().newContext({ignoreHTTPSErrors:true})
 try{
  assert.equal((await member.request.post(origin+'/api/operator'+path,{headers:{Origin:origin},data:body})).status(),401)
  if(signInMember){
   const email='synthetic-bifocal-94@example.test'
   assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email,displayName:'synthetic-bifocal-94',role:'member'}})).status(),202)
   await signInMember(member,email)
   assert.equal((await member.request.post(origin+'/api/operator'+path,{headers:{Origin:origin},data:body})).status(),401)
  }
 }finally{await member.close()}
 await upload(dataset,csv.replace('2,0.10','2,0.11'),true,sourceOptions)
 const changed=await review(),source=await call('/datasets/'+dataset)
 assert.equal(changed.compatible,true);assert.notEqual(changed.digest,result.digest)
 assert.deepEqual(changed.outputs['model.a_sales'].rows,[['1','0.22','12'],['2','0.6','13'],['3',null,'14']])
 assert.equal(changed.outputs['model.a_sales'].lineage.amount.every(ref=>ref.revision===source.revision),true)
 assert.deepEqual(result.outputs['model.a_sales'].rows,[['1','0.2','12'],['2','0.6','13'],['3',null,'14']])
 await upload(dataset,'id,quantity,price,repair\n1,2,0.10,12\n1,3,0.20,13\n,4,,14\n',true,sourceOptions)
 const quality=await review();assert.equal(quality.compatible,false)
 assert.deepEqual(quality.tests.map(t=>[t.test,t.status,t.failures]).sort(),[['not_null','failed',1],['unique','failed',2]])
 // Intake diagnostics remain blocking at execution; a malformed test cannot vanish.
 for(const key of ['tests','data_tests'])for(const scope of ['column','model']){
  const malformed=structuredClone(input);malformed.projectId='synthetic-bifocal-invalid-'+key.replace('_','-')+'-'+scope
  malformed.files[1].content=malformed.files[1].content.replace('tests: [not_null, unique]',key+': not_null')
  if(scope==='model')malformed.files[1].content=malformed.files[1].content.replace('      - name: id\n        '+key+': not_null','      - name: id\n    '+key+': not_null')
  const intake=await importProject(malformed)
  assert.ok(intake.report.project.issues.some(d=>d.code==='invalid_dbt_tests'&&d.file==='models/schema.yml'))
  const invalid=await call(path,{...body,projectId:malformed.projectId},200)
  assert.equal(invalid.compatible,false,'An invalid imported test must never become a compatible review')
  assert.ok(invalid.diagnostics.some(d=>d.code==='invalid_dbt_tests'&&d.file==='models/schema.yml'))
  assert.deepEqual(invalid.outputs,{},'A project with invalid declarations cannot release unchecked null IDs')
 }
 await upload(dataset,csv.replace('0.20,13','0.20,bad'),true,sourceOptions)
 const failed=await review();assert.equal(failed.compatible,false)
 assert.ok(failed.diagnostics.some(d=>d.resource==='model.a_sales'&&d.code==='preparation_type_conversion_failed'));assert.equal(failed.outputs['model.a_sales'],undefined)
 const current=await call('/datasets/'+dataset)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
 await call(path,body,404)
 console.log('Native dbt review: source-pinned dependency order, projections and exact casts and expressions, generic tests, diagnostics, source drift and erasure, and owner isolation passed')
}
