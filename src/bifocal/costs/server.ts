import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { rejectedResponse } from '../../base/rejected-response'
import { fileOwner } from '../imports/files/owner.server'
import { guarded, sql, type Authority } from '../company/store'
import { body, ConventionsError, identifier, integer, object, requireValue } from '../company/protocol'
import { referenceQuote } from './quote'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}})
const check=(predicate:string,...params:unknown[])=>sql(`INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`,...params)
const committed=`COALESCE((SELECT SUM(CASE state WHEN 'reserved' THEN estimated_micro WHEN 'settled' THEN actual_micro ELSE 0 END) FROM bf_cost_reservations r WHERE r.scope=b.scope AND r.budget_id=b.id),0)`
const audit=(owner:Authority,kind:string,id:string)=>sql('INSERT INTO bf_cost_audit VALUES(?,?,?,?,?)',randomUUID(),owner.email,kind,id,new Date().toISOString())
export async function costResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname
 if(path!=='/api/cost-reference'&&!path.startsWith('/api/operator/costs/'))return null
 try{
  if(path==='/api/cost-reference'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   return json(referenceQuote(await body(request)))
  }
  const env=runtimeBindings(original),owner=await fileOwner(request,env)
  if(!owner)return rejectedResponse(request,json({error:'owner_required'},401))
  if(path==='/api/operator/costs/budgets'&&request.method==='GET'){
   const [budgets]=await guarded(env,owner,[sql(`SELECT b.*,${committed} AS committed_micro FROM bf_cost_budgets b ORDER BY scope,id LIMIT 1001`)])
   requireValue(budgets.length<=1000,'budget_list_limit')
   return json({budgets,scope:'Owner-operated reservation ledger only. No analytical execution integration or measured provider invoice reconciliation is claimed. Budgets are cumulative, with no automatic reset.'})
  }
  if(path==='/api/operator/costs/reservations'&&request.method==='GET'){
   const scope=url.searchParams.get('scope'),id=identifier(url.searchParams.get('budgetId'))
   requireValue(['source','job','agent','tenant'].includes(String(scope)),'invalid_budget_scope')
   const [reservations]=await guarded(env,owner,[sql('SELECT * FROM bf_cost_reservations WHERE scope=? AND budget_id=? ORDER BY created_at DESC,id DESC LIMIT 101',scope,id)])
   requireValue(reservations.length<=100,'reservation_list_limit')
   return json({reservations,usageBasis:'Owner-reported usage; reserved estimates are not guaranteed bills.'})
  }
  if(path==='/api/operator/costs/budgets'&&request.method==='PUT'){
   const input=object(await body(request),['scope','id','previousRevision','limitMicroUsd','warnMicroUsd'])
   requireValue(['source','job','agent','tenant'].includes(String(input.scope)),'invalid_budget_scope')
   const scope=String(input.scope),id=identifier(input.id),limit=integer(input.limitMicroUsd,'limitMicroUsd',0,1000000000000),warn=integer(input.warnMicroUsd,'warnMicroUsd',0,limit),revision=randomUUID()
   requireValue(input.previousRevision===null||typeof input.previousRevision==='string','previous_revision_required')
   await guarded(env,owner,[check('(SELECT revision FROM bf_cost_budgets WHERE scope=? AND id=?) IS ?',scope,id,input.previousRevision),sql('INSERT INTO bf_cost_budgets VALUES(?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET revision=excluded.revision,limit_micro=excluded.limit_micro,warn_micro=excluded.warn_micro',scope,id,revision,limit,warn),audit(owner,'budget_changed',id)])
   return json({revision,scope,id,limitMicroUsd:limit,warnMicroUsd:warn})
  }
  if(path==='/api/operator/costs/reservations'&&request.method==='POST'){
   const input=object(await body(request),['scope','budgetId','reviewedBudgetRevision','estimatedMicroUsd'])
   const scope=String(input.scope),budgetId=identifier(input.budgetId),estimate=integer(input.estimatedMicroUsd,'estimatedMicroUsd',0,1000000000000),id=randomUUID()
   requireValue(typeof input.reviewedBudgetRevision==='string','budget_review_required')
   const [rows]=await guarded<{revision:string;available:number}>(env,owner,[sql(`SELECT revision,limit_micro-${committed} AS available FROM bf_cost_budgets b WHERE scope=? AND id=?`,scope,budgetId)])
   if(!rows[0]||rows[0].available<estimate)return json({state:'held',error:'budget_held',uncertainty:'Owner-entered estimate, not a guaranteed bill.',recovery:'Ask the current owner to increase the budget, then review its new revision before reserving. No work was executed.'},409)
   await guarded(env,owner,[check(`EXISTS(SELECT 1 FROM bf_cost_budgets b WHERE scope=? AND id=? AND revision=? AND limit_micro-${committed}>=?)`,scope,budgetId,input.reviewedBudgetRevision,estimate),sql("INSERT INTO bf_cost_reservations VALUES(?,?,?,?,NULL,'reserved',?)",id,scope,budgetId,estimate,new Date().toISOString()),audit(owner,'reserved',id)])
   const [budgets]=await guarded<{warning:number}>(env,owner,[sql(`SELECT (${committed}>=warn_micro) AS warning FROM bf_cost_budgets b WHERE scope=? AND id=?`,scope,budgetId)])
   return json({id,state:'reserved',warning:!!budgets[0]?.warning,execution:'No execution is started by this reservation.'},201)
  }
  const match=/^\/api\/operator\/costs\/reservations\/([a-f0-9-]{36})$/.exec(path)
  if(match&&request.method==='PUT'){
   const input=object(await body(request),['state','actualMicroUsd'])
   requireValue(input.state==='settled'||input.state==='released','invalid_reservation_state')
   const actual=input.state==='settled'?integer(input.actualMicroUsd,'actualMicroUsd',0,1000000000000):null
   requireValue(input.state!=='released'||input.actualMicroUsd===undefined,'release_has_no_usage')
   await guarded(env,owner,[check("EXISTS(SELECT 1 FROM bf_cost_reservations WHERE id=? AND state='reserved')",match[1]),sql('UPDATE bf_cost_reservations SET state=?,actual_micro=? WHERE id=?',input.state,actual,match[1]),audit(owner,String(input.state),match[1])])
   return json({id:match[1],state:input.state,actualMicroUsd:actual,usageBasis:'owner-reported; not provider-verified'})
  }
  return json({error:'not_found'},404)
 }catch(error){
  if(error instanceof ConventionsError)return rejectedResponse(request,json({error:error.code,details:error.details},error.status))
  return rejectedResponse(request,json({error:'cost_conflict',recovery:'Read the current budget and reservation state, review the estimate and retry. No automatic retry or execution occurs.'},409))
 }
}
