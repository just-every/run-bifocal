import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function proveMigrationProjects({origin,context,call,page,proveScreen,upload}){
 const id='synthetic-bifocal-migration',base='/migration-projects/'+id,headers={Origin:origin,'X-Import-Kind':'migration-project','X-Import-Dataset':id}
 const post=async(action,data,status=200)=>{const response=await context.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(response.status(),status,await response.text());return response.json()}
 const baselines=new Set()
 const prepare=async input=>{const bytes=Buffer.from(JSON.stringify(input)),hash=createHash('sha256').update(bytes).digest('hex');const data={name:'synthetic-bifocal-migration.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')};const upload=await post('uploads',data);assert.equal((await post('uploads',{...data,uploadId:upload.uploadId})).uploadId,upload.uploadId);return post('plan',{uploadId:upload.uploadId,...(baselines.has(input.projectId)?{catchup:true}:{})})}
 const apply=async plan=>{for(let i=0;i<20;i++){const response=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(response.job.state==='completed'){baselines.add(headers['X-Import-Dataset']);assert.equal((await post('reconcile',{planId:plan.planId})).ok,true);return}}assert.fail('Migration apply incomplete')}
 const metric={id:'revenue',kind:'metric',sourceRevision:'1',original:'sum(amount)',mapping:'Reviewed revenue reconstruction',gap:'Source-query parity not yet proved'}
 const input={version:1,projectId:id,source:'qlik',cutoff:'2026-10-15T12:00:00Z',rollbackPlan:'Keep incumbent active; retain every reviewed version.',items:[metric,{id:'set-analysis',kind:'set-analysis',sourceRevision:'1',original:"sum({<Region={'West'}>} Amount)",mapping:'Governed West filter required',gap:'Associative equivalence unproved'}]}
 assert.equal((await fetch(origin+'/api/operator'+base)).status,401)
 const plan=await prepare(input);assert.equal(plan.counts.rejected,0)
 await post('apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},403)
 await apply(plan)
 let current=await call(base)
 assert.deepEqual(current.items.map(i=>i.source.id),['revenue','set-analysis'])
 assert.equal(current.state,'inactive');assert.equal(current.dispatch,'unavailable');assert.equal(current.grants,'none')
 assert.equal(current.items[1].source.gap,'Associative equivalence unproved')
 const before=current.revision,retry=await prepare(input);await apply(retry);current=await call(base)
 assert.equal(current.items[0].native,'sum(amount)');assert.equal(current.items.length,2)
 // The shared door resumes the exact retained plan without repeating effects.
 await apply(retry);assert.deepEqual(await call(base),current)
 await post('undo',{planId:retry.planId});assert.equal((await call(base)).items[0].native,'sum(amount)')
 const edit=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'revenue',native:'sum(net_amount)'},200)
 await call(base+'/edit',{reviewedRevision:current.revision,itemId:'revenue',native:'stale edit'},409)
 const beforeUndo=await call(base);await post('undo',{planId:plan.planId},409);assert.deepEqual(await call(base),beforeUndo)
 const delta=structuredClone(input);delta.cutoff='2026-10-16T12:00:00Z';delta.items=[{...metric,sourceRevision:'2',original:'sum(gross_amount)'},{id:'new-dashboard',kind:'dashboard',sourceRevision:'1',original:'Revenue dashboard',mapping:'Retained chart required',gap:'Rendering not reconstructed'}]
 const deltaPlan=await prepare(delta);assert.equal(deltaPlan.project.items.find(i=>i.source.id==='revenue').conflict.original,'sum(gross_amount)')
 // A stale import plan cannot overwrite a later native edit.
 await call(base+'/edit',{reviewedRevision:edit.revision,itemId:'revenue',native:'sum(net_amount)-returns'},200)
 const beforeStale=await call(base);const stale=await post('apply',{planId:deltaPlan.planId,reviewedFingerprint:deltaPlan.fingerprint},409);assert.equal(stale.error,'import_door_apply_constraint');assert.deepEqual(await call(base),beforeStale)
 const freshInput=structuredClone(delta),fresh=await prepare(delta);await apply(fresh);current=await call(base)
 assert.deepEqual(current.items.map(i=>i.source.id),['new-dashboard','revenue','set-analysis'])
 const conflicted=current.items.find(i=>i.source.id==='revenue');assert.equal(conflicted.native,'sum(net_amount)-returns');assert.equal(conflicted.source.original,'sum(amount)');assert.equal(conflicted.conflict.original,'sum(gross_amount)')
 await call(base+'/resolve',{reviewedRevision:before,itemId:'revenue',choice:'use-source'},409)
 current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:'revenue',choice:'keep-native'},200)
 assert.equal(current.items.find(i=>i.source.id==='revenue').native,'sum(net_amount)-returns');assert.equal(current.items.find(i=>i.source.id==='revenue').conflict,null)
 const replay=await prepare(delta);await apply(replay);current=await call(base)
 assert.equal(current.items.find(i=>i.source.id==='revenue').conflict,null)
 // A future conflicting delta can instead accept the reviewed source definition.
 delta.items[0].sourceRevision='3';delta.items[0].original='sum(final_amount)';await apply(await prepare(delta));current=await call(base)
 current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:'revenue',choice:'use-source'},200)
 assert.equal(current.items.find(i=>i.source.id==='revenue').native,'sum(final_amount)');assert.equal(current.items.find(i=>i.source.id==='revenue').edited,false)
 const history=await call(base),versions=await Promise.all(history.history.map(h=>call(base+'/versions/'+h.revision)));assert.ok(versions.some(h=>h.action==='edit'&&h.value.items.some(i=>i.native==='sum(net_amount)')));assert.ok(versions.some(h=>h.action==='import'&&h.value.items.some(i=>i.conflict?.original==='sum(gross_amount)')))
 const originals=await context.request.get(origin+'/api/operator/import/original/'+fresh.planId,{headers});assert.equal(originals.status(),200);const retained=(await originals.json()).originals;assert.equal(retained.length,1);assert.deepEqual(JSON.parse(Buffer.from(retained[0].original.base64,'base64').toString('utf8')),freshInput)
 const foreign=await context.request.post(origin+'/api/operator'+base+'/edit',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{reviewedRevision:current.revision,itemId:'revenue',native:'foreign'}});assert.equal(foreign.status(),401)
 const invitation=await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email:'synthetic-bifocal-migration-member@example.test',displayName:'Synthetic migration member',role:'member'}});assert.equal(invitation.status(),202)
 const member=await context.browser().newContext()
 try{
  const entered=await member.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent('synthetic-bifocal-migration-member@example.test'),{headers:{'x-rer-dev-key':'synthetic-bifocal-9'.repeat(3)},maxRedirects:0});assert.equal(entered.status(),303)
  assert.equal((await member.request.get(origin+'/api/operator'+base)).status(),401)
  assert.equal((await member.request.get(origin+'/api/operator'+base+'/versions/'+history.history[0].revision)).status(),401)
  for(const action of ['edit','resolve','erase'])assert.equal((await member.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:origin},data:{reviewedRevision:current.revision,itemId:'revenue',native:'forbidden',choice:'use-source',confirmImport:id}})).status(),401)
  assert.equal((await member.request.post(origin+'/api/operator/import/apply',{headers,data:{planId:fresh.planId,reviewedFingerprint:fresh.fingerprint}})).status(),401)
 }finally{await member.close()}
 // All formats remain inert reconstruction manifests, never translated claims.
 for(const source of ['spreadsheet','databox','zoho','klipfolio']){const specimen={...input,source};const other=id+'-'+source,old=headers['X-Import-Dataset'];headers['X-Import-Dataset']=other;specimen.projectId=other;const p=await prepare(specimen);assert.equal(p.counts.rejected,0);assert.equal(p.project.source,source);assert.equal(p.project.dispatch,'unavailable');headers['X-Import-Dataset']=old}
 await call(base+'/erase',{confirmImport:id,reviewedRevision:current.revision},200);await call(base,undefined,404)
 const withdrawn=await context.request.get(origin+'/api/operator/import/original/'+fresh.planId,{headers});assert.equal(withdrawn.status(),200);const unavailable=(await withdrawn.json()).originals;assert.equal(unavailable.length,1);assert.equal(unavailable[0].original.status,'unavailable');assert.equal(unavailable[0].original.base64,undefined)
 await call(base+'/versions/'+history.history[0].revision,undefined,404)
 await post('apply',{planId:fresh.planId,reviewedFingerprint:fresh.fingerprint},410)
 await proveTableauMigration({origin,context,call,page,proveScreen,upload})
 console.log('Migration projects: shared retained plans, exact approval, idempotent resume, deltas, native conflicts, both resolutions, original history, stale and foreign refusal, erasure and inert reconstruction inventories passed')
}

