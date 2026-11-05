import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function proveMigrationProjects({origin,context,call,page,upload,proveScreen}){
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
 await proveLookerReconstruction({origin,context,call,page,upload,proveScreen})
 await proveLookMLDashboards({origin,context,call,page,upload,proveScreen})
 console.log('Migration projects: shared retained plans, exact approval, idempotent resume, deltas, native conflicts, both resolutions, original history, stale and foreign refusal, erasure and inert reconstruction inventories passed')
}

export async function proveLookerReconstruction({origin,context,page,call,upload,proveScreen}){
 console.log('Looker reconstruction journey started')
 page.setDefaultTimeout(30000)
 page.on('pageerror',error=>console.error('Reconstruction browser error:',error.message))
 const {assertLookerNativePreview}=await import('./model-import.mjs')
 const capture=async label=>{
  await page.setViewportSize({width:1440,height:1000})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Reconstruction fits desktop')
  assert.equal(await page.locator('#looker-current button').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).length),0,'Reconstruction controls have visible names')
  if(process.env.BIFOCAL_PROOF_DIR){const {mkdir}=await import('node:fs/promises'),{join}=await import('node:path');await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('#looker-current').screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png')})}}
  await page.setViewportSize({width:1440,height:1000})
 }
 const id='synthetic-bifocal-looker',base='/migration-projects/'+id,dataset=id+'-source',headers={Origin:origin,'X-Import-Kind':'migration-project','X-Import-Dataset':id}
 const csv='invoice,date,region,revenue,person\n1,07/01/2026,West,$10.01,A\n2,07/02/2026,West,-$0.03,A\n3,07/03/2026,East,$20.02,B\n4,08/01/2026,West,$99.00,C\n5,07/04/2026,East,,\n6,07/05/2026,North,$0.00,D\n'
 await upload(dataset,csv)
 const schedulesBefore=await call('/schedules'),peopleBefore=await (await context.request.get(origin+'/auth/operators')).json()
 const source=await call('/datasets/'+dataset),kinds=['page','data-source','field','blend','calculation','parameter','filter','layout','sharing','delivery']
 const query={version:1,dataset,joins:[],filters:[{column:'date',op:'gte',value:'2026-07-01'},{column:'date',op:'lte',value:'2026-07-31'}],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'},{id:'people',op:'count-distinct',column:'person',unit:'count',scale:0}],context:{modelVersion:'looker-reconstruction',metricVersion:'owner-1',accountingBasis:'not-applicable',calendar:{id:'synthetic-bifocal-july',version:1},rounding:'half-even'},semantic:{grain:['invoice'],dimensions:source.table.columns.map(c=>({column:c.name,type:c.type})),hierarchies:[],slowlyChanging:'reject-duplicate-grain'}}
 const expected={rows:[{dimensions:['West'],values:{revenue:'9.98',people:'1'}}],totals:{revenue:'9.98',people:'1'}}
 const document={sourceRevision:source.revision,definition:{views:[{id:'report-page',kind:'report',query,rowRules:[]}],quality:[]},parameters:[{id:'region',column:'region',type:'text',op:'eq',value:'West'}],reference:expected}
 const post=async(action,data,status=200)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(r.status(),status,await r.text());return r.json()}
 const prepare=async(input,catchup=false)=>{const bytes=Buffer.from(JSON.stringify(input)),hash=createHash('sha256').update(bytes).digest('hex'),u=await post('uploads',{name:'owner-reconstruction.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')});return post('plan',{uploadId:u.uploadId,...catchup?{catchup:true}:{}})}
 const apply=async p=>{assert.equal(p.counts.rejected,0,JSON.stringify(p));for(let n=0;n<20;n++){const r=await post('apply',{planId:p.planId,reviewedFingerprint:p.fingerprint});if(r.job.state==='completed'){assert.equal((await post('reconcile',{planId:p.planId})).ok,true);return}}assert.fail('Reconstruction import incomplete')}
 const input={version:1,projectId:id,source:'looker-studio',cutoff:'2026-10-15T12:00:00Z',rollbackPlan:'Keep the incumbent active; undo the exact import.',reportUrl:'https://lookerstudio.google.com/reporting/synthetic-bifocal-report',originals:[{name:'owner-notes.txt',content:'Self-authored inspection specimen. Supplied page and table; no API export is claimed.'}],evidence:kinds.map(kind=>({id:'evidence-'+kind,kind,sourceRevision:'owner-1',sourceLocation:'Owner inspection: '+kind,status:'supplied',original:['blend','calculation'].includes(kind)?'none':kind==='sharing'?'Owner only; imported shared viewers inactive':kind==='delivery'?'Weekly schedule retained inactive':'Owner-supplied '+kind})),drafts:[{id:'native-page',sourceRevision:'owner-1',document:JSON.stringify(document)}]}
 // Omitted categories are accounted for, rather than disappearing from inventory.
 const omitted={...structuredClone(input),projectId:id+'-omitted',evidence:[]};headers['X-Import-Dataset']=omitted.projectId
 const missing=await prepare(omitted);await apply(missing)
 const missingProject=await call('/migration-projects/'+omitted.projectId),missingReview=await call('/migration-projects/'+omitted.projectId+'/review',{reviewedRevision:missingProject.revision},200)
 assert.deepEqual(missingReview.issues.filter(i=>i.code==='inaccessible_evidence').map(i=>i.item).sort(),kinds.map(k=>'missing-'+k).sort());assert.equal(missingReview.drafts[0].answer,null)
 headers['X-Import-Dataset']=id
 console.log('Looker omitted evidence proved')
 // The actual browser guide starts with inaccessible definitions. Supplying them
 // is explicit and does not establish live source-output or cutover parity.
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.locator('#looker-reconstruction summary').first().click()
 await page.getByLabel('Reconstruction project ID',{exact:true}).fill(id)
 await page.getByLabel('Original report link',{exact:true}).fill(input.reportUrl)
 await page.getByLabel('Reviewed native dataset',{exact:true}).fill(dataset)
 await page.getByRole('button',{name:'Start reconstruction guide',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Guide started'}).waitFor()
 assert.equal(await page.getByLabel('page status',{exact:true}).inputValue(),'inaccessible')
 for(const evidence of input.evidence){await page.getByLabel(evidence.kind+' status',{exact:true}).selectOption(evidence.status);await page.getByLabel(evidence.kind+' original',{exact:true}).fill(evidence.original)}
 const opaqueCapture=Buffer.from([37,80,68,70,45,49,46,55,10,0,255,16])
 await page.getByLabel('Original evidence files',{exact:true}).setInputFiles([{name:'owner-notes.txt',mimeType:['text','plain'].join('/'),buffer:Buffer.from(input.originals[0].content)},{name:'owner-capture.pdf',mimeType:['application','pdf'].join('/'),buffer:opaqueCapture}])
 await page.getByLabel('Inactive native document (JSON)',{exact:true}).fill(JSON.stringify(document,null,2))
 await page.getByRole('button',{name:'Review reconstruction import',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Review the exact reconstruction plan'}).waitFor()
 await page.getByText('Inspect plan and retained source definitions',{exact:true}).click()
 const browserPlan=await page.locator('#looker-plan-summary').textContent();assert.match(browserPlan,/Owner-supplied reconstruction/)
 await page.getByLabel('I reviewed this exact reconstruction fingerprint',{exact:true}).check();await page.getByRole('button',{name:'Apply inactive reconstruction',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Inactive reconstruction imported'}).waitFor()
 assert.deepEqual(await call('/schedules'),schedulesBefore)
 assert.deepEqual(await (await context.request.get(origin+'/auth/operators')).json(),peopleBefore)
 console.log('Looker browser import applied')
 let current=await call(base)
 assert.equal(current.items.find(i=>i.source.id==='evidence-page').source.mapping,'supplied')
 await page.getByRole('button',{name:'Review native preview',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Current evidence reviewed'}).waitFor()
 assert.match(await page.getByRole('table',{name:'Reconstructed native values'}).innerText(),/West.*9.98.*1/s)
 await page.getByRole('button',{name:'Confirm exact native preview',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Exact native preview confirmed'}).waitFor()
 await capture('looker-reconstruction-native-preview')
 await page.getByRole('button',{name:'Inspect retained originals',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Retained originals inspected'}).waitFor();assert.match(await page.locator('#looker-original-text').textContent(),/owner-capture\.pdf/);await page.locator('#looker-original-view summary').click()
 const browserEdit=structuredClone(document);browserEdit.definition.views[0].query.context.metricVersion='owner-browser-edit'
 await page.getByLabel('Reconstruction item',{exact:true}).selectOption('native-page');await page.getByLabel('Edited reconstruction item',{exact:true}).fill(JSON.stringify(browserEdit));await page.getByRole('button',{name:'Save inactive edit',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Inactive edit saved'}).waitFor()
 current=await call(base);assert.deepEqual(JSON.parse(current.items.find(i=>i.source.id==='native-page').native),browserEdit)
 await page.getByLabel('Reconstruction item',{exact:true}).selectOption('native-page');await page.getByLabel('Edited reconstruction item',{exact:true}).fill(JSON.stringify(document));await page.getByRole('button',{name:'Save inactive edit',exact:true}).click();await page.locator('#looker-status').filter({hasText:'Inactive edit saved'}).waitFor();current=await call(base)
 let review=await call(base+'/review',{reviewedRevision:current.revision},200);assertLookerNativePreview(review)
 await call(base+'/preview',{reviewedRevision:current.revision,reviewedDigest:review.digest},200)
 const history=await context.request.get(origin+'/api/operator/import/history',{headers}),initialPlan=(await history.json()).history[0].planId
 // Inspect retained original bytes through the shared custody door.
 const readOriginal=async p=>{const r=await context.request.get(origin+'/api/operator/import/original/'+p,{headers});assert.equal(r.status(),200);return (await r.json()).originals}
 const original=await readOriginal(initialPlan);assert.equal(original.length,1);const retainedFiles=JSON.parse(Buffer.from(original[0].original.base64,'base64').toString()).originals;assert.equal(Buffer.from(retainedFiles[0].base64,'base64').toString(),input.originals[0].content);assert.deepEqual(Buffer.from(retainedFiles[1].base64,'base64'),opaqueCapture);assert.equal(retainedFiles[1].name,'owner-capture.pdf')
 // Every unsupported or missing field is retained in one complete diagnostic.
 const broken=structuredClone(document);broken.definition.views[0].query.groupBy=['missing-a','missing-b']
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'native-page',native:JSON.stringify(broken)},200)
 const blend=current.items.find(i=>i.source.id==='evidence-blend'),badBlend={...JSON.parse(blend.native),original:'Blend GA4 and Ads',status:'unsupported'}
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'evidence-blend',native:JSON.stringify(badBlend)},200)
 const gaps=await call(base+'/review',{reviewedRevision:current.revision},200)
 assert.deepEqual(gaps.issues.filter(i=>i.code==='missing_physical_field').map(i=>i.location).sort(),['missing-a','missing-b'])
 assert.ok(gaps.issues.some(i=>i.item==='evidence-blend'&&i.code==='unsupported_evidence'));assert.equal(gaps.drafts[0].answer,null)
 await call(base+'/preview',{reviewedRevision:current.revision,reviewedDigest:review.digest},409)
 await page.getByRole('button',{name:'Load reconstruction',exact:true}).click();await page.getByRole('button',{name:'Review native preview',exact:true}).click();await page.locator('#looker-results').filter({hasText:'missing-b'}).waitFor();assert.match(await page.locator('#looker-inventory summary').filter({hasText:'evidence-blend'}).innerText(),/unsupported/);await capture('looker-reconstruction-blocked')
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'native-page',native:JSON.stringify(document)},200)
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'evidence-blend',native:blend.native},200)
 const priorEvidenceReview=await call(base+'/review',{reviewedRevision:current.revision},200)
 const layout=current.items.find(i=>i.source.id==='evidence-layout'),changedLayout={...JSON.parse(layout.native),original:'Owner inspected a changed page layout.'}
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'evidence-layout',native:JSON.stringify(changedLayout)},200)
 await call(base+'/preview',{reviewedRevision:current.revision,reviewedDigest:priorEvidenceReview.digest},409)
 const dateScope=structuredClone(document);dateScope.parameters=[{id:'after',column:'date',type:'date',op:'gte',value:'2026-07-03'}];dateScope.reference={rows:[{dimensions:['East'],values:{revenue:'20.02',people:'1'}},{dimensions:['North'],values:{revenue:'0.00',people:'1'}}],totals:{revenue:'20.02',people:'2'}}
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'native-page',native:JSON.stringify(dateScope)},200)
 assertLookerNativePreview(await call(base+'/review',{reviewedRevision:current.revision},200),{total:'20.02',distinct:'2',rows:dateScope.reference.rows})
 // Independent parameter and date bounds include zero, negative and null values.
 const east=structuredClone(document);east.parameters[0].value='East';east.reference={rows:[{dimensions:['East'],values:{revenue:'20.02',people:'1'}}],totals:{revenue:'20.02',people:'1'}}
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'native-page',native:JSON.stringify(east)},200)
 const eastReview=await call(base+'/review',{reviewedRevision:current.revision},200);assertLookerNativePreview(eastReview,{total:'20.02',distinct:'1',rows:east.reference.rows})
 const wrongReference=structuredClone(east);wrongReference.reference.totals.revenue='900.00';current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'native-page',native:JSON.stringify(wrongReference)},200)
 const mismatch=await call(base+'/review',{reviewedRevision:current.revision},200);assert.ok(mismatch.issues.some(i=>i.code==='reference_mismatch'));assert.equal(mismatch.drafts[0].answer,null)
 const zero=structuredClone(document);zero.parameters[0].value='North';zero.reference={rows:[{dimensions:['North'],values:{revenue:'0.00',people:'1'}}],totals:{revenue:'0.00',people:'1'}}
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'native-page',native:JSON.stringify(zero)},200)
 assertLookerNativePreview(await call(base+'/review',{reviewedRevision:current.revision},200),{total:'0.00',distinct:'1',rows:zero.reference.rows})
 const empty=structuredClone(document);empty.parameters[0].value='Absent';empty.reference={rows:[],totals:{revenue:null,people:'0'}}
 current=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'native-page',native:JSON.stringify(empty)},200)
 assertLookerNativePreview(await call(base+'/review',{reviewedRevision:current.revision},200),{total:null,distinct:'0',rows:[]})
 // Concurrent review uses optimistic revisions; one edit wins and no losing edit
 // changes the retained version. Native source deltas preserve both candidates.
 const concurrentRevision=current.revision,responses=await Promise.all(['first','second'].map(value=>context.request.post(origin+'/api/operator'+base+'/edit',{headers:{Origin:origin},data:{reviewedRevision:concurrentRevision,itemId:'native-page',native:JSON.stringify({...document,reference:expected})}})))
 assert.deepEqual(responses.map(r=>r.status()).sort(),[200,409]);current=await call(base)
 const changed=structuredClone(input);changed.cutoff='2099-10-16T12:00:00Z';changed.drafts[0].sourceRevision='owner-2';changed.drafts[0].document=JSON.stringify(east)
 // Preserve unchanged original manifest metadata when source cutoff advances.
 const delta=await prepare(changed,true);await apply(delta);current=await call(base)
 assert.ok(current.items.find(i=>i.source.id==='native-page').conflict)
 assert.deepEqual(JSON.parse(current.items.find(i=>i.source.id==='native-page').native),document)
 await call(base+'/review',{reviewedRevision:concurrentRevision},409)
 current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:'native-page',choice:'keep-native'},200)
 // A complete current review also invalidates when separate source evidence changes.
 review=await call(base+'/review',{reviewedRevision:current.revision},200)
 // Other changed evidence may remain conflicted; all are explicit and must resolve.
 for(const item of current.items.filter(i=>i.conflict))current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:item.source.id,choice:'keep-native'},200)
 review=await call(base+'/review',{reviewedRevision:current.revision},200);assertLookerNativePreview(review)
 await upload(dataset,csv.replace('$10.01','$11.01'),true)
 await call(base+'/preview',{reviewedRevision:current.revision,reviewedDigest:review.digest},409)
 const staleSource=await call(base+'/review',{reviewedRevision:current.revision},200);assert.ok(staleSource.issues.some(i=>i.code==='source_evidence_changed'));assert.equal(staleSource.drafts[0].answer,null)
 const beforeRefusals=await call(base)
 // Same-origin owner cookies never turn a machine bearer into import authority.
 for(const action of ['review','preview','edit','resolve','erase']){
  const data={reviewedRevision:current.revision,reviewedDigest:review.digest,itemId:'native-page',native:'forbidden',choice:'use-source',confirmImport:id}
  const foreign=await context.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:'https://synthetic-bifocal.invalid'},data});assert.equal(foreign.status(),401)
  const machine=await context.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-machine'},data});assert.equal(machine.status(),401)
 }
 const memberName=['synthetic-bifocal-looker-member','example.test'].join('@')
 assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email:memberName,displayName:'Reconstruction member',role:'member'}})).status(),202)
 const member=await context.browser().newContext()
 try{await member.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(memberName),{headers:{'x-rer-dev-key':'synthetic-bifocal-9'.repeat(3)},maxRedirects:0});assert.equal((await member.request.get(origin+'/api/operator'+base)).status(),401);for(const action of ['review','preview','edit','erase'])assert.equal((await member.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:origin},data:{}})).status(),401)}finally{await member.close()}
 assert.deepEqual(await call(base),beforeRefusals)
 // Clean imports Undo through the shared door, leaving original custody until erase.
 const undoInput={...structuredClone(input),projectId:id+'-undo'};headers['X-Import-Dataset']=undoInput.projectId;const undoPlan=await prepare(undoInput);await apply(undoPlan);await post('undo',{planId:undoPlan.planId});await call('/migration-projects/'+undoInput.projectId,undefined,404)
 assert.equal((await readOriginal(undoPlan.planId))[0].original.status,'retained')
 await call('/migration-projects/'+undoInput.projectId+'/erase',{confirmImport:undoInput.projectId,reviewedRevision:null},200)
 assert.equal((await readOriginal(undoPlan.planId))[0].original.status,'unavailable')
 // Legal holds prevent source and reconstruction erasure. Eligible source
 // erasure reaches original bundles, every edit version and derived drafts.
 headers['X-Import-Dataset']=id
 const secondDataset=dataset+'-second'
 await upload(secondDataset,csv)
 const secondSource=await call('/datasets/'+secondDataset),multi=structuredClone(input);multi.projectId=id+'-multi';const secondDocument=structuredClone(document);secondDocument.sourceRevision=secondSource.revision;secondDocument.definition.views[0].query.dataset=secondDataset;multi.drafts.push({id:'second-page',sourceRevision:'owner-1',document:JSON.stringify(secondDocument)})
 headers['X-Import-Dataset']=multi.projectId;const multiPlan=await prepare(multi);await apply(multiPlan);headers['X-Import-Dataset']=id
 const freshSource=await call('/datasets/'+dataset),beforeHeldErasure=await call(base)
 const secondaryPolicy={confirmDataset:secondDataset,reviewedDatasetRevision:secondSource.revision,previousRevision:null,legalHold:false,minimumRetainUntil:'2099-01-01T00:00:00.000Z',releaseHold:false}
 const secondaryHeld=await context.request.put(origin+'/api/operator/retention/'+secondDataset,{headers:{Origin:origin},data:secondaryPolicy});assert.equal(secondaryHeld.status(),200);const secondaryRevision=(await secondaryHeld.json()).revision
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:freshSource.revision},423)
 assert.deepEqual(await call(base),beforeHeldErasure,'A hold on another linked source must be found before erasing any project')
 assert.deepEqual(await call('/datasets/'+dataset),freshSource)
 const secondaryReleased=await context.request.put(origin+'/api/operator/retention/'+secondDataset,{headers:{Origin:origin},data:{...secondaryPolicy,previousRevision:secondaryRevision,minimumRetainUntil:null,releaseHold:true}});assert.equal(secondaryReleased.status(),200)
 const policy={confirmDataset:dataset,reviewedDatasetRevision:freshSource.revision,previousRevision:null,legalHold:true,minimumRetainUntil:null,releaseHold:false}
 const retention=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:policy});assert.equal(retention.status(),200);const held=await retention.json()
 await call(base+'/erase',{confirmImport:id,reviewedRevision:current.revision},423)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:freshSource.revision},423)
 const released=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:{...policy,previousRevision:held.revision,legalHold:false,releaseHold:true}});assert.equal(released.status(),200)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:freshSource.revision},200)
 for(const projectId of [id,omitted.projectId,multi.projectId])await call('/migration-projects/'+projectId,undefined,404)
 await call(base+'/versions/'+current.revision,undefined,404)
 assert.equal((await readOriginal(initialPlan))[0].original.status,'unavailable')
 await post('apply',{planId:delta.planId,reviewedFingerprint:delta.fingerprint},410)
 assert.deepEqual(await call('/datasets/'+secondDataset),secondSource,'Erasing a linked project does not erase unrelated source rows')
 await call('/datasets/'+secondDataset+'/erase',{confirmDataset:secondDataset,reviewedRevision:secondSource.revision},200)
 // Pending reviews and unsupported blends retain custody before native preview.
 const activeProject=headers['X-Import-Dataset']
 const custodyInput=async(projectId,sourceId,joinedId)=>{
  const snapshot=await call('/datasets/'+sourceId),draft=structuredClone(document)
  draft.sourceRevision=snapshot.revision;draft.definition.views[0].query.dataset=sourceId
  if(joinedId)draft.definition.views[0].query.joins=[{dataset:joinedId,as:'joined',left:'invoice',right:'invoice',duplicates:'reject',cardinality:'many-to-one'}]
  const manifest={...structuredClone(input),projectId}
  manifest.drafts[0].document=JSON.stringify(draft)
  if(joinedId){const blend=manifest.evidence.find(e=>e.kind==='blend');blend.status='unsupported';blend.original='Owner-supplied blend over two separately reviewed native sources'}
  return manifest
 }
 const policyFor=async(sourceId,legalHold)=>{
  const snapshot=await call('/datasets/'+sourceId)
  const response=await context.request.put(origin+'/api/operator/retention/'+sourceId,{headers:{Origin:origin},data:{confirmDataset:sourceId,reviewedDatasetRevision:snapshot.revision,previousRevision:null,legalHold,minimumRetainUntil:null,releaseHold:false}})
  assert.equal(response.status(),200,await response.text());return response.json()
 }
 const release=async(sourceId,policy)=>{
  const snapshot=await call('/datasets/'+sourceId)
  const response=await context.request.put(origin+'/api/operator/retention/'+sourceId,{headers:{Origin:origin},data:{confirmDataset:sourceId,reviewedDatasetRevision:snapshot.revision,previousRevision:policy.revision,legalHold:false,minimumRetainUntil:null,releaseHold:true}})
  assert.equal(response.status(),200,await response.text())
 }
 const pendingId=id+'-pending',pendingSource=pendingId+'-source'
 await upload(pendingSource,csv);headers['X-Import-Dataset']=pendingId
 const pendingInput=await custodyInput(pendingId,pendingSource),pendingPlan=await prepare(pendingInput),pendingPolicy=await policyFor(pendingSource,true)
 await call('/migration-projects/'+pendingId+'/erase',{confirmImport:pendingId,reviewedRevision:null},423)
 assert.deepEqual((await prepare(pendingInput)).project,pendingPlan.project,'Refused pending erasure preserves original reconstruction evidence')
 const pendingSnapshot=await call('/datasets/'+pendingSource)
 await call('/datasets/'+pendingSource+'/erase',{confirmDataset:pendingSource,reviewedRevision:pendingSnapshot.revision},423)
 await release(pendingSource,pendingPolicy)
 await call('/migration-projects/'+pendingId+'/erase',{confirmImport:pendingId,reviewedRevision:null},200)
 await post('apply',{planId:pendingPlan.planId,reviewedFingerprint:pendingPlan.fingerprint},410)
 await call('/datasets/'+pendingSource+'/erase',{confirmDataset:pendingSource,reviewedRevision:pendingSnapshot.revision},200)
 const sourceErasedId=id+'-pending-source',sourceErasedDataset=sourceErasedId+'-data'
 await upload(sourceErasedDataset,csv);headers['X-Import-Dataset']=sourceErasedId
 const sourceErasedInput=await custodyInput(sourceErasedId,sourceErasedDataset),sourceErasedPlan=await prepare(sourceErasedInput),sourceErasedSnapshot=await call('/datasets/'+sourceErasedDataset)
 await call('/datasets/'+sourceErasedDataset+'/erase',{confirmDataset:sourceErasedDataset,reviewedRevision:sourceErasedSnapshot.revision},200)
 await post('apply',{planId:sourceErasedPlan.planId,reviewedFingerprint:sourceErasedPlan.fingerprint},410)
 await post('plan',{uploadId:sourceErasedPlan.planId},410)
 console.log('PROBE BLOCKING-B pending review: held reconstruction erasure and source erasure -> 423 with unchanged originals; released project or source erasure -> 200 and pending replay -> 410')
 const blendId=id+'-joined',leftDataset=blendId+'-left',joinedDataset=blendId+'-right'
 await upload(leftDataset,csv);await upload(joinedDataset,csv);headers['X-Import-Dataset']=blendId
 const blendInput=await custodyInput(blendId,leftDataset,joinedDataset),blendPlan=await prepare(blendInput);await apply(blendPlan)
 const blendProject=await call('/migration-projects/'+blendId),blendReview=await call('/migration-projects/'+blendId+'/review',{reviewedRevision:blendProject.revision},200)
 assert.equal(blendReview.compatible,false);assert.equal(blendReview.drafts[0].answer,null)
 const blendOriginal=await readOriginal(blendPlan.planId);assert.equal(blendOriginal[0].original.status,'retained')
 const joinedPolicy=await policyFor(joinedDataset,true),leftSnapshot=await call('/datasets/'+leftDataset),joinedSnapshot=await call('/datasets/'+joinedDataset)
 await call('/migration-projects/'+blendId+'/erase',{confirmImport:blendId,reviewedRevision:blendProject.revision},423)
 await call('/datasets/'+leftDataset+'/erase',{confirmDataset:leftDataset,reviewedRevision:leftSnapshot.revision},423)
 assert.deepEqual(await call('/migration-projects/'+blendId),blendProject);assert.deepEqual(await readOriginal(blendPlan.planId),blendOriginal)
 await release(joinedDataset,joinedPolicy)
 await call('/datasets/'+joinedDataset+'/erase',{confirmDataset:joinedDataset,reviewedRevision:joinedSnapshot.revision},200)
 await call('/migration-projects/'+blendId,undefined,404)
 await call('/migration-projects/'+blendId+'/versions/'+blendProject.revision,undefined,404)
 assert.equal((await readOriginal(blendPlan.planId))[0].original.status,'unavailable')
 await post('apply',{planId:blendPlan.planId,reviewedFingerprint:blendPlan.fingerprint},410)
 assert.deepEqual(await call('/datasets/'+leftDataset),leftSnapshot)
 await call('/datasets/'+leftDataset+'/erase',{confirmDataset:leftDataset,reviewedRevision:leftSnapshot.revision},200)
 headers['X-Import-Dataset']=activeProject
 console.log('PROBE BLOCKING-A unsupported blend: joined hold -> 423 without mutation; eligible joined-source erasure -> 200, draft and versions -> 404, originals unavailable and replay -> 410')
 console.log('PROBE BIF-083 reconstruction: browser supplied evidence, exact inactive native values and date parameters, full diagnostics, stale evidence, conflicts, authority, Undo and source-linked erasure passed; sharing and schedules inactive; source parity and cutover unproved')
}

