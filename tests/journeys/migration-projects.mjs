import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function proveMigrationProjects({origin,context,call}){
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
 console.log('Migration projects: shared retained plans, exact approval, idempotent resume, deltas, native conflicts, both resolutions, original history, stale and foreign refusal, erasure and inert reconstruction inventories passed')
}
