import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

/** Change real native authority or custody immediately before the final batch. */
export async function proveAlertCommitFences({origin,owner,withdrawn,sessionId,rule,dataset,detail,evaluate,replace,healthy,overdue}) {
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
