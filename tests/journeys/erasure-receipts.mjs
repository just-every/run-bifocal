import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
export async function proveErasureReceipt(origin,context,auditId,dataset,revision,persist){
 const auditUrl=origin+'/api/operator/erasure-receipts/'+auditId
 const historyUrl=origin+'/api/operator/retention/'+dataset+'/history'
 assert.deepEqual((await (await context.request.get(historyUrl)).json()).history,[])
 assert.deepEqual(await inspectRetention(persist,'SELECT * FROM bf_retention_acknowledgments WHERE dataset_id=?',dataset),[])
 const after=await inspectRetention(persist,'SELECT * FROM bf_erasure_audit ORDER BY id')
 for(const before of context.retentionAuditBefore)assert.deepEqual(after.find(row=>row.id===before.id),before,'Eligible erasure never rewrites permanent historical audits')
 const old=context.retentionAcknowledgments
 assert.equal(auditId.length,36)
 const denied=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedDatasetRevision:null,previousRevision:null,legalHold:true,minimumRetainUntil:null}})
 assert.equal(denied.status(),409,'Erased sources cannot regain identifying protection custody')
 assert.deepEqual(await inspectRetention(persist,'SELECT * FROM bf_erasure_audit ORDER BY id'),after)
 context.retentionErasedDataset=dataset
 assert.equal((await fetch(auditUrl)).status,401)
 const auditResponse=await context.request.get(auditUrl)
 assert.equal(auditResponse.status(),200,await auditResponse.text())
 const audit=await auditResponse.json()
 assert.equal(audit.audit.kind,'source_erasure')
 assert.equal(audit.stores.find(store=>store.store==='bf_retention_acknowledgments').rows,old.length)
 for(const row of old){const permanent=await (await context.request.get(origin+'/api/operator/erasure-receipts/'+row.audit_id)).json();assert.equal(permanent.audit.kind,'retention_changed');for(const value of [dataset,row.approving_owner_id,row.source_revision,row.previous_revision,row.replacement_revision].filter(Boolean))assert.equal(JSON.stringify(permanent).includes(value),false)}
 assert.ok(audit.stores.some(store=>store.store==='ik_door_plan_chunks'&&store.rows>0))
 assert.equal(audit.stores.find(store=>store.store==='bf_file_tables').rows,1)
 assert.ok(audit.stores.every(store=>store.state==='complete'&&Number.isSafeInteger(store.rows)&&store.rows>=0))
 assert.notEqual(audit.audit.actor_ref,audit.audit.subject_ref)
 for(const erasedValue of [dataset,'synthetic-bifocal-1@example.test',revision]) assert.equal(JSON.stringify(audit).includes(erasedValue),false)
 assert.equal((await context.request.post(auditUrl,{headers:{Origin:origin},data:{}})).status(),405)
 assert.deepEqual(await (await context.request.get(auditUrl)).json(),audit)
}

