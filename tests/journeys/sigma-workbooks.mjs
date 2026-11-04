import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {dump} from 'js-yaml'

// Self-authored documented-format specimens prove bounded parsing and native
// reconstruction only. They are not an authorized Sigma estate or parity proof.
export async function proveSigmaWorkbooks({origin,context,page,call,upload,proveScreen}){
 const dataset='synthetic-bifocal-sigma-source',id='synthetic-bifocal-sigma',base='/migration-projects/'+id
 const csv='invoice,customer,region,revenue\n1,a,West,$100.10\n2,a,West,-$20.05\n3,b,West,$0.00\n4,,West,\n5,b,East,$7.00\n6,c,West,$5.00\n7,d,,$6.00\n'
 await upload(dataset,csv)
 const native=await call('/datasets/'+dataset),physical=(id,name)=>({id,name,formula:'['+['ORDERS',name].join('/')+']'})
 const document={workbookId:'synthetic-bifocal-workbook',latestVersion:7,documentVersion:9,name:'Regional revenue and adjustments',contents:{schemaVersion:1,kind:'workbook',pages:[{id:'summary',name:'Revenue'},{id:'adjustments',name:'Adjustment review'}],elements:[
  {id:'revenue-table',kind:'table',name:'Regional revenue',source:{kind:'warehouse-table',connectionId:'synthetic-bifocal-reference',path:['DB','PUBLIC','ORDERS']},columns:[physical('invoice','INVOICE'),physical('customer','CUSTOMER'),physical('region','REGION'),{...physical('amount','AMOUNT'),name:'Amount'},{id:'sum',name:'Revenue',formula:'Sum([Amount])'},{id:'distinct',name:'Customers',formula:'CountDistinct([CUSTOMER])'}],groupings:[{id:'region-group',groupBy:['region'],calculations:['sum','distinct']}]},
  {id:'region-control',kind:'control',controlId:'region-selection',name:'Region',controlType:'text',mode:'equals',case:'sensitive',includeNulls:'when-no-value-is-selected',value:'West',filters:[{source:{kind:'table',elementId:'revenue-table'},columnId:'region'}]},
  {id:'adjustment-input',kind:'input-table',name:'Adjustments',source:{kind:'empty',connectionId:'synthetic-bifocal-reference'},inputMode:'edit',columns:[{id:'note',type:'text'},{id:'amount',type:'number'}],actions:[{id:'write',trigger:'on-click',effects:[{effect:'insert-rows',tableElementId:'adjustment-input',values:{amount:'100'}}]}]},
  {id:'sql-table',kind:'table',source:{kind:'sql',connectionId:'synthetic-bifocal-reference',statement:'UPDATE ORDERS SET AMOUNT = 0; SELECT * FROM ORDERS'},columns:[{id:'sql-expression',formula:'fetch("https://synthetic-bifocal.invalid/collect")'}]},
  {id:'unsupported-table',kind:'table',source:{kind:'table',elementId:'revenue-table',groupingId:'region-group',unmappedSourceProperty:true},columns:[{id:'unresolved',formula:'[Missing] + 1',unmappedColumnProperty:true}],unmappedElementProperty:{retained:true}},
  {id:'outbound-button',kind:'button',name:'Inactive outbound action',actions:[{id:'send',trigger:'on-click',effects:[{effect:'call-api',url:'https://synthetic-bifocal.invalid/collect',body:'globalThis.syntheticBifocalExecuted = true'}]}]}
 ],layout:'<Layout><Page id="summary"><Element elementId="revenue-table"/><Element elementId="region-control"/></Page><Page id="adjustments"><Element elementId="adjustment-input"/><Element elementId="sql-table"/><Element elementId="unsupported-table"/><Element elementId="outbound-button"/></Page></Layout>'}}
 const reconstruction={security:'reviewed-current-native-owner-only',context:{modelVersion:'sigma-draft',metricVersion:'reviewed',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-july',version:1},rounding:'half-even'},bindings:{'revenue-table':{dataset,revision:native.revision,connectionId:'synthetic-bifocal-reference',path:['DB','PUBLIC','ORDERS'],grain:['invoice'],columns:{invoice:{source:'INVOICE',native:'invoice'},customer:{source:'CUSTOMER',native:'customer'},region:{source:'REGION',native:'region'},amount:{source:'AMOUNT',native:'revenue'}},groupBy:['region'],measures:{sum:{id:'revenue',unit:'money',scale:2,sourceCurrency:'USD'},distinct:{id:'customers',unit:'count',scale:0}},controls:['region-control']}}}
 const headers={Origin:origin,'X-Import-Kind':'sigma-workbook','X-Import-Dataset':id}
 const post=async(action,data,status=200)=>{const r=await context.request.fetch(origin+'/api/operator/import/'+action,{method:data===undefined?'GET':'POST',headers,...(data===undefined?{}:{data})});assert.equal(r.status(),status,await r.text());return r.json()}
 const envelope=(doc=document,mapping=reconstruction,projectId=id)=>({version:1,projectId,source:'sigma',cutoff:'2026-10-30T12:00:00Z',rollbackPlan:'Keep the incumbent active; no imported source actions run.',sigma:{filename:'synthetic-bifocal-workbook.yaml',content:dump(doc,{noRefs:true})},reconstruction:mapping})
 const prepare=async(input,catchup=true)=>{const bytes=Buffer.from(JSON.stringify(input)),hash=createHash('sha256').update(bytes).digest('hex');const u=await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')});return post('plan',{uploadId:u.uploadId,...(catchup?{catchup:true}:{})})}
 const apply=async plan=>{for(let i=0;i<20;i++){const value=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(value.job.state==='completed'){assert.equal((await post('reconcile',{planId:plan.planId})).ok,true);return}}assert.fail('Sigma shared-door apply incomplete')}
 const screen=async(label,target)=>{await proveScreen(label);for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator(target).first().scrollIntoViewIfNeeded();await proveScreen(label+'-visible',{widths:[width],resize:false,fullPage:false})}}
 const outbound=[];page.on('request',r=>{if(r.url().startsWith('https://synthetic-bifocal.invalid'))outbound.push(r.url())})
 await page.goto(origin+'/app/import');await page.locator('#sigma-import > summary').click()
 const form=page.locator('#sigma-form');await form.getByLabel('Migration project ID',{exact:true}).fill(id);await form.getByLabel('Source cutoff (UTC)').fill('2026-10-30T12:00:00Z');await form.getByLabel('Rollback plan',{exact:true}).fill('Keep the incumbent active; no imported source actions run.');await form.getByLabel('Reviewed reconstruction (JSON)').fill(JSON.stringify(reconstruction,null,2));await form.getByLabel('Sigma workbook code').setInputFiles({name:'synthetic-bifocal-workbook.yaml',mimeType:'application/octet-stream',buffer:Buffer.from(dump(document,{noRefs:true}))})
 const [preview]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/import/plan')),form.getByRole('button',{name:'Review Sigma import',exact:true}).click()]);assert.equal(preview.status(),200);const plan=await preview.json();assert.equal(plan.counts.rejected,0,JSON.stringify(plan))
 const observed=plan.project.sigma
 assert.deepEqual(observed.contents.elements.map(e=>e.id),['revenue-table','region-control','adjustment-input','sql-table','unsupported-table','outbound-button'])
 assert.deepEqual(observed.pageElements,{summary:['revenue-table','region-control'],adjustments:['adjustment-input','sql-table','unsupported-table','outbound-button']})
 assert.deepEqual(observed.document,document);assert.deepEqual(observed.sources,[{id:dataset,revision:native.revision}])
 assert.deepEqual(observed.issues.filter(i=>i.location.includes('unmapped')).map(i=>i.location).sort(),['elements[4].columns[0].unmappedColumnProperty','elements[4].source.unmappedSourceProperty','elements[4].unmappedElementProperty'])
 assert.equal(observed.drafts.find(d=>d.element==='revenue-table').issues.length,0)
 assert.ok(observed.drafts.filter(d=>d.element!=='revenue-table').every(d=>d.definition===null))
 await page.getByRole('status').filter({hasText:'Sigma inactive plan ready'}).waitFor();await screen('sigma-review','#sigma-review h3')
 await post('apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},403)
 await page.getByLabel('I reviewed this exact inactive Sigma plan').check();await page.getByRole('button',{name:'Apply Sigma import',exact:true}).click();await page.getByRole('status').filter({hasText:'Sigma import applied and reconciled'}).waitFor()
 let current=await call(base);assert.equal(current.state,'inactive');assert.equal(current.grants,'none');assert.equal(current.dispatch,'unavailable')
 const draft=current.sigma.drafts.find(d=>d.element==='revenue-table'),input=()=>({document:JSON.stringify(draft.definition),migrationProject:id,migrationRevision:current.revision,migrationElement:'revenue-table'})
 const [nativeReviewResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/model-authoring/review')),page.getByRole('button',{name:'Review native preview',exact:true}).first().click()]);assert.equal(nativeReviewResponse.status(),200);const reviewed=await nativeReviewResponse.json(),answer=reviewed.impacts[0].answer
 assert.equal(reviewed.compatible,true);assert.equal(answer.filteredRows,5);assert.equal(answer.totals.revenue.value,'85.05');assert.equal(answer.totals.revenue.nulls,1);assert.equal(answer.totals.customers.value,'3');assert.deepEqual(answer.rows.map(r=>r.dimensions),[['West']])
 await page.getByRole('status').filter({hasText:'Sigma native preview reviewed'}).waitFor();await screen('sigma-native-preview','#sigma-current > section')
 const [createdResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/model-authoring/create')),page.getByRole('button',{name:'Save reviewed native draft',exact:true}).first().click()]);assert.equal(createdResponse.status(),201);const created=await createdResponse.json();await page.getByRole('status').filter({hasText:'Sigma native draft saved'}).waitFor();await screen('sigma-native-draft','#sigma-current > section')
 const branch='/models/'+created.modelId+'/branches/'+created.branchId,validation=await call(branch+'/validate',{},200),snapshot=await call(branch+'/preview',{viewId:draft.definition.views[0].id,digest:validation.digest})
 assert.equal(snapshot.answer.totals.revenue.value,'85.05');assert.equal(snapshot.productionSends,0);assert.equal(snapshot.sourceWrites,0)
 const original=await post('original/'+plan.planId);assert.deepEqual(JSON.parse(Buffer.from(original.originals[0].original.base64,'base64').toString()).sigma,{filename:'synthetic-bifocal-workbook.yaml',content:dump(document,{noRefs:true})})
 // Credentials never enter retained original custody or create a history row.
 const secret=envelope();secret.sigma.content=dump({...document,password:'synthetic-bifocal-1'});const bytes=Buffer.from(JSON.stringify(secret)),hash=createHash('sha256').update(bytes).digest('hex'),beforeHistory=await post('history')
 const refusedSecret=await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')},422);assert.equal(refusedSecret.error,'migration_secret_excluded');assert.deepEqual(await post('history'),beforeHistory)
 for(const planted of ["SELECT 1; password='synthetic-bifocal-2'",'https://synthetic-bifocal.invalid?%61pi_key=synthetic-bifocal-3']){
  const specimen=envelope(),original=structuredClone(document);original.contents.elements[3].source.statement=planted;specimen.sigma.content=JSON.stringify(original)
  const encoded=Buffer.from(JSON.stringify(specimen)),fingerprint=createHash('sha256').update(encoded).digest('hex')
  await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:fingerprint,totalBytes:encoded.length,totalChunks:1,index:0,chunkSha256:fingerprint,base64:encoded.toString('base64')},422)
 }
 assert.deepEqual(await post('history'),beforeHistory)
 for(const change of [d=>{d.contents.schemaVersion=2},d=>{d.contents.elements[0].id=d.contents.elements[1].id}]){const invalid=structuredClone(document);change(invalid);const rejected=await prepare(envelope(invalid));assert.equal(rejected.counts.rejected,1);await post('apply',{planId:rejected.planId,reviewedFingerprint:rejected.fingerprint},422);await post('undo',{planId:rejected.planId})}
 const absent=structuredClone(document);delete absent.contents.layout;delete absent.documentVersion;absent.contents.elements[3].source={kind:'data-model',dataModelId:'unprovided',elementId:'missing'}
 const missing=await prepare(envelope(absent));assert.ok(missing.project.sigma.issues.some(i=>i.code==='absent_evidence'&&i.location==='contents.layout'));assert.ok(missing.project.sigma.issues.some(i=>i.code==='unsupported_construct'&&i.element==='sql-table'));await post('undo',{planId:missing.planId})
 const unresolved=structuredClone(reconstruction);delete unresolved.security;const denied=await prepare(envelope(document,unresolved));assert.equal(denied.project.sigma.drafts.find(d=>d.element==='revenue-table').definition,null);await post('undo',{planId:denied.planId})
 // Changing a physical snapshot invalidates both retained plan and native review.
 const stalePlan=await prepare(envelope());await upload(dataset,csv.replace('$100.10','$101.10'),true)
 await call('/model-authoring/create',{...input(),reviewedDigest:reviewed.digest},409);await call(branch+'/preview',{viewId:draft.definition.views[0].id,digest:validation.digest},409)
 await post('apply',{planId:stalePlan.planId,reviewedFingerprint:stalePlan.fingerprint},409);await post('undo',{planId:stalePlan.planId})
 assert.equal((await call(base)).revision,current.revision);assert.equal((await call('/queries/'+snapshot.queryId)).answer.totals.revenue.value,'85.05')
 await upload(dataset,csv,true);reconstruction.bindings['revenue-table'].revision=(await call('/datasets/'+dataset)).revision
 await apply(await prepare(envelope()));current=await call(base)
 // Reopen and compare an independently changed control, then restore West.
 const east=structuredClone(document);east.documentVersion=10;east.contents.elements[1].value='East';await apply(await prepare(envelope(east)));current=await call(base)
 const eastDraft=current.sigma.drafts.find(d=>d.element==='revenue-table'),eastReview=await call('/model-authoring/review',{document:JSON.stringify(eastDraft.definition),migrationProject:id,migrationRevision:current.revision,migrationElement:'revenue-table'},200)
 assert.equal(eastReview.impacts[0].answer.totals.revenue.value,'7.00');assert.equal(eastReview.impacts[0].answer.totals.customers.value,'1')
 document.documentVersion=11;await apply(await prepare(envelope()));current=await call(base)
 // Edit a real native model branch. Its stable source item becomes a conflict
 // on a later Sigma delta; the importer never overwrites that native edit.
 const newest=current.sigma.drafts.find(d=>d.element==='revenue-table'),newInput={document:JSON.stringify(newest.definition),migrationProject:id,migrationRevision:current.revision,migrationElement:'revenue-table'}
 const review=await call('/model-authoring/review',newInput,200),nativeModel=await call('/model-authoring/create',{...newInput,reviewedDigest:review.digest})
 const edited=structuredClone(newest.definition);edited.views[0].query.measures[0].id='native-revenue'
 const editInput={document:JSON.stringify(edited),modelId:nativeModel.modelId,branchId:nativeModel.branchId,previousVersion:1},editReview=await call('/model-authoring/review',editInput,200);await call('/model-authoring/create',{...editInput,reviewedDigest:editReview.digest})
 current=await call(base);assert.deepEqual(JSON.parse(current.items.find(i=>i.source.id===newest.itemId).native),edited)
 const delta=structuredClone(document);delta.documentVersion=12;delta.contents.elements[0].name='Changed source revenue';delta.contents.elements.reverse();delta.contents.pages.push({id:'new-page',name:'New page'})
 const deltaPlan=await prepare(envelope(delta));await apply(deltaPlan);current=await call(base)
 const conflicted=current.items.find(i=>i.source.id===newest.itemId);assert.ok(conflicted.conflict);assert.equal(JSON.parse(conflicted.native).views[0].query.measures[0].id,'native-revenue');assert.equal(JSON.parse(conflicted.conflict.original).name,'Changed source revenue')
 await call('/model-authoring/review',{...newInput,migrationRevision:current.revision},409)
 await page.getByRole('button',{name:'Load Sigma project',exact:true}).click();await page.getByRole('status').filter({hasText:'Sigma project loaded'}).waitFor();await screen('sigma-native-conflict','#sigma-current')
 const staleRevision=current.revision;current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:newest.itemId,choice:'keep-native'},200);await call(base+'/resolve',{reviewedRevision:staleRevision,itemId:newest.itemId,choice:'use-source'},409)
 assert.equal(JSON.parse(current.items.find(i=>i.source.id===newest.itemId).native).views[0].query.measures[0].id,'native-revenue');current=await call(base)
 // A machine bearer cannot borrow the owner's session on any Sigma door.
 const machine={Origin:origin,Authorization:'Bearer synthetic-bifocal-1'}
 for(const [path,data] of [[base,undefined],['/model-authoring/review',newInput],[base+'/erase',{confirmImport:id,reviewedRevision:current.revision}],[branch+'/preview',{viewId:draft.definition.views[0].id,digest:validation.digest}]])await call(path,data,401,machine)
 const beforeReplay=await call(base);await post('apply',{planId:deltaPlan.planId,reviewedFingerprint:deltaPlan.fingerprint},200);assert.deepEqual(await call(base),beforeReplay)
 const memberName=['synthetic-bifocal-sigma-member','example.test'].join('@');assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email:memberName,displayName:'Synthetic Sigma member',role:'member'}})).status(),202)
 const member=await context.browser().newContext()
 try{assert.equal((await member.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(memberName),{headers:{'x-rer-dev-key':'synthetic-bifocal-9'.repeat(3)},maxRedirects:0})).status(),303);for(const path of [base,base+'/versions/'+current.history[0].revision])assert.equal((await member.request.get(origin+'/api/operator'+path)).status(),401);assert.equal((await member.request.post(origin+'/api/operator/model-authoring/review',{headers:{Origin:origin},data:newInput})).status(),401);assert.equal((await member.request.post(origin+'/api/operator/import/apply',{headers,data:{planId:deltaPlan.planId,reviewedFingerprint:deltaPlan.fingerprint}})).status(),401)}finally{await member.close()}
 // A second actual browser upload uses JSON and reaches shared-door Undo.
 const undoId='synthetic-bifocal-sigma-undo';await form.getByLabel('Migration project ID',{exact:true}).fill(undoId);await form.getByLabel('Reviewed reconstruction (JSON)').fill(JSON.stringify(reconstruction));await form.getByLabel('Sigma workbook code').setInputFiles({name:'synthetic-bifocal-workbook.json',mimeType:'application/octet-stream',buffer:Buffer.from(JSON.stringify(document))});await form.getByRole('button',{name:'Review Sigma import',exact:true}).click();await page.getByRole('status').filter({hasText:'Sigma inactive plan ready'}).waitFor();await page.getByLabel('I reviewed this exact inactive Sigma plan').check();await page.getByRole('button',{name:'Apply Sigma import',exact:true}).click();await page.getByRole('status').filter({hasText:'Sigma import applied and reconciled'}).waitFor();await page.getByText('Migration versions and originals',{exact:true}).click();await page.getByRole('button',{name:/^Undo Sigma import /}).first().waitFor();await page.getByRole('button',{name:/^Undo Sigma import /}).first().click();await page.getByRole('status').filter({hasText:'Sigma import undone.'}).waitFor();await screen('sigma-undone','#sigma-current');await call('/migration-projects/'+undoId,undefined,404)
 assert.deepEqual((await call('/datasets/'+dataset)).table.rows,native.table.rows);assert.equal(outbound.length,0);assert.equal(await page.evaluate(()=>globalThis.syntheticBifocalExecuted),undefined)
 // Eligible native source erasure reaches originals and derived native branches
 // for every version, including the separately undone project.
 const source=await call('/datasets/'+dataset)
 const setHold=async(legalHold,previousRevision,releaseHold=false)=>{const response=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,legalHold,minimumRetainUntil:null,releaseHold}});assert.equal(response.status(),200,await response.text());return response.json()}
 const hold=await setHold(true,null);await call(base+'/erase',{confirmImport:id,reviewedRevision:current.revision},423);assert.equal((await post('original/'+plan.planId)).originals[0].original.status,'retained');await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},423);await setHold(false,hold.revision,true)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200)
 for(const project of [id,undoId])await call('/migration-projects/'+project,undefined,404)
 for(const model of [created,nativeModel])await call('/models/'+model.modelId,undefined,404)
 await call('/queries/'+snapshot.queryId,undefined,404);await call(base+'/versions/'+current.history[0].revision,undefined,404)
 const erased=await post('original/'+plan.planId);assert.equal(erased.originals[0].original.status,'unavailable');assert.equal(erased.originals[0].original.base64,undefined);await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410)
 await form.getByLabel('Migration project ID',{exact:true}).fill(id);await page.getByRole('button',{name:'Load Sigma project',exact:true}).click();await page.getByRole('status').filter({hasText:'migration_project_not_found'}).waitFor();await screen('sigma-erased','#status')
 console.log('PROBE BIF-048 intake: original JSON and YAML -> reviewed shared plan, exact Apply, reconcile and browser Undo')
 console.log('PROBE BIF-048 inventory: six independently enumerated elements, stable pages, versions, nested unsupported properties and absent evidence -> retained inactive')
 console.log('PROBE BIF-048 native: reviewed physical snapshot -> USD 85.05, distinct 3, one null; equality East -> USD 7.00 and distinct 1; inactive native draft saved')
 console.log('PROBE BIF-048 stale: changed source and stale review -> 409 with native history unchanged; stable-ID source delta -> preserved native-edit conflict')
 console.log('PROBE BIF-048 authority: member and machine with owner session -> 401; SQL and actions -> zero writes and outbound requests; credential-bearing original -> 422')
 console.log('PROBE BIF-048 erasure: eligible source erasure -> originals unavailable, history and models and saved preview 404, replay 410')
}