export async function proveTableauMigration({origin,context,call,page,proveScreen,upload}){
 const {tableauMigrationSpecimen}=await import('./model-import.mjs'),{zipSync,strToU8}=await import('fflate')
 await call('/calendars',{id:'synthetic-bifocal-tableau-calendar',previousVersion:null,definition:{name:'Tableau Gregorian calendar',kind:'fiscal',startMonth:1}})
 const dataset='synthetic-bifocal-tableau-sales',csv='id,amount,customer,date,region\n1,$10.01,A,07/01/2026,West\n2,$20.02,A,07/02/2026,West\n3,,B,07/03/2026,West\n4,-$4.00,,07/04/2026,West\n5,$0.00,C,07/31/2026,West\n6,$99.00,D,07/04/2026,East\n7,$200.00,E,08/01/2026,West\n'
 await upload(dataset,csv)
 const source=await call('/datasets/'+dataset);assert.equal(source.table.columns.find(c=>c.name==='amount').type,'money');const {input,tds}=tableauMigrationSpecimen(dataset,source.revision),id=input.projectId
 const headers={Origin:origin,'X-Import-Kind':'migration-project','X-Import-Dataset':id}
 const post=async(action,data,status=200)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(r.status(),status,await r.text());return r.json()}
 let lastUpload
 const prepare=async(value,catchup=false,expected=200)=>{headers['X-Import-Dataset']=value.projectId;const bytes=Buffer.from(JSON.stringify(value)),hash=createHash('sha256').update(bytes).digest('hex');let up;for(let index=0;index<Math.ceil(bytes.length/65536);index++){const chunk=bytes.subarray(index*65536,(index+1)*65536);up=await post('uploads',{...up?{uploadId:up.uploadId}:{},name:'synthetic-bifocal-tableau.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:Math.ceil(bytes.length/65536),index,chunkSha256:createHash('sha256').update(chunk).digest('hex'),base64:chunk.toString('base64')})}lastUpload=up.uploadId;return post('plan',{uploadId:up.uploadId,...catchup?{catchup:true}:{}},expected)}
 const apply=async p=>{for(let i=0;i<20;i++){if((await post('apply',{planId:p.planId,reviewedFingerprint:p.fingerprint})).job.state==='completed'){assert.equal((await post('reconcile',{planId:p.planId})).ok,true);return}}assert.fail('Tableau apply did not complete')}
 const base='/migration-projects/'+id
 await page.goto(origin+'/app/import');await page.getByText('Import Tableau sources and Pulse',{exact:true}).click()
 const form=page.locator('#tableau-import-form');await form.getByLabel('Tableau project ID',{exact:true}).fill(id);await form.getByLabel('Tableau site ID',{exact:true}).fill(input.tableau.siteId);await form.getByLabel('Source cutoff',{exact:true}).fill(input.cutoff)
 await form.getByLabel('Published source references (JSON)',{exact:true}).fill(JSON.stringify(input.tableau.publishedSources));await form.getByLabel('Pulse physical bindings (JSON)',{exact:true}).fill(JSON.stringify(input.tableau.bindings));await form.getByLabel('Rollback plan',{exact:true}).fill(input.rollbackPlan)
 await form.getByLabel('Tableau original files',{exact:true}).setInputFiles(input.tableau.files.map(f=>({name:f.path,mimeType:'application'+'/'+'octet-stream',buffer:/\.tdsx$/.test(f.path)?Buffer.from(f.content,'base64'):Buffer.from(f.content)})))
 const planResponse=page.waitForResponse(r=>r.url().endsWith('/import/plan'));await form.getByRole('button',{name:'Review Tableau import',exact:true}).click();const p=await (await planResponse).json();assert.equal(p.counts.rejected,0,JSON.stringify(p));assert.equal(p.project.tableau.drafts.length,2,JSON.stringify(p.project.tableau.diagnostics))
 assert.deepEqual(p.project.tableau.records.filter(r=>r.kind==='extract').map(r=>r.file),['sales.tdsx/Data/one.hyper','sales.tdsx/Data/two.hyper'])
 assert.deepEqual(p.project.tableau.records.filter(r=>r.kind==='follower').map(r=>r.value.follower),[{user_id:'source-user'},{group_id:'source-group'}])
 assert.ok(p.project.tableau.records.some(r=>r.kind==='unsupported-package-item'&&r.file.endsWith('unsupported.txt')))
 assert.ok(p.project.tableau.records.filter(r=>r.kind==='pulse-metric').every(r=>r.dependencies.length===1))
 assert.deepEqual(p.project.tableau.records.map(r=>r.id).sort(),[
  'file:sales.tdsx','package:sales.tdsx/Data/Sales.tds','package:sales.tdsx/Data/one.hyper','package:sales.tdsx/Data/two.hyper','package:sales.tdsx/unsupported.txt',
  'file:sum.definition.json','definition:definition-sum','file:distinct.definition.json','definition:definition-distinct','file:sum.metric.json','metric:metric-sum','file:distinct.metric.json','metric:metric-distinct','file:followers.json','follower:follower-1','follower:follower-2','source:published-sales',
  'tds:published-sales:datasource.Sales','tds:published-sales:datasource.Sales.[id]','tds:published-sales:datasource.Sales.[amount]','tds:published-sales:datasource.Sales.[customer]','tds:published-sales:datasource.Sales.[date]','tds:published-sales:datasource.Sales.[region]'
 ].sort())
 assert.equal(p.project.tableau.models[0].project.tables[0].sourceTable,'sales.csv')
 assert.equal(p.project.tableau.records.find(r=>r.kind==='tds').value.sha256,createHash('sha256').update(tds).digest('hex'))
 assert.ok(p.project.tableau.records.every(r=>/^[a-f0-9]{64}$/.test(r.digest)));assert.equal(p.project.tableau.input.publishedSources[0].refresh.mode,'incremental');assert.equal(p.project.tableau.records.find(r=>r.id==='metric:metric-sum').value.goals.threshold.value,25)
 await proveScreen('tableau-review',{widths:[1440,390]});await page.setViewportSize({width:1440,height:1000})
 await page.getByLabel('I reviewed this exact inactive inventory and all gaps',{exact:true}).check();await page.getByRole('button',{name:'Apply Tableau import',exact:true}).click();await page.locator('#tableau-status').filter({hasText:'applied and reconciled'}).waitFor()
 let current=await call(base);assert.equal(current.state,'inactive');assert.equal(current.grants,'none');assert.equal(current.dispatch,'unavailable')
 await page.getByRole('button',{name:'Undo Tableau import',exact:true}).click();await page.locator('#tableau-status').filter({hasText:'import undone'}).waitFor();await call(base,undefined,404)
 // Replay goes through a new retained plan after Undo, with the same source IDs.
 const again=await prepare(input);await apply(again);current=await call(base)
 await page.getByRole('button',{name:'Load Tableau project',exact:true}).click();await page.locator('#tableau-status').filter({hasText:'project loaded'}).waitFor()
 const originalsResponse=await context.request.get(origin+'/api/operator/import/original/'+again.planId,{headers});assert.equal(originalsResponse.status(),200);assert.deepEqual(JSON.parse(Buffer.from((await originalsResponse.json()).originals[0].original.base64,'base64').toString('utf8')),input)
 await page.getByRole('button',{name:'Inspect Tableau originals',exact:true}).click();await page.locator('#tableau-status').filter({hasText:'originals loaded'}).waitFor()
 const reviewResponse=page.waitForResponse(r=>r.url().endsWith('/tableau-review'));await page.getByRole('button',{name:'Preview native metric metric-sum',exact:true}).click();const previewResponse=await reviewResponse;assert.equal(previewResponse.status(),200,await previewResponse.text());const review=await previewResponse.json();assert.equal(review.after.value.value,'26.03');assert.equal(review.after.value.nulls,1);assert.equal(review.document.definition.unit,'money');assert.equal(review.productionSends,0);assert.equal(review.sourceWrites,0)
 await proveScreen('tableau-native-preview',{widths:[1440,390]});await page.setViewportSize({width:1440,height:1000})
 const exact={reviewedRevision:current.revision,sourceMetric:'metric-sum',previousRevision:null}
 await call(base+'/tableau-apply',{...exact,reviewedDigest:'0'.repeat(64)},409)
 await page.getByLabel('I reviewed this exact native metric draft and value',{exact:true}).check();await page.getByRole('button',{name:'Save reviewed metric draft',exact:true}).click();await page.locator('#tableau-status').filter({hasText:'uncertified draft'}).waitFor()
 const native=await call('/metric-definitions/'+review.document.id);assert.equal(native.certifiedRevision,null);await call('/metrics/'+review.document.id+'/run',{},409)
 const certified=await call('/metrics/'+review.document.id+'/approve',{revision:1,digest:native.digest,annotation:'Current owner independently reviewed this native metric.',confirm:'approve'},200);assert.equal(certified.state,'certified')
 const certifiedRun=await call('/metrics/'+review.document.id+'/run',{});assert.equal(certifiedRun.answer.totals.value.value,'26.03')
 await call(base+'/erase',{confirmImport:id,reviewedRevision:current.revision},409)
 const distinct=await call(base+'/tableau-review',{reviewedRevision:current.revision,sourceMetric:'metric-distinct',previousRevision:null},200);assert.equal(distinct.after.value.value,'3');assert.equal(distinct.after.value.nulls,1)
 const distinctApply={reviewedRevision:current.revision,sourceMetric:'metric-distinct',previousRevision:null,reviewedDigest:distinct.digest}
 const winners=await Promise.all([1,2].map(()=>context.request.post(origin+'/api/operator'+base+'/tableau-apply',{headers:{Origin:origin},data:distinctApply})));assert.deepEqual(winners.map(r=>r.status()).sort(),[201,409])
 await post('undo',{planId:again.planId},409)
 for(const [name,field,literal,sumValue,distinctValue] of [['null','customer',{null_value:'NULL_VALUE'},'-4.00','0'],['all-null-sum','customer',{string_value:'B'},null,'1']]){
  const scoped=structuredClone(input);scoped.projectId='synthetic-bifocal-tableau-'+name
  for(const file of scoped.tableau.files){
   if(file.path.endsWith('.definition.json')){const value=JSON.parse(file.content);value.definition.extension_options.allowed_dimensions.push('customer');file.content=JSON.stringify(value)}
   if(file.path.endsWith('.metric.json')){const value=JSON.parse(file.content);value.metric.specification.filters=[{field,operator:'OPERATOR_EQUAL',categorical_values:[literal],include_null:literal.null_value==='NULL_VALUE'}];file.content=JSON.stringify(value)}
  }
  const scopedPlan=await prepare(scoped);await apply(scopedPlan);const stored=await call('/migration-projects/'+scoped.projectId)
  const sum=await call('/migration-projects/'+scoped.projectId+'/tableau-review',{reviewedRevision:stored.revision,sourceMetric:'metric-sum',previousRevision:null},200),count=await call('/migration-projects/'+scoped.projectId+'/tableau-review',{reviewedRevision:stored.revision,sourceMetric:'metric-distinct',previousRevision:null},200)
  assert.equal(sum.after.value.value,sumValue);assert.equal(count.after.value.value,distinctValue)
 }
 headers['X-Import-Dataset']=id
 // Native edits invalidate the exact imported draft, preserving both versions.
 const edited=await call(base+'/edit',{reviewedRevision:current.revision,itemId:current.items[0].source.id,native:'Native reconstruction changed'},200)
 await call(base+'/tableau-review',exact,409);await call(base+'/tableau-review',{...exact,reviewedRevision:edited.revision,previousRevision:1},409)
 current=await call(base)
 const foreign=await context.request.post(origin+'/api/operator'+base+'/tableau-review',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:exact});assert.equal(foreign.status(),401)
 for(const path of [base,base+'/versions/'+current.history[0].revision])assert.equal((await context.request.get(origin+'/api/operator'+path,{headers:{Authorization:'Bearer synthetic-bifocal-1'}})).status(),401)
 assert.equal((await context.request.post(origin+'/api/operator'+base+'/tableau-apply',{headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-1'},data:{...exact,reviewedDigest:review.digest}})).status(),401)
 const memberAddress=['synthetic-bifocal-tableau-member','example.test'].join('@')
 const invite=await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email:memberAddress,displayName:'Synthetic Tableau member',role:'member'}});assert.equal(invite.status(),202)
 const member=await context.browser().newContext()
 try{
  const entered=await member.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(memberAddress),{headers:{'x-rer-dev-key':'synthetic-bifocal-9'.repeat(3)},maxRedirects:0});assert.equal(entered.status(),303)
  assert.equal((await member.request.get(origin+'/api/operator'+base)).status(),401)
  assert.equal((await member.request.get(origin+'/api/operator/import/original/'+again.planId,{headers})).status(),401)
  for(const action of ['tableau-review','tableau-apply','erase'])assert.equal((await member.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:origin},data:{...exact,reviewedDigest:review.digest,confirmImport:id}})).status(),401)
 }finally{await member.close()}
 // Security and incomplete content can be inspected but can never yield executable drafts.
 for(const kind of ['security','missing-tds','dependency','unsupported-aggregation','incomplete-followers','filter','schema','binding-type','contradictory-null']){
  const bad=structuredClone(input);bad.projectId='synthetic-bifocal-tableau-'+kind
  if(kind==='security')bad.tableau.files[0]={path:'sales.tdsx',content:Buffer.from(zipSync({'Data/Sales.tds':strToU8(tds.replace('</datasource>','<filter class="user"/></datasource>'))})).toString('base64')}
  if(kind==='missing-tds')bad.tableau.files[0].content=Buffer.from(zipSync({'Data/one.hyper':strToU8('synthetic-bifocal-1')})).toString('base64')
  if(kind==='dependency')bad.tableau.publishedSources[0].dependencies=['absent-source']
  if(kind==='unsupported-aggregation'){for(const file of bad.tableau.files.filter(f=>f.path.endsWith('.definition.json')))file.content=file.content.replace(/AGGREGATION_SUM|AGGREGATION_COUNT_DISTINCT/g,'AGGREGATION_MEDIAN')}
  if(kind==='incomplete-followers')bad.tableau.files.at(-1).content=JSON.stringify({subscriptions:[],next_page_token:'synthetic-bifocal-1'})
  if(kind==='filter'){for(const file of bad.tableau.files.filter(f=>f.path.endsWith('.metric.json')))file.content=file.content.replace('OPERATOR_EQUAL','OPERATOR_NOT_EQUAL')}
  if(kind==='contradictory-null')for(const file of bad.tableau.files.filter(f=>f.path.endsWith('.metric.json'))){const value=JSON.parse(file.content);value.metric.specification.filters=[{field:'region',operator:'OPERATOR_EQUAL',categorical_values:[{null_value:'NULL_VALUE'}],include_null:false}];file.content=JSON.stringify(value)}
  if(kind==='binding-type')for(const binding of Object.values(bad.tableau.bindings))binding.columns.region='amount'
  if(kind==='schema'){for(const file of bad.tableau.files.filter(f=>f.path.endsWith('.metric.json')))file.content=file.content.replace('1.0.0','2.0.0')}
  const rejected=await prepare(bad);assert.equal(rejected.counts.rejected,0,kind);assert.equal(rejected.project.tableau.drafts.length,0,kind);assert.ok(rejected.project.tableau.diagnostics.some(d=>d.blocksPreview),kind);await apply(rejected);const inert=await call('/migration-projects/'+bad.projectId);await call('/migration-projects/'+bad.projectId+'/tableau-review',{reviewedRevision:inert.revision,sourceMetric:'metric-sum',previousRevision:null},409)
 }
 for(const kind of ['path','xml','credential-xml','credential-json','credential-archive']){
  const bad=structuredClone(input);bad.projectId='synthetic-bifocal-tableau-'+kind
  if(kind==='path')bad.tableau.files[0].content=Buffer.from(zipSync({'../bad.tds':strToU8(tds)})).toString('base64')
  if(kind==='xml')bad.tableau.files[0].content=Buffer.from(zipSync({'Data/Sales.tds':strToU8('<!DOCTYPE datasource [<!ENTITY x SYSTEM "file:///synthetic-bifocal">]>'+tds)})).toString('base64')
  if(kind==='credential-xml')bad.tableau.files[0].content=Buffer.from(zipSync({'Data/Sales.tds':strToU8(tds.replace('class="textscan"','class="textscan" password="synthetic-bifocal-1"'))})).toString('base64')
  if(kind==='credential-json'){const parsed=JSON.parse(bad.tableau.files[1].content);parsed.definition.metadata.description='password=synthetic-bifocal-1';bad.tableau.files[1].content=JSON.stringify(parsed)}
  if(kind==='credential-archive')bad.tableau.files[0].content=Buffer.from(zipSync({'Data/Sales.tds':strToU8(tds),'private.txt':strToU8('password=synthetic-bifocal-1')})).toString('base64')
  const refusal=await prepare(bad,false,422)
  if(kind.startsWith('credential')){assert.equal(refusal.error,'source_credential');assert.ok(!JSON.stringify(refusal).includes('synthetic-bifocal-1'));const historyResponse=await context.request.get(origin+'/api/operator/import/history',{headers});assert.equal(historyResponse.status(),200);const history=await historyResponse.json();assert.equal(history.history.length,0);await post('uploads',{uploadId:lastUpload},404)}else{assert.equal(refusal.error,'tableau_source_refused');await post('uploads',{uploadId:lastUpload},404)}
 }
 headers['X-Import-Dataset']=id
 // Source changes refuse both new preview and a previously reviewed native save.
 const clean=structuredClone(input);clean.projectId='synthetic-bifocal-tableau-drift';const driftPlan=await prepare(clean);await apply(driftPlan);const drift=await call('/migration-projects/'+clean.projectId),driftInput={reviewedRevision:drift.revision,sourceMetric:'metric-sum',previousRevision:null},driftReview=await call('/migration-projects/'+clean.projectId+'/tableau-review',driftInput,200)
 await upload(dataset,csv.replace('$10.01','$11.01'),true);await call('/migration-projects/'+clean.projectId+'/tableau-review',driftInput,409);await call('/migration-projects/'+clean.projectId+'/tableau-apply',{...driftInput,reviewedDigest:driftReview.digest},409)
 const changed=await call('/datasets/'+dataset)
 const policy=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedDatasetRevision:changed.revision,previousRevision:null,legalHold:true,minimumRetainUntil:null,releaseHold:false}});assert.equal(policy.status(),200);const policyValue=await policy.json()
 await call('/migration-projects/'+clean.projectId+'/erase',{confirmImport:clean.projectId,reviewedRevision:drift.revision},423);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:changed.revision},423)
 const release=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedDatasetRevision:changed.revision,previousRevision:policyValue.revision,legalHold:false,minimumRetainUntil:null,releaseHold:true}});assert.equal(release.status(),200)
 const erased=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:changed.revision},200);assert.ok(erased.tableauProjects.length>=2)
 await call('/queries/'+certifiedRun.queryId,undefined,404)
 await call(base,undefined,404);assert.equal((await call('/metric-definitions/'+review.document.id)).document,null);assert.equal((await call('/metric-definitions/'+distinct.document.id)).document,null);await call(base+'/versions/'+current.history[0].revision,undefined,404)
 headers['X-Import-Dataset']=id
 const original=await context.request.get(origin+'/api/operator/import/original/'+again.planId,{headers});assert.equal(original.status(),200);assert.ok((await original.json()).originals.every(o=>o.original.status==='unavailable'&&!o.original.base64))
 await post('apply',{planId:again.planId,reviewedFingerprint:again.fingerprint},410)
 console.log('PROBE BIF-084 package and Pulse intake: /app/import TDSX and original responses -> two extracts, two followers, dependency links, versions, digests and inactive references enumerated')
 console.log('PROBE BIF-084 native drafts: current-owner preview over reviewed snapshot -> USD 26.03 with one null, distinct 3 with one null, exact July and West filters, uncertified drafts')
 console.log('PROBE BIF-084 safety and drift: import plan, preview and draft Apply -> unsafe archive and XML, credentials, incomplete evidence, unresolved security, unsupported semantics, source drift, stale review and machine authority refused')
 console.log('PROBE BIF-084 concurrency and authority: exact native draft Apply twice -> one 201 and one 409; member, foreign and bearer requests refused without mutation')
 console.log('PROBE BIF-084 custody: reviewed Undo and retained original read, held and eligible source erase -> Undo reconciled; hold refused; originals, history and derived drafts withdrawn; replay refused')
}