export async function proveRetentionHold(origin,context,dataset,revision,page,persist){
 const url=origin+'/api/operator/retention/'+dataset,headers={Origin:origin}
 const owner=(await (await context.request.get(origin+'/auth/session')).json()).operator
 const history=async()=>{const response=await context.request.get(url+'/history');assert.equal(response.status(),200,await response.text());assert.equal(response.headers()['cache-control'],'no-store');return (await response.json()).history}
 const before=await history()
 assert.deepEqual(before,[],'An existing anonymous audit never becomes an invented attributed approval')
 assert.equal((await fetch(url+'/history')).status,401)
 assert.equal((await context.request.put(url+'/history',{headers,data:{}})).status(),405)
 const heldInput={confirmDataset:dataset,reviewedDatasetRevision:revision,previousRevision:null,legalHold:true,minimumRetainUntil:null}
 assert.equal((await context.request.put(url,{headers:{...headers,Authorization:'Bearer synthetic-bifocal-1'},data:heldInput})).status(),401,'A machine bearer with owner cookies cannot approve protection')
 assert.equal((await context.request.get(url+'/history',{headers:{Authorization:'Bearer synthetic-bifocal-1'}})).status(),401)
 assert.deepEqual(await history(),before)

 if(page)for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings')
  const review=page.locator('#protection-review'),save=page.locator('#protection-save')
  await review.getByLabel('Protection dataset id',{exact:true}).fill(dataset)
  await review.getByRole('button').click()
  await page.locator('#protection-status').filter({hasText:'Source protection loaded'}).waitFor()
  assert.match(await page.locator('#protection-state').innerText(),new RegExp(revision))
  await save.getByLabel('Legal hold',{exact:true}).check()
  await save.getByLabel('Minimum retain until (UTC)',{exact:true}).fill('2099-01-01T00:00:00.000Z')
  await save.getByRole('checkbox',{name:'I reviewed this exact source state and policy revision',exact:true}).check()
  await save.getByRole('button').click()
  await page.locator('#protection-status').filter({hasText:'Protection saved'}).waitFor()
  assert.equal((await (await context.request.get(url)).json()).policy.legal_hold,1)
  await review.getByRole('button').click()
  await page.locator('#protection-status').filter({hasText:'Source protection loaded'}).waitFor()
  await save.getByLabel('Legal hold',{exact:true}).uncheck()
  await save.getByLabel('Minimum retain until (UTC)',{exact:true}).fill('')
  await save.getByRole('checkbox',{name:'I reviewed this exact source state and policy revision',exact:true}).check()
  await save.getByRole('button').click()
  await page.locator('#protection-status').filter({hasText:'Explicit acknowledgment is required'}).waitFor()
  assert.equal((await (await context.request.get(url)).json()).policy.legal_hold,1)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0)
  if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/settings-protection-'+width+'.png',fullPage:true})}
  if(width===390){
   const current=(await (await context.request.get(url)).json()).policy
   const changed=await context.request.put(url,{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedDatasetRevision:revision,previousRevision:current.revision,legalHold:true,minimumRetainUntil:null,releaseHold:true}})
   assert.equal(changed.status(),200)
   await save.getByRole('checkbox',{name:'I explicitly acknowledge replacing the existing protection; this is not legal clearance or erasure approval',exact:true}).check()
   await save.getByRole('button').click()
   await page.locator('#protection-status').filter({hasText:'retention_conflict'}).waitFor()
   assert.equal((await (await context.request.get(url)).json()).policy.legal_hold,1)
   await review.getByRole('button').click()
   await page.locator('#protection-status').filter({hasText:'Source protection loaded'}).waitFor()
   await save.getByLabel('Legal hold',{exact:true}).uncheck()
   await save.getByLabel('Minimum retain until (UTC)',{exact:true}).fill('')
   await save.getByRole('checkbox',{name:'I reviewed this exact source state and policy revision',exact:true}).check()
  }
  await save.getByRole('checkbox',{name:'I explicitly acknowledge replacing the existing protection; this is not legal clearance or erasure approval',exact:true}).check()
  await save.getByRole('button').click()
  await page.locator('#protection-status').filter({hasText:'Protection saved'}).waitFor()
  assert.equal((await (await context.request.get(url)).json()).policy.legal_hold,0)
 }
 const browserHistory=await history()
 const first=browserHistory[0]
 assert.equal(first.dataset_id,dataset);assert.equal(first.source_revision,revision);assert.equal(first.source_state,'published')
 assert.equal(first.approving_owner_id,owner.id);assert.equal(first.approving_owner_version,owner.version)
 assert.equal(first.previous_revision,null);assert.equal(first.before_legal_hold,null);assert.equal(first.before_minimum_retain_until,null)
 assert.equal(first.after_legal_hold,1);assert.equal(first.after_minimum_retain_until,'2099-01-01T00:00:00.000Z');assert.equal(first.release_acknowledged,0)
 for(let i=1;i<browserHistory.length;i++){const current=browserHistory[i],previous=browserHistory[i-1];assert.equal(current.previous_revision,previous.replacement_revision);assert.equal(current.before_legal_hold,previous.after_legal_hold);assert.equal(current.before_minimum_retain_until,previous.after_minimum_retain_until);assert.equal(current.approving_owner_id,owner.id);assert.ok(!Number.isNaN(Date.parse(current.recorded_at)))}
 const policyBeforeRefusal=await (await context.request.get(url)).json()
 const stateBeforeRefusal=await history(),auditBeforeRefusal=await inspectRetention(persist,'SELECT * FROM bf_erasure_audit ORDER BY id')
 const last=stateBeforeRefusal.at(-1)
 const concurrentInput={...heldInput,previousRevision:last.replacement_revision,releaseHold:true}
 assert.equal((await context.request.put(url,{headers,data:{...concurrentInput,reviewedDatasetRevision:'stale'}})).status(),422)
 assert.equal((await context.request.put(url,{headers,data:{...concurrentInput,previousRevision:first.replacement_revision}})).status(),409)
 assert.deepEqual(await (await context.request.get(url)).json(),policyBeforeRefusal)
 assert.deepEqual(await history(),stateBeforeRefusal);assert.deepEqual(await inspectRetention(persist,'SELECT * FROM bf_erasure_audit ORDER BY id'),auditBeforeRefusal)
 const competing=await Promise.all([context.request.put(url,{headers,data:concurrentInput}),context.request.put(url,{headers,data:{...concurrentInput,legalHold:false}})])
 assert.deepEqual(competing.map(r=>r.status()).sort(),[200,409])
 assert.equal((await history()).length,stateBeforeRefusal.length+1,'Only the concurrent winner has an acknowledgment and policy')
 const winner=await competing.find(r=>r.status()===200).json()
 assert.equal((await history()).at(-1).replacement_revision,winner.revision)
 let current=(await (await context.request.get(url)).json()).policy
 const minimum={confirmDataset:dataset,reviewedDatasetRevision:revision,previousRevision:current.revision,legalHold:false,minimumRetainUntil:'2099-01-01T00:00:00.000Z',releaseHold:true}
 const retained=await context.request.put(url,{headers:{Origin:origin},data:minimum})
 assert.equal(retained.status(),200);current=await retained.json()
 assert.equal((await context.request.post(origin+'/api/operator/datasets/'+dataset+'/erase',{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedRevision:revision}})).status(),423)
 const expired=await context.request.put(url,{headers:{Origin:origin},data:{...minimum,previousRevision:current.revision,minimumRetainUntil:'2000-01-01T00:00:00.000Z'}})
 assert.equal(expired.status(),200)
 assert.equal((await context.request.get(origin+'/api/operator/datasets/'+dataset)).status(),200,'An elapsed minimum date never automatically erases the source')
 const empty=await context.request.get(origin+'/api/operator/retention/synthetic-bifocal-no-published')
 assert.equal(empty.status(),200);assert.equal((await empty.json()).reviewedDatasetRevision,null)
 const unpublished='synthetic-bifocal-retention-unpublished',unpublishedUrl=origin+'/api/operator/retention/'+unpublished
 const unpublishedSave=await context.request.put(unpublishedUrl,{headers,data:{confirmDataset:unpublished,reviewedDatasetRevision:null,previousRevision:null,legalHold:false,minimumRetainUntil:null}})
 assert.equal(unpublishedSave.status(),200,await unpublishedSave.text())
 const unpublishedHistory=(await (await context.request.get(unpublishedUrl+'/history')).json()).history
 assert.equal(unpublishedHistory.length,1);assert.equal(unpublishedHistory[0].source_state,'unpublished');assert.equal(unpublishedHistory[0].source_revision,null);assert.equal(unpublishedHistory[0].previous_revision,null);assert.equal(unpublishedHistory[0].before_legal_hold,null);assert.equal(unpublishedHistory[0].approving_owner_id,owner.id)
 const previous=(await (await context.request.get(url)).json()).policy?.revision??null
 const input={confirmDataset:dataset,reviewedDatasetRevision:revision,previousRevision:previous,legalHold:true,minimumRetainUntil:null}
 assert.equal((await fetch(url)).status,401)
 const saved=await context.request.put(url,{headers:{Origin:origin},data:{...input,releaseHold:true}})
 assert.equal(saved.status(),200,await saved.text());const policy=await saved.json()
 assert.equal(policy.automaticErasure,false)
 const held=await context.request.post(origin+'/api/operator/datasets/'+dataset+'/erase',{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedRevision:revision}})
 assert.equal(held.status(),423,await held.text())
 assert.equal((await context.request.get(origin+'/api/operator/datasets/'+dataset)).status(),200)
 if(page)for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/import')
  await page.getByLabel('Dataset id',{exact:true}).fill(dataset)
  await page.getByRole('button',{name:'Load dataset',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Dataset state and history loaded'}).waitFor()
  await page.getByText('Erase this dataset and retained imports',{exact:true}).click()
  await page.getByLabel('Type dataset id to confirm',{exact:true}).fill(dataset)
  await page.getByRole('button',{name:'Erase reviewed dataset',exact:true}).click()
  await page.getByRole('status').filter({hasText:'protected by a legal hold'}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0)
  if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/retention-hold-'+width+'.png',fullPage:true})}
 }

 const noAckBefore=await history(),noAckPolicy=await (await context.request.get(url)).json()
 assert.equal((await context.request.put(url,{headers:{Origin:origin},data:{...input,previousRevision:policy.revision,legalHold:false}})).status(),409)
 assert.deepEqual(await history(),noAckBefore)
 assert.deepEqual(await (await context.request.get(url)).json(),noAckPolicy)
 assert.equal((await context.request.put(url,{headers:{Origin:origin},data:{...input,previousRevision:policy.revision,legalHold:false,releaseHold:true,reviewedDatasetRevision:'stale'}})).status(),422)
 const release=await context.request.put(url,{headers:{Origin:origin},data:{...input,previousRevision:policy.revision,legalHold:false,releaseHold:true}})
 assert.equal(release.status(),200,await release.text())
 assert.equal((await context.request.put(url,{headers:{Origin:origin},data:{...input,previousRevision:policy.revision,releaseHold:true}})).status(),409)
 assert.equal((await (await context.request.get(url)).json()).policy.legal_hold,0)
 if(page)for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings')
  await page.getByLabel('Protection dataset id',{exact:true}).fill('synthetic-bifocal-no-published')
  await page.getByRole('button',{name:'Review source protection',exact:true}).click()
  await page.locator('#protection-status').filter({hasText:'Source protection loaded'}).waitFor()
  await page.getByText('No published revision',{exact:true}).waitFor()
  await page.getByText('No protection policy',{exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/settings-unpublished-'+width+'.png',fullPage:true})
 }
 const finalHistory=await history()
 const persisted=await inspectRetention(persist,'SELECT r.*,a.recorded_at FROM bf_retention_acknowledgments r JOIN bf_erasure_audit a ON a.id=r.audit_id WHERE dataset_id=? ORDER BY a.recorded_at,r.rowid',dataset)
 assert.deepEqual(persisted,finalHistory,'Public history exposes the actual persisted review records')
 assert.equal(persisted.at(-1).before_legal_hold,1);assert.equal(persisted.at(-1).after_legal_hold,0);assert.equal(persisted.at(-1).release_acknowledged,1)
 const savedPolicy=await inspectRetention(persist,'SELECT * FROM bf_source_retention WHERE dataset_id=?',dataset)
 assert.equal(savedPolicy[0].revision,persisted.at(-1).replacement_revision);assert.equal(savedPolicy[0].legal_hold,persisted.at(-1).after_legal_hold);assert.equal(savedPolicy[0].minimum_retain_until,persisted.at(-1).after_minimum_retain_until)
 context.retentionAcknowledgments=persisted
 context.retentionAuditBefore=await inspectRetention(persist,'SELECT * FROM bf_erasure_audit ORDER BY id')
 if(page)for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings')
  await page.getByLabel('Protection dataset id',{exact:true}).fill(dataset)
  await page.getByRole('button',{name:'Review source protection',exact:true}).click()
  await page.locator('#protection-status').filter({hasText:'Source protection loaded'}).waitFor()
  const firstReview=page.locator('#protection-history details').last().locator('summary')
  await firstReview.focus();await firstReview.press('Enter')
  const settings=page.locator('.menu > summary'),tooltip=page.locator('#settings-menu-tooltip')
  await settings.hover();await tooltip.waitFor({state:'visible'});await page.mouse.move(0,0);await tooltip.waitFor({state:'hidden'});await settings.focus();assert.equal(await tooltip.isVisible(),true,'Settings tooltip appears immediately on keyboard focus')
  const visible=await page.locator('#protection-history').innerText()
  for(const value of [owner.id,dataset,revision,first.replacement_revision,persisted.at(-1).replacement_revision,'Replacement acknowledged','Yes'])assert.ok(visible.includes(value),'History shows the actual reviewed approval '+value)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/settings-protection-history-'+width+'.png',fullPage:true})
 }
 console.log('PROBE BIF-034 acknowledgment: native Settings and retention HTTP saved exact owner, source, before and after protection and policy revisions; stale and missing acknowledgment refused; concurrent replacements had one winner.')

}

