import { randomUUID } from 'node:crypto'
import { runtimeBindings,type Bindings } from '../../auth.server'
import { assertion,sql,transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson,sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity,saveQuery } from '../data/snapshots/store'
import { readModel,readDefinition,modelGuard } from '../models/validation/store.server'
import { exactKeys,json,jsonBody } from '../models/validation/transport'
import { QueryError,fail } from '../query/types'
import { rejectedUpload } from '../http/rejected'
import { qualityState } from '../quality/server'
import { questionScope } from './scope.server'
import { questionQuery } from './compile'
import { requestInput,plannerInput } from './request'
import { questionPrompt,planQuestion,PlannerError } from './planning'
import { explainDrivers } from './drivers'
const policyVersion='owner-question-consent-v1'
const disclosure='AI is off unless explicitly configured. This action sends only the exact question, editable conversation context and permitted semantic definitions shown here to that provider. Source rows and result values are not sent. Consent is recorded for this one request; no automatic follow-up or retry runs.'
async function handle(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname
 if(!/^\/api\/operator\/ask(?:\/|$)/.test(path))return null
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner)
 if(url.search)fail('query_parameters_not_supported',400)
 if(path==='/api/operator/ask'){
  if(request.method!=='GET')fail('method_not_allowed',405)
  const models=(await env.DB.prepare('SELECT id FROM bf_semantic_models WHERE owner_id=? AND production IS NOT NULL ORDER BY id LIMIT 101').bind(ownerId).all<{id:string}>()).results
  if(models.length>100)fail('model_catalog_limit',413)
  const views=[],guards=[]
  for(const item of models){const model=await readModel(env,ownerId,item.id),definition=await readDefinition(env,model.production!);guards.push(modelGuard(model));for(const view of definition.views)if(view.query.semantic)views.push({modelId:model.id,revision:model.production,viewId:view.id,dimensions:view.query.semantic.dimensions,measures:view.query.measures,rowRules:view.rowRules,filters:view.query.filters,fiscal:view.query.fiscal??null})}
  const history=(await env.DB.prepare('SELECT id,question,created_at AS createdAt FROM bf_questions WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 50').bind(ownerId).all()).results
  await transact(env.DB,owner,guards.map(assertion));return json({views,history,enabled:env.AI_ENABLED==='true',policyVersion,disclosure})
 }
 if(path==='/api/operator/ask/preview'||path==='/api/operator/ask/run'){
  if(request.method!=='POST')fail('method_not_allowed',405)
  const body=await jsonBody(request);exactKeys(body,['modelId','revision','viewId','question','asOf','context',...(path.endsWith('/run')?['reviewedDigest','consent']:[])])
  const input=requestInput(body),scope=await questionScope(env,ownerId,input.modelId,input.revision,input.viewId),planning=plannerInput(input,scope),prompt=questionPrompt(planning),digest=sha256(canonicalJson({ownerId,request:input,body:prompt.body,guards:scope.guards,policyVersion,model:env.AI_MODEL??null}))
  await transact(env.DB,owner,scope.guards.map(assertion))
  if(path.endsWith('/preview'))return json({digest,outbound:prompt.outbound,disclosure,policyVersion,model:env.AI_MODEL??null})
  if(body.consent!==true||body.reviewedDigest!==digest)fail('exact_question_consent_required',409)
  if(env.AI_ENABLED!=='true')fail('ai_disabled',503)
  if(!env.AI_MODEL)fail('ai_misconfigured',503)
  const consentId=randomUUID(),createdAt=new Date().toISOString()
  await transact(env.DB,owner,[...scope.guards.map(assertion),sql('INSERT INTO bf_question_consents(id,owner_id,prompt_digest,policy_version,outcome,created_at) VALUES(?,?,?,?,?,?)',consentId,ownerId,digest,policyVersion,'started',createdAt)])
  let outcome:'completed'|'uncertain'='uncertain'
  try{
   const {plan,provider}=await planQuestion(env as unknown as Record<string,unknown>,planning,request.signal)
   let snapshot,why,interpretation:unknown=input.context
   if(plan.decision==='answer'){
    // Quality is read before any why arithmetic. Unknown or failed evidence is
    // shown first and cannot become a model-generated causal finding.
    const quality=await qualityState(env,scope.sources.map(s=>s.id)),compiled=questionQuery(scope,plan)
    snapshot=await saveQuery(env,owner,compiled.query,scope.context,scope.sources);interpretation=compiled.interpretation
    if(plan.intent==='why'){
     const prior=questionQuery(scope,plan,true),comparison=await saveQuery(env,owner,prior.query,scope.context,scope.sources)
     why={quality,...explainDrivers(scope,compiled.query,prior.query,plan),comparison:{queryId:comparison.queryId,definition:comparison.definition,period:prior.interpretation.period}}
    }
   }
   const id=randomUUID(),result={id,question:input.question,request:input,decision:plan.decision,message:plan.decision==='answer'?'Computed from the permitted native definitions and the visible interpreted scope.':plan.message,missing:plan.missing,interpretation,definitions:scope.query.measures.filter(m=>plan.measureIds.includes(m.id)),...(snapshot?{snapshot}:{}),...(why?{why}:{}),provider,consent:{id:consentId,digest,policyVersion},createdAt}
   const encoded=canonicalJson(result)
   await transact(env.DB,owner,[...scope.guards.map(assertion),sql('INSERT INTO bf_questions(id,owner_id,model_id,snapshot_id,question,result_json,digest,created_at) VALUES(?,?,?,?,?,?,?,?)',id,ownerId,scope.model.id,snapshot?.queryId??null,input.question,encoded,sha256(encoded),createdAt),...scope.sources.map(s=>sql('INSERT INTO bf_question_sources(question_id,dataset_id) VALUES(?,?)',id,s.id))])
   outcome='completed';return json(result,201)
  }finally{await env.DB.prepare('UPDATE bf_question_consents SET outcome=? WHERE id=? AND owner_id=?').bind(outcome,consentId,ownerId).run()}
 }
 const match=/^\/api\/operator\/ask\/([a-f0-9-]{36})$/.exec(path)
 if(!match)fail('not_found',404)
 if(request.method!=='GET')fail('method_not_allowed',405)
 const row=await env.DB.prepare('SELECT result_json,digest FROM bf_questions WHERE id=? AND owner_id=?').bind(match[1],ownerId).first<{result_json:string;digest:string}>()
 if(!row)fail('question_not_found',404)
 if(sha256(row.result_json)!==row.digest)fail('question_integrity_failed',409)
 await transact(env.DB,owner,[assertion(sql('EXISTS(SELECT 1 FROM bf_questions WHERE id=? AND owner_id=? AND digest=? AND result_json=?)',match[1],ownerId,row.digest,row.result_json))])
 return json(JSON.parse(row.result_json))
}
export async function questionResponse(request:Request,env:Bindings):Promise<Response|null>{
 let response
 try{response=await handle(request,env)}catch(error){response=error instanceof QueryError||error instanceof PlannerError?json({error:error.code,reason:error.message},error.status):json({error:'question_conflict',reason:'The source, session or governed definition changed. Review this question again.'},409)}
 return response?rejectedUpload(request,response):null
}
