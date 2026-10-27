import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
export async function proveReportReviewers(origin,owner,reader,fixture,call){
 const reviewer=(await(await reader.request.get(origin+'/auth/session')).json()).operator,ownerPage=await owner.newPage(),readerPage=await reader.newPage()
 const urls=new Map([fixture.first,fixture.second].map(run=>[run.id,new URL(run.reviewUrl,origin).href])),api=id=>'/report-runs/'+id,url=id=>{assert.ok(urls.has(id));return urls.get(id)}
 const screen=async(page,name)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('.menu > summary').focus();assert.equal(await page.getByRole('tooltip').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Report overflow '+name);assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0);if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/'+name+'-'+width+'.png',fullPage:true})}}}
 const granted=async(id)=>{await ownerPage.goto(url(id));await ownerPage.locator('#owner-report-tools').waitFor({state:'visible'});await ownerPage.getByLabel('Named reviewer',{exact:true}).selectOption(reviewer.id);await ownerPage.getByLabel('Grant expires in device local time',{exact:true}).fill(await ownerPage.evaluate(()=>{const expiry=new Date(Date.now()+300000);return new Date(expiry.getTime()-expiry.getTimezoneOffset()*60000).toISOString().slice(0,16)}));await ownerPage.getByRole('button',{name:'Review exact reviewer grant',exact:true}).click();await ownerPage.locator('#report-grant-preview').waitFor({state:'visible'});await screen(ownerPage,'report-grant-review');assert.equal(await ownerPage.locator('#report-grant-save').isDisabled(),true);await ownerPage.locator('#report-grant-confirm').check();const [response]=await Promise.all([ownerPage.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/grants')&&r.request().method()==='POST'),ownerPage.getByRole('button',{name:'Grant reviewed access',exact:true}).click()]);assert.equal(response.status(),201,await response.text());return response.json()}
 const readDownload=async(id,bytes,name)=>{
  await readerPage.goto(url(id));await readerPage.locator('#report-artifact').waitFor({state:'visible'});assert.equal(await readerPage.locator('#owner-report-tools').isVisible(),false);assert.equal(await readerPage.locator('a[href^="/app/queries"]').count(),0)
  await screen(readerPage,name);const [download]=await Promise.all([readerPage.waitForEvent('download'),readerPage.getByRole('button',{name:'Download exact artifact',exact:true}).click()]);assert.equal(await readFile(await download.path(),'utf8'),bytes)
 }
 try{
  const current=await call(api(fixture.first.id)),reviewerVersion=(await(await owner.request.get(origin+'/auth/operators')).json()).find(p=>p.id===reviewer.id).version
  const grantBody={reviewerId:reviewer.id,reviewerVersion,digest:current.digest,previousVersion:current.version,expiresAt:new Date(Date.now()+300000).toISOString()}
  await call(api(fixture.first.id)+'/grants',{...grantBody,digest:'0'.repeat(64)},409)
  assert.equal((await reader.request.get(origin+'/api/operator'+api(fixture.first.id))).status(),404)
  await readerPage.goto(url(fixture.first.id));await readerPage.getByRole('alert').waitFor();assert.equal(await readerPage.locator('#report-workspace').isVisible(),false);await screen(readerPage,'report-ungranted')
  const originalGrant=await granted(fixture.first.id);await readDownload(fixture.first.id,fixture.originalBytes,'report-reviewer-original')
  assert.equal((await reader.request.get(origin+'/api/operator'+api(fixture.second.id))).status(),404,'one artifact grant does not authorize its correction')
  const correctionGrant=await granted(fixture.second.id);await readDownload(fixture.second.id,fixture.correctedBytes,'report-reviewer-correction');assert.ok((await readerPage.locator('#report-correction').innerText()).includes(fixture.first.id))
  for(const operation of ['render','approve','send']){const response=await reader.request.post(origin+'/api/operator'+api(fixture.second.id)+'/'+operation,{headers:{Origin:origin},data:{}});assert.equal(response.status(),403)}
  assert.equal((await reader.request.get(origin+'/api/operator/datasets/'+fixture.dataset)).status(),401)
  const wrong=await owner.browser().newContext()
  try{
   const email='synthetic-bifocal-report-wrong@example.test';assert.equal((await owner.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email,displayName:'Synthetic other reviewer',role:'member'}})).status(),202)
   const person=(await(await owner.request.get(origin+'/auth/operators')).json()).find(p=>p.email===email);assert.ok(person?.signInUrl)
   assert.equal((await wrong.request.post(origin+'/__dev/key',{headers:{Origin:origin},data:{key:'synthetic-bifocal-4'.repeat(3)}})).status(),204);await wrong.request.get(new URL(person.signInUrl,origin).href)
   assert.equal((await wrong.request.get(origin+'/api/operator'+api(fixture.first.id)+'/download')).status(),404);assert.equal((await wrong.request.get(origin+fixture.firstLink.url)).status(),404)
  }finally{await wrong.close()}
  await ownerPage.goto(url(fixture.first.id));await ownerPage.locator('#report-grants button').first().waitFor();const [revoked]=await Promise.all([ownerPage.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/grants/'+originalGrant.id)),ownerPage.locator('#report-grants button').first().click()]);assert.equal(revoked.status(),200)
  assert.equal((await reader.request.get(origin+'/api/operator'+api(fixture.first.id)+'/download')).status(),404);await readerPage.goto(url(fixture.first.id));await readerPage.getByRole('alert').waitFor();await screen(readerPage,'report-reviewer-revoked')
  const short=await call(api(fixture.first.id)+'/grants',{...grantBody,expiresAt:new Date(Date.now()+1300).toISOString()});assert.ok(short.id);await new Promise(r=>setTimeout(r,1500));assert.equal((await reader.request.get(origin+'/api/operator'+api(fixture.first.id)+'/download')).status(),404);await readerPage.goto(url(fixture.first.id));await readerPage.getByRole('alert').waitFor();await screen(readerPage,'report-reviewer-expired')
  const series=await call('/report-runs/series',{period:'2026-W44'}),pendingInput={seriesId:series.id,queryId:fixture.queryId,title:'Pending named-recipient review',narrative:'',corrects:null,audience:[fixture.ownerId],acceptStale:false,retentionVersion:fixture.policyVersion,metricRef:fixture.metricRef,pendingRecipients:[reviewer.id]},removedRecipient=await call('/report-runs',pendingInput)
  const cancelled=await call(api(removedRecipient.id)+'/recipients',{previousVersion:removedRecipient.version,reviewerIds:[]},200,'PUT');assert.equal(cancelled.state,'cancelled');await call(api(removedRecipient.id)+'/render',{},409)
  const pending=await call('/report-runs',{...pendingInput,corrects:removedRecipient.id});urls.set(pending.id,new URL(pending.reviewUrl,origin).href)
  assert.equal((await reader.request.get(origin+'/api/operator'+api(pending.id))).status(),404)
  const pendingArtifact=await call(api(pending.id)+'/render',{},200),pendingReview=await call(api(pending.id)+'/review',{expiresAt:new Date(Date.now()+300000).toISOString()})
  assert.deepEqual(pendingReview.context.recipientReferences,[{id:reviewer.id,version:reviewerVersion}])
  const recipientClass=(await call('/approval-classifications')).people.find(p=>p.operatorId===reviewer.id)
  await call('/approval-classifications/'+reviewer.id,{previousRevision:recipientClass.revision,operatorVersion:recipientClass.operatorVersion,kind:'board',expiresAt:new Date(Date.now()+300000).toISOString()},200,'PUT')
  await call(api(pending.id)+'/approve',{digest:pendingArtifact.digest,previousVersion:pendingArtifact.version,reviewId:pendingReview.id},409)
  const freshRecipientReview=await call(api(pending.id)+'/review',{expiresAt:new Date(Date.now()+300000).toISOString()})
  assert.equal(freshRecipientReview.context.classifications.find(c=>c.operatorId===reviewer.id).kind,'board')
  assert.equal((await reader.request.post(origin+'/api/operator'+api(pending.id)+'/approve',{headers:{Origin:origin},data:{digest:pendingArtifact.digest,previousVersion:pendingArtifact.version,reviewId:freshRecipientReview.id}})).status(),403,'leadership classification never confers approval authority')
  const removed=await owner.request.post(origin+'/auth/operator/status',{headers:{Origin:origin},data:{operatorId:reviewer.id,status:'inactive'}});assert.equal(removed.status(),200,await removed.text())
  assert.equal((await reader.request.get(origin+'/api/operator'+api(fixture.second.id)+'/download')).status(),401)
  await call(api(pending.id)+'/approve',{digest:pendingArtifact.digest,previousVersion:pendingArtifact.version,reviewId:freshRecipientReview.id},409)
  assert.equal((await call(api(pending.id))).state,'cancelled');await call(api(pending.id)+'/render',{},409);await ownerPage.goto(url(pending.id));await ownerPage.locator('#report-status').filter({hasText:'cancelled'}).waitFor();await screen(ownerPage,'report-recipient-cancelled')
  const original=await call(api(fixture.first.id)),facts=original.dispatches;assert.deepEqual(facts,fixture.originalFacts);assert.equal(original.audit.filter(event=>event.actor_id===reviewer.id&&event.action==='artifact-downloaded').length,1)
  const audit=await call(api(fixture.second.id)+'/grants');assert.equal(audit.grants.find(g=>g.id===correctionGrant.id).active,false)
  const reactivated=await owner.request.post(origin+'/auth/operator/status',{headers:{Origin:origin},data:{operatorId:reviewer.id,status:'active'}});assert.equal(reactivated.status(),200)
  const renewed=(await(await owner.request.get(origin+'/auth/operators')).json()).find(person=>person.id===reviewer.id);assert.ok(renewed.signInUrl);await reader.request.get(new URL(renewed.signInUrl,origin).href)
  assert.equal((await reader.request.get(origin+'/api/operator'+api(fixture.first.id)+'/download')).status(),404,'reactivation does not revive an old artifact grant')
  await call(api(fixture.first.id)+'/grants',{...grantBody,reviewerVersion:renewed.version,expiresAt:new Date(Date.now()+300000).toISOString()})
  const retained=await reader.request.get(origin+'/api/operator'+api(fixture.first.id)+'/download');assert.equal(retained.status(),200);assert.equal(await retained.text(),fixture.originalBytes)
  console.log('Named report reviewers: exact original and correction, native identity, audited downloads, no source or mutation authority, expiry, revocation and membership-cancelled pending rendering passed at 1440 and 390')
  return {async erased(){
   assert.equal((await reader.request.get(origin+'/api/operator'+api(fixture.first.id)+'/download')).status(),404);assert.equal((await call(api(fixture.first.id)+'/grants')).grants.length,0)
   const retained=await owner.newPage(),withdrawn=await reader.newPage()
   try{await retained.goto(url(fixture.first.id));await retained.locator('#report-status').filter({hasText:'erased'}).waitFor();await screen(retained,'report-source-erased');await withdrawn.goto(url(fixture.first.id));await withdrawn.getByRole('alert').waitFor();assert.equal(await withdrawn.locator('#report-workspace').isVisible(),false);await screen(withdrawn,'report-source-withdrawn')}finally{await retained.close();await withdrawn.close()}
  }}
 }finally{await ownerPage.close();await readerPage.close()}
}

export async function proveLeadershipClassifications(origin,owner,reader,ownerId,call){
 const page=await owner.newPage(),root='/approval-classifications'
 const screen=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('.menu > summary').focus();assert.equal(await page.getByRole('tooltip').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0);if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/'+name+'-'+width+'.png',fullPage:true})}}}
 const people=()=>call(root)
 const change=async(kind,expiresAt=new Date(Date.now()+300000).toISOString())=>{
  const person=(await people()).people.find(p=>p.operatorId===ownerId)
  return call(root+'/'+ownerId,{previousRevision:person.revision,operatorVersion:person.operatorVersion,kind,expiresAt:kind==='none'?null:expiresAt},200,'PUT')
 }
 try{
  if(reader){assert.equal((await reader.request.get(origin+'/api/operator'+root)).status(),403);assert.equal((await reader.request.put(origin+'/api/operator'+root+'/'+ownerId,{headers:{Origin:origin},data:{}})).status(),403)}
  const opened=await page.goto(origin+'/app/settings/approvals');assert.equal(opened.status(),200,await page.locator('body').innerText());assert.equal(await page.locator('#classification-form').count(),1,await page.locator('main').innerText());await page.getByLabel('Person',{exact:true}).selectOption(ownerId)
  await page.getByLabel('Classification',{exact:true}).selectOption('leadership')
  await page.getByLabel('Expires at in device local time',{exact:true}).fill(await page.evaluate(()=>{const d=new Date(Date.now()+300000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19)}))
  const [saved]=await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith(ownerId)),page.getByRole('button',{name:'Save reviewed classification',exact:true}).click()]);assert.equal(saved.status(),200,await saved.text())
  const created=await saved.json();assert.equal(created.kind,'leadership');assert.equal(created.grantsAuthority,false)
  await page.locator('#classification-status').filter({hasText:'classification is saved'}).waitFor();await screen('leadership-created')
  await page.getByLabel('Classification',{exact:true}).selectOption('board')
  const [updated]=await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'),page.getByRole('button',{name:'Save reviewed classification',exact:true}).click()]);assert.equal(updated.status(),200);const changed=await updated.json();assert.equal(changed.revision,created.revision+1)
  await page.locator('#classification-status').filter({hasText:'classification is saved'}).waitFor();await screen('leadership-changed')
  const audit=await call(root+'/audit');assert.ok(audit.records.some(r=>r.actorId===ownerId&&r.before.kind==='none'&&r.after.kind==='leadership'));assert.ok(audit.records.some(r=>r.before.kind==='leadership'&&r.after.kind==='board'))
  await call(root+'/'+ownerId,{previousRevision:created.revision,operatorVersion:created.operatorVersion,kind:'none',expiresAt:null},409,'PUT')
  const machine=await owner.request.put(origin+'/api/operator'+root+'/'+ownerId,{headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-953'},data:{previousRevision:changed.revision,operatorVersion:created.operatorVersion,kind:'none',expiresAt:null}});assert.equal(machine.status(),403)
  return {change}
 }finally{await page.close()}
}