async function inspectRetention(persist,query,...params){
 assert.ok(persist,'Persisted acknowledgment proof requires the real Worker data directory')
 for(const path of await readdir(persist,{recursive:true}))if(path.endsWith('.sqlite')){
  const db=new DatabaseSync(join(persist,path),{readOnly:true})
  try{if(db.prepare("SELECT name FROM sqlite_master WHERE name='bf_retention_acknowledgments'").get())return db.prepare(query).all(...params).map(row=>({...row}))}finally{db.close()}
 }
 assert.fail('Worker retention database not found')
}

export async function proveProtectionAuthority(origin,owner,member,dataset,revision,bearer){
 const url=origin+'/api/operator/retention/'+dataset,headers={Origin:origin},input={confirmDataset:dataset,reviewedDatasetRevision:revision,previousRevision:null,legalHold:true,minimumRetainUntil:null}
 const before=await (await owner.request.get(url+'/history')).json()
 for(const client of [member]){
  for(const suffix of ['','/history'])assert.equal((await client.request.get(url+suffix)).status(),401)
  assert.equal((await client.request.put(url,{headers,data:input})).status(),401)
 }
 for(const suffix of ['','/history'])assert.equal((await owner.request.get(url+suffix,{headers:{Authorization:'Bearer '+bearer}})).status(),401)
 assert.equal((await owner.request.put(url,{headers:{...headers,Authorization:'Bearer '+bearer},data:input})).status(),401)
 assert.deepEqual(await (await owner.request.get(url+'/history')).json(),before,'Member and working machine credentials cannot read or mutate protection history')
}

