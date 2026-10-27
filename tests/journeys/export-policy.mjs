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
  const combined=await reader.request.post(origin+'/api/operator/explore/compositions/run',{headers,data:{left:parameters,right:parameters,operation:'append',join:'inner'}});assert.equal(combined.status(),403);assert.equal((await combined.json()).error,'composition_owner_required','A single-view member grant never authorizes a new subject composition')
  assert.equal((await reader.request.get(origin+'/app/questions/compositions/'+question.snapshotId)).status(),403)
  assert.equal((await reader.request.post(origin+'/api/operator/queries/'+question.snapshotId+'/export',{headers,data:{scope:'underlying',format:'csv'}})).status(),401,'A view grant does not authorize owner-only retained answer exports')
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
  const lastPolicy=await setting();await setting({previousRevision:lastPolicy.revision,csv:1,xlsx:1})
  const memberRefusal=await download(reader,underlying.snapshotId,'underlying','csv',413),memberPlan=(await memberRefusal.json()).fullExport
  assert.equal(memberPlan.totalRows,2,'A full-export plan reveals only the member scope')
  const memberPart=await reader.request.post(origin+'/api/operator/explore/'+underlying.snapshotId+'/full-export',{headers,data:{scope:'underlying',format:'csv',offset:0,planDigest:memberPlan.planDigest}})
  assert.equal(memberPart.status(),200,await memberPart.text());assert.equal(Number(memberPart.headers()['x-bifocal-row-count']),1);assert.ok(!(await memberPart.text()).includes('East'))
  assert.equal((await reader.request.post(origin+'/api/operator/explore/'+summary.snapshotId+'/export-plan',{headers,data:{scope:'underlying',format:'csv'}})).status(),403)
  await call('/explore/access/'+underlyingGrant.id+'/revoke',{})
  assert.equal((await reader.request.post(origin+'/api/operator/explore/'+underlying.snapshotId+'/full-export',{headers,data:{scope:'underlying',format:'csv',offset:1,planDigest:memberPlan.planDigest}})).status(),403,'Revocation stops the next named export part')

 } finally {
  const current=await setting();await setting({previousRevision:current.revision,csv:original.csv,xlsx:original.xlsx})
  await call('/explore/access/'+summaryGrant.id+'/revoke',{});await call('/explore/access/'+underlyingGrant.id+'/revoke',{})
 }
 console.log('Interactive export policy: owner autosave, stale and failed input retention, invited-member denial, effective catalog caps, complete-or-refused files and independent download permissions passed at 1440 and 390')
}