export async function proveExactInstanceReview(origin,owner,reader,run,artifact,classifications,call){
 const root='/report-runs/'+run.id,expires=()=>new Date(Date.now()+300000).toISOString(),preview=expiry=>call(root+'/review',{expiresAt:expiry??expires()})
 const approve=(review,expected=200)=>call(root+'/approve',{digest:artifact.digest,previousVersion:artifact.version,reviewId:review.id},expected)
 let reviewed=await preview()
 assert.equal(reviewed.context.digest,artifact.digest);assert.equal(reviewed.context.query.id,artifact.queryId);assert.deepEqual(reviewed.context.metric,artifact.metricRef)
 assert.deepEqual(reviewed.context.definitionVersions,artifact.definitionVersions);assert.deepEqual(reviewed.context.sourceContext,artifact.observedSources);assert.deepEqual(reviewed.context.securityContext,artifact.securityScope)
 assert.deepEqual(reviewed.context.recipientReferences,[]);assert.deepEqual(reviewed.context.audience,artifact.audience);assert.equal(reviewed.context.destination.recipientId,artifact.audience[0]);assert.equal(reviewed.context.destination.address,'synthetic-bifocal-1@example.test');assert.equal(reviewed.context.format,'application/json')
 assert.equal(reviewed.grantsViewingAuthority,false);assert.equal(reviewed.grantsDeliveryAuthority,false)
 await classifications.change('leadership');await approve(reviewed,409)
 reviewed=await preview();await classifications.change('none');await approve(reviewed,409)
 await classifications.change('leadership',new Date(Date.now()+1700).toISOString());reviewed=await preview();await new Promise(r=>setTimeout(r,1900));await approve(reviewed,409)
 await classifications.change('leadership');reviewed=await preview(new Date(Date.now()+1700).toISOString());await new Promise(r=>setTimeout(r,1900));await approve(reviewed,409)
 const machine=await owner.request.post(origin+'/api/operator'+root+'/approve',{headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-954'},data:{digest:artifact.digest,previousVersion:artifact.version,reviewId:reviewed.id}});assert.equal(machine.status(),403)
 if(reader){assert.equal((await reader.request.post(origin+'/api/operator'+root+'/review',{headers:{Origin:origin},data:{expiresAt:expires()}})).status(),403);assert.equal((await reader.request.get(origin+'/api/operator'+root+'/download')).status(),404)}
 if(reader){
  const other=await owner.browser().newContext()
  try{
   assert.equal((await other.request.post(origin+'/__dev/key',{headers:{Origin:origin},data:{key:'synthetic-bifocal-4'.repeat(3)}})).status(),204)
   const nativeOwner=(await(await owner.request.get(origin+'/auth/operators')).json()).find(p=>p.id===artifact.audience[0]);assert.ok(nativeOwner.signInUrl)
   await other.request.get(new URL(nativeOwner.signInUrl,origin).href)
   const session=await(await other.request.get(origin+'/auth/session')).json();assert.equal(session.operator.role,'owner')
   const ownReview=await other.request.post(origin+'/api/operator'+root+'/review',{headers:{Origin:origin},data:{expiresAt:expires()}});assert.equal(ownReview.status(),201);const held=await ownReview.json()
   assert.equal((await other.request.post(origin+'/auth/session/revoke',{headers:{Origin:origin},data:{sessionId:session.id}})).status(),204)
   assert.equal((await other.request.post(origin+'/api/operator'+root+'/approve',{headers:{Origin:origin},data:{digest:artifact.digest,previousVersion:artifact.version,reviewId:held.id}})).status(),401)
  }finally{await other.close()}
 }
 const page=await owner.newPage()
 try{
  await page.goto(origin+run.reviewUrl);await page.locator('#report-instance-form').waitFor({state:'visible'})
  await page.getByLabel('Approval expires in device local time',{exact:true}).fill(await page.evaluate(()=>{const d=new Date(Date.now()+300000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}))
  await page.getByRole('button',{name:'Review exact report instance',exact:true}).click();await page.locator('#report-instance-preview').waitFor({state:'visible'})
  assert.equal(await page.locator('#report-instance-save').isDisabled(),true)
  const shown=JSON.parse(await page.locator('#report-instance-context').innerText());assert.equal(shown.digest,artifact.digest);assert.equal(shown.classifications[0].kind,'leadership')
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('.menu > summary').focus();assert.equal(await page.getByRole('tooltip').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/exact-instance-review-'+width+'.png',fullPage:true})}
  await page.locator('#report-instance-confirm').check()
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/approve')&&r.request().method()==='POST'),page.getByRole('button',{name:'Approve exact report instance',exact:true}).click()]);assert.equal(response.status(),200,await response.text());const approval=await response.json()
  await page.locator('#report-instance-state').filter({hasText:'Recorded instance approval expires'}).waitFor()
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('.menu > summary').focus();assert.equal(await page.getByRole('tooltip').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/exact-instance-approved-'+width+'.png',fullPage:true})}
  await approve(reviewed,409);return approval
 }finally{await page.close()}
}