export async function proveRetentionSourceDrift(origin,context,files){
 const dataset='synthetic-bifocal-retention-unpublished',url=origin+'/api/operator/retention/'+dataset,headers={Origin:origin}
 const previous=await (await context.request.get(url)).json(),historyBefore=await (await context.request.get(url+'/history')).json()
 const input={version:1,datasetId:dataset,filename:'synthetic-bifocal-1.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:'id',formulaTreatment:'literal-text',data:'id,amount\n1,$42.00\n'}
 const review=await files.plan(input,false,dataset);await files.apply(review,dataset)
 const source=await files.read(dataset)
 const stale={confirmDataset:dataset,reviewedDatasetRevision:null,previousRevision:previous.policy.revision,legalHold:false,minimumRetainUntil:null}
 const refused=await context.request.put(url,{headers,data:stale})
 assert.equal(refused.status(),422,await refused.text())
 assert.deepEqual((await (await context.request.get(url)).json()).policy,previous.policy)
 assert.deepEqual(await (await context.request.get(url+'/history')).json(),historyBefore,'Publishing a source invalidates an unpublished-state review without writing history')
 const approved=await context.request.put(url,{headers,data:{...stale,reviewedDatasetRevision:source.revision}})
 assert.equal(approved.status(),200,await approved.text())
 const replacement=(await (await context.request.get(url+'/history')).json()).history.at(-1)
 assert.equal(replacement.source_state,'published');assert.equal(replacement.source_revision,source.revision);assert.equal(replacement.previous_revision,previous.policy.revision)
 context.retentionActiveDataset=dataset
 console.log('PROBE BIF-034 source drift: actual reviewed file publication invalidated null-revision protection review without policy or acknowledgment writes; fresh exact source review succeeded.')
}
