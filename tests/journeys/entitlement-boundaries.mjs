import assert from 'node:assert/strict'

/** Continue the native entitlement journey against its real sources and grants. */
export async function proveEntitlementBoundaries({origin,owner,rep,next,actors,definition,parameters,mapping,upload,call,run,publish,grant,clock,fixture,revision,map,browser,devKey,contexts}){
 const rows=entries=>'principal,role,value,valid_from,valid_until\n'+entries.map(entry=>entry.join(',')).join('\n')+'\n'
 const row=(principal,value,from='01/01/2020',until='01/01/2099')=>[principal,'sales',value,from,until]
 const request=actor=>({...parameters,grantId:actor.grant.id})
 const review=(def=definition)=>call(owner,'/explore/entitlements/review',{definition:def,previousRevision:revision()},200)
 const missing={...definition};delete missing.normalization
 assert.equal((await call(owner,'/explore/entitlements/review',{definition:missing,previousRevision:revision()},400)).error,'invalid_entitlement_definition')

 // Case folding is explicitly chosen. Provider aliases and whitespace never
 // become native identities or silently widen an existing exact grant.
 const alias=rep.person.email.replace('@','+alias@'),dotted=rep.person.email.replace('synthetic','syn.thetic')
 await upload(mapping,rows([row(rep.person.email.toUpperCase(),'A'),row(alias,'B'),row(dotted,'D')]),true)
 await publish();await run(rep,['one'])
 await publish({...definition,normalization:'exact'})
 assert.equal((await call(rep.context,'/explore/run',request(rep),403)).error,'entitlement_mapping_missing')
 await upload(mapping,rows([row(alias,'A'),row(dotted,'B')]),true);await publish()
 assert.equal((await call(rep.context,'/explore/run',request(rep),403)).error,'entitlement_mapping_missing')
 await upload(mapping,rows([row(' '+rep.person.email,'A')]),true)
 assert.equal((await call(owner,'/explore/entitlements/review',{definition,previousRevision:revision()},400)).error,'invalid_entitlement_mapping')
 await upload(mapping,rows([row(rep.person.email,'A')]),true);await publish()

 // A stored native collision is a fixture, since the current invite door
 // lowercases addresses. Both publication and current response must refuse it.
 await fixture('collision-insert',rep.person.id)
 try{
  assert.equal((await call(owner,'/explore/entitlements/review',{definition,previousRevision:revision()},409)).error,'ambiguous_entitlement_principal')
  assert.equal((await call(rep.context,'/explore/run',request(rep),409)).error,'ambiguous_entitlement_principal')
  await publish({...definition,normalization:'exact'});await run(rep,['one'])
 }finally{await fixture('collision-remove')}

 // Pin both the server and SQLite around one UTC civil-day boundary. The
 // same published policy switches from B to A without a new source snapshot.
 const boundary={...definition,maxAgeSeconds:604800}
 await clock.set('2026-10-27T23:59:59.999Z')
 rep.grant=await grant(rep.person)
 await upload(mapping,rows([row(rep.person.email,'A','10/28/2026','10/29/2026'),row(rep.person.email,'B','10/27/2026','10/28/2026')]),true)
 await publish(boundary)
 const before=await run(rep,['two'])
 assert.equal(before.context.exploration.entitlementDay,'2026-10-27')
 assert.equal((await fixture('clock')).utc,'2026-10-27T23:59:59.999Z')
 await clock.set('2026-10-28T00:00:00.000Z')
 const after=await run(rep,['one'])
 assert.equal(after.context.exploration.entitlementDay,'2026-10-28')
 assert.equal((await fixture('clock')).utc,'2026-10-28T00:00:00.000Z')
 assert.equal((await call(rep.context,'/explore/'+before.snapshotId,undefined,409)).error,'entitlement_snapshot_changed')
 assert.ok(!(await call(rep.context,'/explore')).questions.some(q=>q.id===before.snapshotId))
 await clock.set('2026-10-29T00:00:00.000Z');rep.grant=await grant(rep.person)
 assert.equal((await call(rep.context,'/explore/run',request(rep),403)).error,'entitlement_mapping_missing')

 await clock.set('2026-10-27T12:00:00.000Z')
 await upload(mapping,map(next.person.email),true);await publish()
 for(const actor of actors)actor.grant=await grant(actor.person)
 const cookie=(await owner.cookies(origin)).map(c=>c.name+'='+c.value).join(';')
 const arm=async(at,before,mutation)=>{
  const response=await owner.request.post(origin+'/__entitlement-boundary',{data:{at:'/api/operator'+at,before,cookie,...mutation}})
  assert.equal(response.status(),200);assert.equal((await response.json()).armed,true)
 }
 const publishPath='/explore/entitlements/publish'
 // Reactivation uses the native account door. A dormant ambiguous identity
 // becoming active after validation must cancel publication and data release.
 const collisionId='synthetic-bifocal-normalization-collision'
 const activateCollision={path:'/auth/operator/status',body:{operatorId:collisionId,status:'active'}}
 await fixture('collision-stage',rep.person.id)
 try{
  const identityReview=await review()
  await arm(publishPath,'INSERT INTO bf_entitlement_snapshots',activateCollision)
  await call(owner,publishPath,{definition,previousRevision:revision(),reviewedDigest:identityReview.digest},409)
  assert.equal((await call(owner,'/explore/entitlements/'+parameters.modelId+'/accounts')).revision,revision(),'Ambiguous identities cannot publish a reviewed policy')
 }finally{await fixture('collision-remove')}
 const identityResult=await run(rep,['two'])
 await fixture('collision-stage',rep.person.id)
 try{
  await arm('/explore/'+identityResult.snapshotId+'/export','INSERT INTO bf_explore_audit',activateCollision)
  await call(rep.context,'/explore/'+identityResult.snapshotId+'/export',{scope:'underlying',format:'csv'},409)
  assert.equal((await call(rep.context,'/explore/'+identityResult.snapshotId+'/page',{scope:'underlying',offset:0},409)).error,'ambiguous_entitlement_principal')
  assert.ok(!(await call(rep.context,'/explore')).questions.some(q=>q.id===identityResult.snapshotId))
 }finally{await fixture('collision-remove')}
 await run(rep,['two'])
 const pendingSource=await review(),replacement=await upload(mapping,map(rep.person.email),true,true)
 await arm(publishPath,'INSERT INTO bf_entitlement_snapshots',replacement)
 await call(owner,publishPath,{definition,previousRevision:revision(),reviewedDigest:pendingSource.digest},409)
 assert.equal((await call(owner,'/explore/entitlements/'+parameters.modelId+'/accounts')).revision,revision(),'A changed source cannot publish the previously reviewed policy')
 await upload(mapping,map(next.person.email),true);await publish()
 const extraOwner=await browser.newContext();contexts.push(extraOwner)
 assert.equal((await extraOwner.request.post(origin+'/__dev/key',{headers:{Origin:origin},data:{key:devKey}})).status(),204)
 const ownerPerson=(await(await owner.request.get(origin+'/auth/operators')).json()).find(p=>p.role==='owner')
 await extraOwner.request.get(new URL(ownerPerson.signInUrl,origin).href)
 const ownerSession=await(await extraOwner.request.get(origin+'/auth/session')).json()
 const custodyReview=await call(extraOwner,'/explore/entitlements/review',{definition,previousRevision:revision()},200)
 await arm(publishPath,'INSERT INTO bf_entitlement_snapshots',{path:'/auth/session/revoke',body:{sessionId:ownerSession.id}})
 await call(extraOwner,publishPath,{definition,previousRevision:revision(),reviewedDigest:custodyReview.digest},409)
 assert.equal((await extraOwner.request.get(origin+'/auth/session')).status(),401)
 assert.equal((await call(owner,'/explore/entitlements/'+parameters.modelId+'/accounts')).revision,revision(),'Lost native owner authority cannot publish a policy')
 const responseSource=await run(next,['one']),sourceMutation=await upload(mapping,map(rep.person.email),true,true)
 await arm('/explore/'+responseSource.snapshotId+'/export','INSERT INTO bf_explore_audit',sourceMutation)
 await call(next.context,'/explore/'+responseSource.snapshotId+'/export',{scope:'underlying',format:'csv'},409)
 await upload(mapping,map(next.person.email),true);await publish()
 const responseAuthority=await run(next,['one'])
 await arm('/explore/'+responseAuthority.snapshotId+'/export','INSERT INTO bf_explore_audit',{path:'/api/operator/explore/access/'+next.grant.id+'/revoke',body:{}})
 await call(next.context,'/explore/'+responseAuthority.snapshotId+'/export',{scope:'underlying',format:'csv'},409)
 next.grant=await grant(next.person)
 const result=await run(next,['one']),pending=await review()
 // The reviewed source must still be current at publication. Already saved
 // answers, their labels and export plans must recheck current authority.
 await upload(mapping,map(rep.person.email),true)
 await call(owner,'/explore/entitlements/publish',{definition,previousRevision:revision(),reviewedDigest:pending.digest},409)
 assert.equal((await call(next.context,'/explore/'+result.snapshotId+'/export',{scope:'underlying',format:'csv'},409)).error,'entitlement_snapshot_changed')
 await upload(mapping,map(next.person.email),true);await publish()
 const authorized=await run(next,['one'])
 await call(owner,'/explore/access/'+next.grant.id+'/revoke',{},200)
 assert.equal((await call(next.context,'/explore/'+authorized.snapshotId+'/page',{scope:'underlying',offset:0},403)).error,'exploration_access_required')
 assert.equal((await call(next.context,'/explore/'+authorized.snapshotId+'/export',{scope:'underlying',format:'csv'},403)).error,'exploration_access_required')
 assert.ok(!(await call(next.context,'/explore')).questions.some(q=>q.id===authorized.snapshotId))
 next.grant=await grant(next.person);await run(next,['one'])
 console.log('Entitlement boundaries: explicit normalization, no aliases or trimming, ambiguous native identity refusal, inclusive UTC start and exclusive UTC end, old-day withdrawal, current-source publication and revoked response authority passed')
}
