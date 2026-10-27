import assert from 'node:assert/strict'

/** Continue the native entitlement journey against its real sources and grants. */
export async function proveEntitlementBoundaries({owner,rep,next,actors,definition,parameters,mapping,upload,call,run,publish,grant,clock,fixtureSql,revision,map}){
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
 const collision='synthetic-bifocal-normalization-collision'
 fixtureSql(`INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) SELECT '${collision}',upper(email),'Synthetic collision','member','active',1,created_at FROM oa_operators WHERE id='${rep.person.id}'`)
 try{
  assert.equal((await call(owner,'/explore/entitlements/review',{definition,previousRevision:revision()},409)).error,'ambiguous_entitlement_principal')
  assert.equal((await call(rep.context,'/explore/run',request(rep),409)).error,'ambiguous_entitlement_principal')
  await publish({...definition,normalization:'exact'});await run(rep,['one'])
 }finally{fixtureSql(`DELETE FROM oa_operators WHERE id='${collision}'`)}

 // Pin both the server and SQLite around one UTC civil-day boundary. The
 // same published policy switches from B to A without a new source snapshot.
 const boundary={...definition,maxAgeSeconds:604800}
 await clock.set('2026-10-27T23:59:59.999Z')
 rep.grant=await grant(rep.person)
 await upload(mapping,rows([row(rep.person.email,'A','10/28/2026','10/29/2026'),row(rep.person.email,'B','10/27/2026','10/28/2026')]),true)
 await publish(boundary)
 const before=await run(rep,['two'])
 assert.equal(before.context.exploration.entitlementDay,'2026-10-27')
 assert.equal(fixtureSql("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS utc")[0].utc,'2026-10-27T23:59:59.999Z')
 await clock.set('2026-10-28T00:00:00.000Z')
 const after=await run(rep,['one'])
 assert.equal(after.context.exploration.entitlementDay,'2026-10-28')
 assert.equal(fixtureSql("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS utc")[0].utc,'2026-10-28T00:00:00.000Z')
 assert.equal((await call(rep.context,'/explore/'+before.snapshotId,undefined,409)).error,'entitlement_snapshot_changed')
 assert.ok(!(await call(rep.context,'/explore')).questions.some(q=>q.id===before.snapshotId))
 await clock.set('2026-10-29T00:00:00.000Z');rep.grant=await grant(rep.person)
 assert.equal((await call(rep.context,'/explore/run',request(rep),403)).error,'entitlement_mapping_missing')

 await clock.set('2026-10-27T12:00:00.000Z')
 await upload(mapping,map(next.person.email),true);await publish()
 for(const actor of actors)actor.grant=await grant(actor.person)
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
