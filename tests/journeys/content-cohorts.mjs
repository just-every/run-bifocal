import assert from 'node:assert/strict'
export async function proveUsageCohorts(origin,owner,readerId,ownerId,duplicate,policy,call){
 const ids=[readerId,ownerId]
 for(let i=ids.length;i<policy.minimumGroupSize;i++){
  const email='synthetic-bifocal-cohort-'+i+'@example.test'
  const invitation=await owner.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email,displayName:'Synthetic cohort reader '+i,role:'member'}});assert.equal(invitation.status(),202)
  const people=await(await owner.request.get(origin+'/auth/operators')).json(),person=people.find(p=>p.email===email);assert.ok(person?.signInUrl)
  // The existing test browser supplies each native invite's real signed session.
  const context=await owner.browser().newContext()
  try{assert.equal((await context.request.post(origin+'/__dev/key',{headers:{Origin:origin},data:{key:'synthetic-bifocal-4'.repeat(3)}})).status(),204);await context.request.get(new URL(person.signInUrl,origin).href);assert.equal((await(await context.request.get(origin+'/auth/session')).json()).operator.id,person.id)}finally{await context.close()}
  ids.push(person.id)
 }
 for(const reader of ids)if(reader!==ownerId)await call(owner,'/items/'+duplicate.id+'/grants',{readerId:reader,enabled:true},200,'PUT')
 const events=ids.map((readerId,i)=>({id:'synthetic-bifocal-cohort-open-'+i,itemId:duplicate.id,readerId,tenant:'company-west',openedAt:new Date(Date.now()-1000-i).toISOString()}))
 await call(owner,'/usage/import',{policyVersion:policy.version,events})
 const hygiene=await call(owner,'/hygiene'),group=hygiene.aggregate.items.find(i=>i.id===duplicate.id)
 assert.equal(group.state,'available');assert.equal(group.opens,events.length);assert.ok(group.lastOpen)
 return hygiene
}