/** Bounded native network policy and attributable restricted-export audit. */
export async function proveSecurity({origin,owner,reader,readerId,page,upload,proveScreen,fixture,clock}) {
 const ingress='198.51.100.7',edge={'x-security-test-ip':ingress},headers={Origin:origin,...edge}
 const secret='synthetic-bifocal-private-row'
 const call=async(path,data,client=owner,status=200,extra={})=>{const response=await client.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers:{...headers,...extra},...data===undefined?{}:{data}});assert.equal(response.status(),status,await response.text());return response.json()}
 const policy=async(data,client=owner,status=200,extra={})=>{const response=await client.request.fetch(origin+'/api/operator/security/ip-policy',{method:data===undefined?'GET':'PUT',headers:{...headers,...extra},...data===undefined?{}:{data}});assert.equal(response.status(),status,await response.text());return response.json()}
 const audit=()=>call('/security/audit')
 const original=await policy()
 assert.equal((await fetch(origin+'/api/operator/security/audit')).status,401)
 await call('/security/audit',undefined,reader,403);await policy(undefined,reader,403)
 await policy({previousRevision:original.revision,enabled:true,prefixes:[ingress]},reader,403)
 await policy({previousRevision:original.revision,enabled:true,prefixes:[ingress]},owner,401,{Origin:'https://foreign.example.test'})
 for(const prefixes of [[],['198.51.100.999'],['198.51.100.0/33'],['2001:db8::/129'],['127.0.0.1/8/8']])await policy({previousRevision:original.revision,enabled:true,prefixes},owner,400)
 await policy({previousRevision:original.revision,enabled:true,prefixes:['203.0.113.0/24']},owner,400)
 let active=await policy({previousRevision:original.revision,enabled:true,prefixes:['198.51.100.0/24','2001:db8:7::/48']})
 try {
  await policy({previousRevision:original.revision,enabled:false,prefixes:[]},owner,409)
  for(const [ip,expected] of [['198.51.100.255',200],['198.51.101.1',403],['2001:db8:7::22',200],['2001:db8:8::22',403],['unknown',403],['::ffff:198.51.100.7',403]]){
   const response=await owner.request.get(origin+'/api/operator/security/ip-policy',{headers:{'x-security-test-ip':ip,'X-Forwarded-For':ingress}})
   assert.equal(response.status(),expected,'Only the ingress address controls network admission: '+ip)
  }
  for(const path of ['/app/settings','/app/settings/security','/auth/session','/api/operator/explore','/api/v1/definitions','/api/operator/portal/tenants','/api/operator/inputs','/app/inputs']){
   const response=await owner.request.get(origin+path,{headers:{'x-security-test-ip':'203.0.113.9'}})
   assert.equal(response.status(),403,'Every private router is behind IP admission')
  }
  await page.setExtraHTTPHeaders(edge)
  await page.goto(origin+'/app/settings');await page.getByRole('link',{name:'Security and audit',exact:true}).waitFor();await proveScreen('security-settings-entry')
  await page.getByRole('link',{name:'Security and audit',exact:true}).click();await page.getByRole('status').filter({hasText:'IP allowlist is enabled.'}).waitFor();await proveScreen('security-policy-enabled')
  await page.getByLabel('Allowed addresses and prefixes').fill(ingress+'\n2001:db8:7::/48');await page.getByLabel('I approve this exact network policy').check();await page.getByRole('button',{name:'Save reviewed policy'}).click();await page.getByRole('status').filter({hasText:'Network policy saved.'}).waitFor()
  active=await policy();assert.deepEqual(active.prefixes,[ingress,'2001:db8:7::/48']);await proveScreen('security-policy-saved')
  await page.getByLabel('Allowed addresses and prefixes').fill('invalid');await page.getByLabel('I approve this exact network policy').check();await page.getByRole('button',{name:'Save reviewed policy'}).click();await page.getByRole('status').filter({hasText:'Not saved:'}).waitFor();assert.equal(await page.getByLabel('Allowed addresses and prefixes').inputValue(),'invalid');await proveScreen('security-policy-refused')
  const dataset='synthetic-bifocal-security',calendar=dataset
  await upload(dataset,'invoice,region,revenue,note\ninv-west,West,$10.01,'+secret+'\ninv-east,East,$20.02,excluded\ninv-hidden,Hidden,$99.00,excluded\n',false,false,edge)
  await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Security year',kind:'fiscal',startMonth:1}},owner,201)
  const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',sourceCurrency:'USD',scale:2}],context:{modelVersion:'security',metricVersion:'security',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'},semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'text'},{column:'region',type:'text'},{column:'revenue',type:'money'}],hierarchies:[['region','invoice']],slowlyChanging:'reject-duplicate-grain'}}
  const model=await call('/models',{definition:{views:[{id:'sales',kind:'chart',query,rowRules:[{column:'region',op:'ne',value:'Hidden'}]}],quality:[]}},owner,201),branch='/models/'+model.modelId+'/branches/'+model.branchId
  const reviewed=await call(branch+'/validate',{});await call(branch+'/approve',{digest:reviewed.digest});await call(branch+'/promote',{environment:'staging',digest:reviewed.digest});await call(branch+'/promote',{environment:'production',digest:reviewed.digest})
  const person=(await(await owner.request.get(origin+'/auth/operators',{headers:edge})).json()).find(p=>p.id===readerId)
  const grant={operatorId:readerId,operatorVersion:person.version,modelId:model.modelId,revision:model.revision,viewId:'sales',filters:[{column:'region',op:'eq',value:'West'}],dimensions:['region'],underlying:false,summaryExport:true,underlyingExport:false,expiresAt:new Date(Date.now()+300000).toISOString()}
  const review=await call('/explore/access/review',grant),issued=await call('/explore/access',{...grant,reviewedDigest:review.digest},owner,201)
  const ownerQuestion=await call('/queries/run',query,owner,201)
  assert.equal(ownerQuestion.answer.totals.revenue.value,'129.03')
  const ownerDownload=await owner.request.post(origin+'/api/operator/queries/'+ownerQuestion.snapshotId+'/export',{headers,data:{scope:'summary',format:'csv'}})
  assert.equal(ownerDownload.status(),200,await ownerDownload.text())
  assert.ok((await ownerDownload.text()).includes('20.02'))
  const question=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['region'],filters:[],grantId:issued.id},reader,201)
  assert.equal(question.answer.filteredRows,1);assert.equal(question.answer.totals.revenue.value,'10.01')
  const exportedAt=new Date().toISOString();await clock.set(exportedAt)
  let download
  try{download=await reader.request.post(origin+'/api/operator/explore/'+question.snapshotId+'/export',{headers,data:{scope:'summary',format:'csv'}})}finally{await clock.set(null)}
  assert.equal(download.status(),200,await download.text());assert.equal(await download.text(),'"region","revenue"\r\n"West","10.01"\r\n')
  await call('/explore/'+question.snapshotId+'/export',{scope:'underlying',format:'csv'},reader,403)
  const evidence=await audit();assert.equal(evidence.valid,true);assert.ok(evidence.head.sequence>0)
  const ownerEvent=evidence.events.find(e=>e.action==='export'&&e.queryId===ownerQuestion.snapshotId)
  assert.ok(ownerEvent);assert.equal(ownerEvent.scope.kind,'installation-owner');assert.equal(ownerEvent.outcome,'allowed')
  const exports=evidence.events.filter(e=>e.action==='export'&&e.queryId===question.snapshotId)
  assert.deepEqual(exports.map(e=>e.outcome),['allowed','refused'])
  const exported=exports[0];assert.equal(exported.actorId,readerId);assert.equal(exported.delegatedCredential,null);assert.equal(exported.tenantId,null)
  assert.equal(exported.scope.kind,'delegated-view');assert.equal(exported.scope.grantId,issued.id);assert.equal(exported.scope.modelId,model.modelId);assert.equal(exported.scope.modelRevision,model.revision);assert.equal(exported.scope.viewId,'sales');assert.equal(exported.scope.exportScope,'summary');assert.equal(exported.scope.exportRows,1);assert.equal(exported.httpStatus,200);assert.equal(exported.recordedAt,exportedAt)
  const {createHmac}=await import('node:crypto'),canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'
  const expectedScope={filters:[{column:'region',op:'ne',value:'Hidden'},{column:'region',op:'eq',value:'West'}],fiscal:null}
  assert.equal(exported.scope.rowScopeDigest,createHmac('sha256','synthetic-bifocal-2'.repeat(3)).update('bifocal-security-v1\n'+canonical(expectedScope)).digest('hex'))
  assert.ok(evidence.events.some(e=>e.action==='query'&&e.queryId===question.snapshotId&&e.actorId===readerId))
  const text=JSON.stringify(evidence);for(const forbidden of [secret,'West','Hidden','10.01','20.02','synthetic-bifocal-2'.repeat(3),'cookie','authorization','value_json'])assert.ok(!text.includes(forbidden),'Audit excludes raw values and credentials')
  assert.deepEqual(await fixture('audit-mutation-guards'),{updateRefused:true,deleteRefused:true})
  await page.goto(origin+'/app/settings/security');await page.getByRole('status').filter({hasText:'Audit chain verified.'}).waitFor();await proveScreen('security-audit-verified')
  await fixture('audit-corrupt')
  try{const changed=await audit();assert.equal(changed.valid,false);assert.deepEqual(changed.events,[]);await page.getByRole('button',{name:'Verify audit chain'}).click();await page.getByRole('status').filter({hasText:'Audit integrity failed.'}).waitFor();await proveScreen('security-audit-tampered')}finally{await fixture('audit-repair-fixture')}
  assert.equal((await audit()).valid,true)
  await fixture('audit-invalidate-head')
  try{
   await call('/queries/'+ownerQuestion.snapshotId,undefined,owner,503)
   await call('/security/audit',undefined,owner,503)
   await page.getByRole('button',{name:'Verify audit chain'}).click();await page.getByRole('status').filter({hasText:'Audit verification unavailable.'}).waitFor();await proveScreen('security-audit-unavailable')
  }finally{await fixture('audit-repair-head')}
  assert.equal((await audit()).valid,true)
  await call('/explore/access/'+issued.id+'/revoke',{})
  await call('/explore/'+question.snapshotId+'/export',{scope:'summary',format:'csv'},reader,403)
  const memberPage=await reader.newPage();await memberPage.setExtraHTTPHeaders(edge)
  try{for(const width of [1440,390]){await memberPage.setViewportSize({width,height:1000});assert.equal((await memberPage.goto(origin+'/app/settings/security')).status(),403);assert.equal(await memberPage.getByRole('heading',{name:'Security settings unavailable'}).count(),1);if(process.env.BIFOCAL_PROOF_DIR)await memberPage.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/security-member-refused-'+width+'.png',fullPage:true})}}finally{await memberPage.close()}
  await page.setExtraHTTPHeaders({'x-security-test-ip':'203.0.113.9'});assert.equal((await page.goto(origin+'/app/settings/security')).status(),403);await proveScreen('security-network-refused')
 } finally {const current=await policy();await policy({previousRevision:current.revision,enabled:original.enabled,prefixes:original.prefixes});await page.setExtraHTTPHeaders({})}
 assert.equal((await audit()).valid,true)
 console.log('Security public doors: native owner policy, IPv4 and IPv6 admission and refusal, restricted member export, current scope, redaction, append-only guards, tamper detection and unavailable-audit refusal passed at 1440 and 390')
}
