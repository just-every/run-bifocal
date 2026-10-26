import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
export async function proveErasureReceipt(origin,context,auditId,dataset,revision){
 const auditUrl=origin+'/api/operator/erasure-receipts/'+auditId
 assert.equal((await fetch(auditUrl)).status,401)
 const auditResponse=await context.request.get(auditUrl)
 assert.equal(auditResponse.status(),200,await auditResponse.text())
 const audit=await auditResponse.json()
 assert.equal(audit.audit.kind,'source_erasure')
 assert.ok(audit.stores.some(store=>store.store==='ik_door_plan_chunks'&&store.rows>0))
 assert.equal(audit.stores.find(store=>store.store==='bf_file_tables').rows,1)
 assert.ok(audit.stores.every(store=>store.state==='complete'&&Number.isSafeInteger(store.rows)&&store.rows>=0))
 assert.notEqual(audit.audit.actor_ref,audit.audit.subject_ref)
 for(const erasedValue of [dataset,'synthetic-bifocal-1@example.test',revision]) assert.equal(JSON.stringify(audit).includes(erasedValue),false)
 assert.equal((await context.request.post(auditUrl,{headers:{Origin:origin},data:{}})).status(),405)
 assert.deepEqual(await (await context.request.get(auditUrl)).json(),audit)
}

export async function proveRetentionHold(origin,context,dataset,revision,page){
 const url=origin+'/api/operator/retention/'+dataset
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

 assert.equal((await context.request.put(url,{headers:{Origin:origin},data:{...input,previousRevision:policy.revision,legalHold:false}})).status(),409)
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
}
