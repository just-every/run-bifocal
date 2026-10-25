import assert from 'node:assert/strict'

/** Real owner settings and invited-member downloads through the native doors. */
export async function proveExportPolicy({origin,context,page,upload,proveScreen,reader,readerId}) {
 assert.ok(reader&&readerId,'Export policy proof needs an actual invited native member')
 const headers={Origin:origin},path='/api/operator/explore/export-policy'
 const call=async(path,data)=>{const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers,...data===undefined?{}:{data}});assert.ok(response.ok(),await response.text());return response.json()}
 const setting=async(data,expected=200,client=context)=>{
  const response=await client.request.fetch(origin+path,{method:data===undefined?'GET':'PUT',headers,...data===undefined?{}:{data}})
  assert.equal(response.status(),expected,await response.text());return response.json()
 }
 const original=await setting(),dataset='synthetic-bifocal-export-caps',calendar='synthetic-bifocal-export-caps'
 const csv='invoice,region,revenue\ninv-a,West,$10.01\ninv-b,West,$20.02\ninv-c,East,-$0.03\ninv-d,East,$4.00\ninv-hidden,Hidden,$99.00\n'
 await upload(dataset,csv)
 await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Export policy year',kind:'fiscal',startMonth:1}})
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',sourceCurrency:'USD',scale:2}],context:{modelVersion:'export-caps',metricVersion:'export-caps',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'},semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'text'},{column:'region',type:'text'},{column:'revenue',type:'money'}],hierarchies:[['region','invoice']],slowlyChanging:'reject-duplicate-grain'}}
 const model=await call('/models',{definition:{views:[{id:'sales',kind:'chart',query,rowRules:[{column:'region',op:'ne',value:'Hidden'}]}],quality:[]}}),branch='/models/'+model.modelId+'/branches/'+model.branchId
 const review=await call(branch+'/validate',{});assert.equal(review.compatible,true)
 await call(branch+'/approve',{digest:review.digest});await call(branch+'/promote',{environment:'staging',digest:review.digest});await call(branch+'/promote',{environment:'production',digest:review.digest})
 const parameters={modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['region'],filters:[]},question=await call('/explore/run',parameters)
 assert.equal(question.answer.filteredRows,4);assert.equal(question.answer.totals.revenue.value,'34.00')
 const people=await(await context.request.get(origin+'/auth/operators')).json(),person=people.find(p=>p.id===readerId)
 assert.ok(person?.version)
 const grant={operatorId:readerId,operatorVersion:person.version,modelId:model.modelId,revision:model.revision,viewId:'sales',filters:[{column:'region',op:'eq',value:'West'}],dimensions:['region'],underlying:false,summaryExport:true,underlyingExport:false,expiresAt:new Date(Date.now()+300000).toISOString()}
 const issue=async(document)=>{const reviewed=await call('/explore/access/review',document);return call('/explore/access',{...document,reviewedDigest:reviewed.digest})}
 const summaryGrant=await issue(grant),underlyingGrant=await issue({...grant,underlying:true,summaryExport:false,underlyingExport:true})
 const memberQuestion=async(access)=>{const response=await reader.request.post(origin+'/api/operator/explore/run',{headers,data:{...parameters,grantId:access.id}});assert.equal(response.status(),201,await response.text());return response.json()}
 const summary=await memberQuestion(summaryGrant),underlying=await memberQuestion(underlyingGrant),grantsBefore=(await call('/explore/access')).grants
 const download=async(client,id,scope,format,expected)=>{const response=await client.request.post(origin+'/api/operator/explore/'+id+'/export',{headers,data:{scope,format}});assert.equal(response.status(),expected,expected===200?'Expected a complete permitted download':await response.text());return response}
 try {
  assert.equal((await fetch(origin+path)).status,401)
  const foreign=await context.request.put(origin+path,{headers:{Origin:'https://foreign.example.test'},data:{previousRevision:original.revision,csv:2,xlsx:3}});assert.equal(foreign.status(),401)
  await setting(undefined,403,reader);await setting({previousRevision:original.revision,csv:2,xlsx:3},403,reader)
  assert.equal((await reader.request.get(origin+'/app/settings/export')).status(),403)
  for(const invalid of [{previousRevision:original.revision,csv:0,xlsx:3},{previousRevision:original.revision,csv:2,xlsx:1e9},{previousRevision:original.revision,csv:1.5,xlsx:3}])await setting(invalid,400)
  const lowered=await setting({previousRevision:original.revision,csv:2,xlsx:3})
  await setting({previousRevision:original.revision,csv:4,xlsx:4},409);assert.deepEqual(await setting(),lowered)
  for(const client of [context,reader]){const catalog=await(await client.request.get(origin+'/api/operator/explore')).json();assert.equal(catalog.limits.csv,2);assert.equal(catalog.limits.xlsx,3);assert.ok(!('actor_id' in catalog.limits));assert.ok(!('audit' in catalog.limits))}
  for(const format of ['csv','xlsx']) {
   const summarized=await download(context,question.snapshotId,'summary',format,200);assert.equal(Number(summarized.headers()['x-bifocal-row-count']),2)
   const refused=await download(context,question.snapshotId,'underlying',format,413);const refusal=await refused.json();assert.equal(refusal.error,'interactive_export_cap_exceeded');assert.equal(refusal.fullExport.totalRows,4);assert.ok(!refused.headers()['content-disposition'])
   const planResponse=await context.request.post(origin+'/api/operator/explore/'+question.snapshotId+'/export-plan',{headers,data:{scope:'underlying',format}});assert.equal(planResponse.status(),200);const plan=await planResponse.json();let offset=0,count=0
   do{const part=await context.request.post(origin+'/api/operator/explore/'+question.snapshotId+'/full-export',{headers,data:{scope:'underlying',format,offset,planDigest:plan.planDigest}});assert.equal(part.status(),200,await part.text());count+=Number(part.headers()['x-bifocal-row-count']);const next=part.headers()['x-bifocal-next-offset'];offset=next===''?null:Number(next)}while(offset!==null)
   assert.equal(count,4,'Named full-export parts cover every permitted row')
   await download(reader,summary.snapshotId,'summary',format,200);await download(reader,summary.snapshotId,'underlying',format,403)
   await download(reader,underlying.snapshotId,'summary',format,403)
   const permitted=await download(reader,underlying.snapshotId,'underlying',format,200);assert.equal(Number(permitted.headers()['x-bifocal-row-count']),2)
  }
  const rows=await call('/explore/'+question.snapshotId+'/page',{scope:'underlying',offset:0});assert.equal(rows.totalRows,4);assert.equal(rows.rows.length,4,'Caps never truncate the underlying query')
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings/export')
   await page.getByRole('heading',{name:'Export limits',exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:/save/i}).count(),0,'Settings save when a field changes')
   const next=Number(await page.getByLabel('CSV row limit',{exact:true}).inputValue())===2?3:2
   await page.getByLabel('CSV row limit',{exact:true}).fill(String(next));await page.getByLabel('CSV row limit',{exact:true}).press('Tab')
   await page.getByRole('status').filter({hasText:'Export limits saved.'}).waitFor();assert.equal((await setting()).csv,next)
   await proveScreen('export-policy-autosaved')
  }
  // A concurrent native edit refuses this open page's stale revision and keeps
  // the entered value visible, without claiming that it was persisted.
  const current=await setting();const priorPlan=await(await context.request.post(origin+'/api/operator/explore/'+question.snapshotId+'/export-plan',{headers,data:{scope:'underlying',format:'csv'}})).json();await setting({previousRevision:current.revision,csv:4,xlsx:4})
  assert.equal((await context.request.post(origin+'/api/operator/explore/'+question.snapshotId+'/full-export',{headers,data:{scope:'underlying',format:'csv',offset:0,planDigest:priorPlan.planDigest}})).status(),409,'A changed owner cap invalidates a saved full-export plan')
  await page.getByLabel('CSV row limit',{exact:true}).fill('1');await page.getByLabel('CSV row limit',{exact:true}).press('Tab')
  await page.getByRole('status').filter({hasText:'Not saved.'}).waitFor();assert.equal(await page.getByLabel('CSV row limit',{exact:true}).inputValue(),'1');assert.equal((await setting()).csv,4);await proveScreen('export-policy-stale-keeps-input')
  const complete=await download(context,question.snapshotId,'underlying','csv',200),text=await complete.text()
  assert.equal(Number(complete.headers()['x-bifocal-row-count']),4);assert.ok(!text.includes('Hidden'))
  const exported=text.trimEnd().split('\r\n').slice(1).map(row=>row.split(',').map(cell=>cell.slice(1,-1)))
  assert.deepEqual(exported.map(row=>row[0]).sort(),['inv-a','inv-b','inv-c','inv-d']);assert.equal(exported.reduce((sum,row)=>sum+Math.round(Number(row[2])*100),0),3400)
  assert.deepEqual((await call('/explore/access')).grants,grantsBefore,'Changing export limits cannot issue, activate or change grants')
 } finally {
  const current=await setting();await setting({previousRevision:current.revision,csv:original.csv,xlsx:original.xlsx})
  await call('/explore/access/'+summaryGrant.id+'/revoke',{});await call('/explore/access/'+underlyingGrant.id+'/revoke',{})
 }
 console.log('Interactive export policy: owner autosave, stale/failure input retention, invited-member denial, effective catalog caps, complete-or-refused files and independent download permissions passed at 1440 and 390')
}
