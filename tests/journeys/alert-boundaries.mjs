import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

/** Change real native authority or custody immediately before the final batch. */
export async function proveAlertCommitFences({origin,owner,withdrawn,sessionId,rule,dataset,detail,evaluate,replace,healthy,overdue,qualityIds,now}) {
 const cookie=(await owner.cookies(origin)).map(c=>c.name+'='+c.value).join(';')
 const arm=async mutation=>{
  const response=await owner.request.post(origin+'/__entitlement-boundary',{data:{at:'/api/operator/alerts/'+rule.id+'/evaluate',before:'INSERT INTO bf_alert_observations',cookie,...mutation}})
  assert.equal(response.status(),200)
 }
 const before=await detail(rule)
 const history=await owner.request.get(origin+'/api/operator/import/history',{headers:{'X-Import-Dataset':dataset}})
 assert.equal(history.status(),200)
 const current=(await history.json()).history[0]
 assert.equal(current.state,'completed')
 await arm({path:'/api/operator/import/undo',headers:{'X-Import-Dataset':dataset},body:{planId:current.planId}})
 const sourceRace=await owner.request.post(origin+'/api/operator/alerts/'+rule.id+'/evaluate',{headers:{Origin:origin},data:{requestId:randomUUID()}})
 assert.equal(sourceRace.status(),409)
 assert.deepEqual(await detail(rule),before,'Source withdrawal at commit cannot record a result or clear an episode')
 await replace(overdue);await healthy()
 // Follow-up transitions also fence source custody, even though they do not run a query.
 for(const [action,data] of [['reset',{}],['acknowledge',{episodeId:before.episodes.find(e=>e.state==='open').id}],['snooze',{episodeId:before.episodes.find(e=>e.state==='open').id,until:new Date(now+3600000).toISOString()}]]) {
  const state=await detail(rule),history=await owner.request.get(origin+'/api/operator/import/history',{headers:{'X-Import-Dataset':dataset}})
  assert.equal(history.status(),200)
  const current=(await history.json()).history[0]
  await arm({at:'/api/operator/alerts/'+rule.id+'/'+action,before:'INSERT INTO bf_alert_transitions',path:'/api/operator/import/undo',headers:{'X-Import-Dataset':dataset},body:{planId:current.planId}})
  assert.equal((await owner.request.post(origin+'/api/operator/alerts/'+rule.id+'/'+action,{headers:{Origin:origin},data})).status(),409)
  assert.deepEqual(await detail(rule),state,'Source drift at commit refuses '+action+' without changing custody')
  await replace(overdue);await healthy()
 }
 // A new unrun quality rule introduced at commit cannot be ignored.
 const qualityBefore=await detail(rule),qualityId='synthetic-bifocal-169'
 await arm({path:'/api/operator/quality/rules',body:{id:qualityId,dataset,definition:{name:'Invoice identity present',kind:'not-null',column:'invoice'}}})
 assert.equal((await owner.request.post(origin+'/api/operator/alerts/'+rule.id+'/evaluate',{headers:{Origin:origin},data:{requestId:randomUUID()}})).status(),409)
 assert.deepEqual(await detail(rule),qualityBefore,'Quality evidence changing at commit cannot advance or recover an episode')
 qualityIds.push(qualityId);await healthy()
 // A saved request is still subject to source custody at the response boundary.
 const saved=await evaluate(rule),replayBefore=await detail(rule),replayHistory=await owner.request.get(origin+'/api/operator/import/history',{headers:{'X-Import-Dataset':dataset}})
 assert.equal(replayHistory.status(),200)
 await arm({before:'INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (EXISTS(SELECT 1 FROM bf_file_tables',path:'/api/operator/import/undo',headers:{'X-Import-Dataset':dataset},body:{planId:(await replayHistory.json()).history[0].planId}})
 assert.equal((await owner.request.post(origin+'/api/operator/alerts/'+rule.id+'/evaluate',{headers:{Origin:origin},data:{requestId:saved.observation.requestId}})).status(),409)
 assert.deepEqual(await detail(rule),replayBefore,'Replaying a committed request cannot bypass current source evidence')
 await replace(overdue);await healthy()
 // A separately signed-in owner is current at admission, then revoked by the owner.
 const beforeRevocation=await detail(rule)
 await arm({path:'/auth/session/revoke',body:{sessionId}})
 const authorityRace=await withdrawn.request.post(origin+'/api/operator/alerts/'+rule.id+'/evaluate',{headers:{Origin:origin},data:{requestId:randomUUID()}})
 assert.equal(authorityRace.status(),409)
 assert.equal((await withdrawn.request.get(origin+'/auth/session')).status(),401)
 assert.deepEqual(await detail(rule),beforeRevocation,'Owner withdrawal at commit cannot record a result or change follow-up')
 const recovered=await evaluate(rule)
 assert.equal(recovered.observation.answer.totals.amount.value,'150.00')
}