/** Self-authored Google-documented specimens prove bounded native rebuilding. */
export async function proveLookMLDashboards({origin,context,call,page,upload,proveScreen}){
 const {prepareLookerDashboardModel}=await import('./model-import.mjs'),{assertLookerDashboardDraft}=await import('./dashboard-authoring.mjs'),{dump}=await import('js-yaml')
 const id='synthetic-bifocal-lookml-dashboard',dataset=id+'-data',base='/migration-projects/'+id
 const csv='invoice,region,revenue,person\n1,West,$10.01,A\n2,West,-$0.03,A\n10,East,$20.02,B\n4,Missing,,\n5,North,$0.00,C\n'
 await upload(dataset,csv)
 const binding=await prepareLookerDashboardModel({call,dataset}),bindings={'retail.orders':binding}
 const elements=['regional','west'].map((name,index)=>({name,title:name,model:'retail',explore:'orders',type:'looker_grid',fields:['orders.region','orders.revenue','orders.people'],filters:index?{'orders.region':'"West"'}:{},sorts:['orders.region asc'],limit:500,row:0,col:index*12,width:12,height:4}))
 const dashboard={dashboard:'regional_operating',title:'Original LookML operating tables',layout:'newspaper',elements},file={path:'regional.dashboard.lookml',content:dump([dashboard],{noRefs:true})}
 const input={version:1,projectId:id,source:'looker',cutoff:'2026-11-04T12:00:00Z',rollbackPlan:'Keep the incumbent active; Undo this exact import.',files:[file],bindings},headers={Origin:origin,'X-Import-Kind':'migration-project','X-Import-Dataset':id}
 const post=async(action,data,status=200)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(r.status(),status,await r.text());return r.json()}
 const prepare=async(value,catchup=false)=>{const bytes=Buffer.from(JSON.stringify(value)),hash=createHash('sha256').update(bytes).digest('hex'),u=await post('uploads',{name:'documented-lookml.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')});return post('plan',{uploadId:u.uploadId,...catchup?{catchup:true}:{}})}
 const apply=async plan=>{assert.equal(plan.counts.rejected,0,JSON.stringify(plan));for(let i=0;i<20;i++){const a=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(a.job.state==='completed'){assert.equal((await post('reconcile',{planId:plan.planId})).ok,true);return}}assert.fail('LookML import incomplete')}
 const original=async planId=>{const r=await context.request.get(origin+'/api/operator/import/original/'+planId,{headers});assert.equal(r.status(),200);return (await r.json()).originals}
 const beforeSchedules=await call('/schedules')
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.getByText('Import original LookML dashboards',{exact:true}).click()
 await page.getByLabel('LookML migration ID',{exact:true}).fill(id);await page.getByLabel('Exact model and field mappings (JSON)',{exact:true}).fill(JSON.stringify(bindings))
 await page.getByLabel('Original dashboard files',{exact:true}).setInputFiles({name:file.path,mimeType:['text','plain'].join('/'),buffer:Buffer.from(file.content)})
 await page.getByRole('button',{name:'Review LookML import',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Review every original'}).waitFor()
 await page.getByLabel('I reviewed this exact LookML fingerprint',{exact:true}).check();await page.getByRole('button',{name:'Apply inactive LookML drafts',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'LookML drafts applied inactive'}).waitFor()
 let current=await call(base),entry=current.items.find(i=>i.source.kind==='dashboard')
 const manifest=JSON.parse(current.items.find(i=>i.source.id==='looker-originals').native);assert.equal(manifest.files[0].path,file.path);assert.equal(manifest.files[0].content,file.content);assert.equal(manifest.files[0].sha256,createHash('sha256').update(file.content).digest('hex'))
 await page.getByRole('button',{name:'Review LookML native preview',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Current LookML definitions'}).waitFor()
 let review=await call(base+'/review',{reviewedRevision:current.revision},200);await assertLookerDashboardDraft({page,review})
 await page.getByRole('button',{name:'Confirm LookML preview',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Exact current-owner LookML preview confirmed'}).waitFor()
 await page.getByRole('button',{name:'Inspect LookML originals',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Original LookML files inspected'}).waitFor();assert.match(await page.locator('#lookml-original-text').innerText(),/regional\.dashboard\.lookml/)
 const tiles=page.locator('#lookml-results .lookml-native-tile'),left=await tiles.nth(0).boundingBox(),right=await tiles.nth(1).boundingBox()
 assert.ok(left.x<right.x);assert.equal(left.y,right.y)
 await proveScreen('lookml-native-dashboard-preview')
 await page.getByText('Undo or erase LookML import',{exact:true}).click();await page.getByRole('button',{name:'Undo LookML import',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'LookML import undone'}).waitFor();await call(base,undefined,404)
 await page.getByRole('button',{name:'Review LookML import',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Review every original'}).waitFor();await page.getByLabel('I reviewed this exact LookML fingerprint',{exact:true}).check();await page.getByRole('button',{name:'Apply inactive LookML drafts',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'LookML drafts applied inactive'}).waitFor();current=await call(base);entry=current.items.find(i=>i.source.kind==='dashboard')
 await page.getByRole('button',{name:'Review LookML native preview',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Current LookML definitions'}).waitFor()
 const edited=JSON.parse(await page.getByLabel('Editable native dashboard document (JSON)',{exact:true}).inputValue());edited.title='Edited inactive operating draft'
 await page.getByLabel('Editable native dashboard document (JSON)',{exact:true}).fill(JSON.stringify(edited));assert.equal(await page.getByRole('button',{name:'Confirm LookML preview',exact:true}).isDisabled(),true)
 await page.getByRole('button',{name:'Save native dashboard edit',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Inactive native dashboard edit saved'}).waitFor();current=await call(base)
 await call(base+'/preview',{reviewedRevision:current.revision,reviewedDigest:review.digest},409)
 const editedReview=await call(base+'/review',{reviewedRevision:current.revision},200);assert.equal(editedReview.drafts[0].definition.title,edited.title)
 const concurrent=await Promise.all(['First title','Second title'].map(title=>context.request.post(origin+'/api/operator'+base+'/edit',{headers:{Origin:origin},data:{reviewedRevision:current.revision,itemId:entry.source.id,native:JSON.stringify({...JSON.parse(entry.native),document:{...edited,title}})}})))
 assert.deepEqual(concurrent.map(r=>r.status()).sort(),[200,409]);current=await call(base)
 console.log('PROBE BIF-025 custody and concurrency: browser original upload, review, Apply, exact native preview and title edit -> inactive drafts; stale preview -> 409; concurrent edits -> one 200 and one 409')
 // One complete diagnostic covers every unresolved source semantic; hostile
 // markup remains text and is never executed, fetched or inferred as authority.
 const broken=structuredClone(dashboard);broken.access_filters=[{field:'orders.region',user_attribute:'region'}];broken.filters=[{name:'dynamic',type:'field_filter'}];broken.refresh='1 minute';broken.elements[0].sorts=['orders.revenue desc'];broken.elements[0].limit=0;broken.elements[0].dynamic_fields='dangerous expression';broken.elements[0].fields.push('orders.missing');broken.elements[0].filters={'orders.region':'West%'};broken.elements[1].type='looker_line';broken.elements[1].listen={dynamic:'orders.region'};broken.elements[1].html='<img src=x onerror="globalThis.lookmlExecuted=true">';broken.elements[1].row=0;broken.elements[1].col=0
 const bad={...structuredClone(input),projectId:id+'-unsupported',files:[{...file,content:dump([broken])}]};headers['X-Import-Dataset']=bad.projectId
 const badPlan=await prepare(bad);await apply(badPlan);const badBase='/migration-projects/'+bad.projectId,badCurrent=await call(badBase),badReview=await call(badBase+'/review',{reviewedRevision:badCurrent.revision},200)
 assert.equal(badReview.compatible,false);assert.equal(badReview.drafts[0].definition,null);assert.deepEqual(badReview.drafts[0].answers,[])
 assert.deepEqual(badReview.issues.filter(i=>i.code==='unsupported_property').map(i=>i.location.split('.').at(-1)).sort(),['access_filters','dynamic_fields','filters','html','listen','refresh'])
 assert.ok(badReview.issues.some(i=>i.code==='unresolved_field'));assert.ok(badReview.issues.some(i=>i.code==='unsupported_filter'));assert.ok(badReview.issues.some(i=>i.code==='unsupported_visual'));assert.ok(badReview.issues.some(i=>i.code==='unsupported_sort'));assert.ok(badReview.issues.some(i=>i.code==='explicit_limit_required'))
 await call(badBase+'/preview',{reviewedRevision:badCurrent.revision,reviewedDigest:badReview.digest},409)
 await page.getByLabel('LookML migration ID',{exact:true}).fill(bad.projectId);await page.getByRole('button',{name:'Load LookML project',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Inactive LookML project loaded'}).waitFor();await page.getByRole('button',{name:'Review LookML native preview',exact:true}).click();await page.locator('#lookml-results').filter({hasText:'unsupported_visual'}).waitFor();assert.equal(await page.evaluate(()=>globalThis.lookmlExecuted),undefined);assert.equal(await page.locator('#lookml-results img').count(),0);await proveScreen('lookml-unsupported-dashboard')
 console.log('PROBE BIF-025 unsupported: original security, filters, refresh, calculations, sorting and visual properties -> complete blocking diagnostics with no preview or script execution')
 // Explicit row limits never truncate, and every supported element is rebuilt.
 const four=structuredClone(dashboard);four.elements.push(...elements.map((e,index)=>({...e,name:'extra-'+index,row:4})));four.elements[2].fields=['orders.invoice','orders.revenue','orders.people'];four.elements[2].sorts=['orders.invoice asc']
 const fourId=id+'-four';headers['X-Import-Dataset']=fourId;const fourPlan=await prepare({...input,projectId:fourId,files:[{...file,content:dump([four])}]});await apply(fourPlan)
 const fourCurrent=await call('/migration-projects/'+fourId),fourReview=await call('/migration-projects/'+fourId+'/review',{reviewedRevision:fourCurrent.revision},200)
 assert.equal(fourReview.compatible,true,JSON.stringify(fourReview.issues));assert.deepEqual(fourReview.drafts[0].elements.map(e=>e.id),['regional','west','extra-0','extra-1']);assert.equal(fourReview.drafts[0].answers.length,4);assert.deepEqual(fourReview.drafts[0].answers[2].answer.rows.map(r=>r.dimensions),[['1'],['2'],['4'],['5'],['10']])
 const limited=structuredClone(dashboard);limited.elements[0].limit=1
 const limitedId=id+'-limited';headers['X-Import-Dataset']=limitedId;const limitedPlan=await prepare({...input,projectId:limitedId,files:[{...file,content:dump([limited])}]});await apply(limitedPlan)
 const limitedCurrent=await call('/migration-projects/'+limitedId),limitedReview=await call('/migration-projects/'+limitedId+'/review',{reviewedRevision:limitedCurrent.revision},200)
 assert.ok(limitedReview.issues.some(i=>i.code==='source_limit_would_truncate'));assert.deepEqual(limitedReview.drafts[0].answers,[])
 const overlap=structuredClone(dashboard);overlap.elements[1].col=0
 const overlapId=id+'-overlap';headers['X-Import-Dataset']=overlapId;const overlapPlan=await prepare({...input,projectId:overlapId,files:[{...file,content:dump([overlap])}]});await apply(overlapPlan)
 const overlapCurrent=await call('/migration-projects/'+overlapId),overlapReview=await call('/migration-projects/'+overlapId+'/review',{reviewedRevision:overlapCurrent.revision},200)
 assert.ok(overlapReview.issues.some(i=>i.code==='dashboard_layout_overlap'));assert.deepEqual(overlapReview.drafts[0].answers,[])
 console.log('PROBE BIF-025 rebuild bounds: four independently named elements -> four native tables; truncating limit and overlapping placement -> refused without partial values')
 // Source delta keeps an owner's native edit as an explicit conflict.
 headers['X-Import-Dataset']=id;const delta={...structuredClone(input),cutoff:new Date(Date.parse(current.cutoff)+60000).toISOString().slice(0,19)+'Z'};delta.files[0].content=file.content.replace('Original LookML operating tables','Changed source title')
 const deltaPlan=await prepare(delta,true);await apply(deltaPlan);current=await call(base);assert.ok(current.items.find(i=>i.source.id===entry.source.id).conflict)
 await call(base+'/preview',{reviewedRevision:current.revision,reviewedDigest:editedReview.digest},409)
 current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:entry.source.id,choice:'keep-native'},200)
 review=await call(base+'/review',{reviewedRevision:current.revision},200);assert.equal(review.compatible,true,JSON.stringify(review.issues));assert.equal(review.drafts[0].definition.title,JSON.parse(current.items.find(i=>i.source.id===entry.source.id).native).document.title)
 // An inert legacy inventory cannot impersonate authenticated original files.
 const forgedId=id+'-forged',forged={version:1,projectId:forgedId,source:'looker',cutoff:current.cutoff,rollbackPlan:input.rollbackPlan,items:current.items.map(i=>structuredClone(i.source))}
 const fabricated=forged.items.find(i=>i.kind==='dashboard'),fabricatedDocument=JSON.parse(fabricated.original);fabricatedDocument.source.title='Fabricated source title';fabricated.original=JSON.stringify(fabricatedDocument);fabricated.sourceRevision='synthetic-bifocal-fabricated'
 headers['X-Import-Dataset']=forgedId;const forgedPlan=await prepare(forged);await apply(forgedPlan)
 const forgedCurrent=await call('/migration-projects/'+forgedId),forgedReview=await call('/migration-projects/'+forgedId+'/review',{reviewedRevision:forgedCurrent.revision},200)
 assert.ok(forgedReview.issues.some(i=>i.code==='original_dashboard_mismatch'));assert.deepEqual(forgedReview.drafts[0].answers,[]);await call('/migration-projects/'+forgedId+'/preview',{reviewedRevision:forgedCurrent.revision,reviewedDigest:forgedReview.digest},409)
 console.log('PROBE BIF-025 provenance: edited inventory claiming a different original dashboard -> original mismatch and preview 409; original file bytes remain authoritative')
 // A clean second import supports exact Undo; held erasure preserves originals.
 const undoInput={...structuredClone(input),projectId:id+'-undo'};headers['X-Import-Dataset']=undoInput.projectId;const undoPlan=await prepare(undoInput);await apply(undoPlan)
 await page.getByLabel('LookML migration ID',{exact:true}).fill(undoInput.projectId);await page.getByRole('button',{name:'Load LookML project',exact:true}).click();await page.locator('#lookml-status').filter({hasText:'Inactive LookML project loaded'}).waitFor()
 // The public shared Undo is also what the browser button uses.
 await post('undo',{planId:undoPlan.planId});await call('/migration-projects/'+undoInput.projectId,undefined,404);assert.equal((await original(undoPlan.planId))[0].original.status,'retained')
 const source=await call('/datasets/'+dataset),policy={confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision:null,legalHold:true,minimumRetainUntil:null,releaseHold:false}
 const holdResponse=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:policy});assert.equal(holdResponse.status(),200);const hold=await holdResponse.json()
 headers['X-Import-Dataset']=id;await call(base+'/erase',{confirmImport:id,reviewedRevision:current.revision},423);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},423)
 const beforeAuthority=await call(base)
 for(const path of [base,base+'/versions/'+current.revision])assert.equal((await context.request.get(origin+'/api/operator'+path,{headers:{Authorization:'Bearer synthetic-bifocal-machine'}})).status(),401)
 for(const action of ['review','preview','edit','erase'])for(const extra of [{Origin:origin,Authorization:'Bearer synthetic-bifocal-machine'},{Origin:'https://synthetic-bifocal.invalid'}])assert.equal((await context.request.post(origin+'/api/operator'+base+'/'+action,{headers:extra,data:{}})).status(),401)
 const memberName=['synthetic-bifocal-lookml-member','example.test'].join('@');assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email:memberName,displayName:'LookML member',role:'member'}})).status(),202)
 const member=await context.browser().newContext();try{await member.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(memberName),{headers:{'x-rer-dev-key':'synthetic-bifocal-9'.repeat(3)},maxRedirects:0});assert.equal((await member.request.get(origin+'/api/operator'+base)).status(),401);for(const action of ['review','preview','edit','erase'])assert.equal((await member.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:origin},data:{}})).status(),401)}finally{await member.close()}
 assert.deepEqual(await call(base),beforeAuthority)
 // A separately changed source invalidates a previously reviewed clean draft.
 const staleId=id+'-stale';headers['X-Import-Dataset']=staleId;const stalePlan=await prepare({...input,projectId:staleId});await apply(stalePlan);const stale=await call('/migration-projects/'+staleId),staleReview=await call('/migration-projects/'+staleId+'/review',{reviewedRevision:stale.revision},200);assert.equal(staleReview.compatible,true)
 await upload(dataset,csv.replace('$10.01','$11.01'),true);await call('/migration-projects/'+staleId+'/preview',{reviewedRevision:stale.revision,reviewedDigest:staleReview.digest},409)
 const changedReview=await call('/migration-projects/'+staleId+'/review',{reviewedRevision:stale.revision},200);assert.ok(changedReview.issues.some(i=>i.code==='source_evidence_changed'));assert.deepEqual(changedReview.drafts[0].answers,[])
 const fresh=await call('/datasets/'+dataset),released=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:{...policy,reviewedDatasetRevision:fresh.revision,previousRevision:hold.revision,legalHold:false,releaseHold:true}});assert.equal(released.status(),200)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:fresh.revision},200)
 for(const projectId of [id,bad.projectId,staleId,fourId,limitedId,overlapId,forgedId])await call('/migration-projects/'+projectId,undefined,404)
 await call(base+'/versions/'+current.revision,undefined,404);assert.equal((await original(stalePlan.planId))[0].original.status,'unavailable');await post('apply',{planId:stalePlan.planId,reviewedFingerprint:stalePlan.fingerprint},410)
 assert.deepEqual(await call('/schedules'),beforeSchedules)
 console.log('PROBE BIF-025 authority and erasure: owner-only reads, member, machine and foreign refusals -> 401 unchanged; held erase -> 423; source drift -> 409; eligible erase -> originals unavailable, drafts and history 404, replay 410; schedules unchanged')
}
