import { runtimeBindings, type Bindings } from '../../auth.server'
import { currentAuthority } from '../catalog/authority.server'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'
import { previousRevision } from './protocol'
import { applyPolicy, policyAudit, policyGuard, readPolicy, reviewPolicy } from './store.server'

export async function policyDefinitionResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),prefix='/api/operator/policy-definitions'
 if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return null
 const env=runtimeBindings(original)
 try {
  const actor=await currentAuthority(request,env)
  if(!actor)fail('owner_required',401)
  if(actor.role!=='owner')fail('owner_required',403)
  if(url.search)fail('query_parameters_not_supported',400)
  if(request.method!=='GET'&&['/review','/apply'].some(suffix=>url.pathname===prefix+suffix)) {
   if(request.method!=='POST')fail('method_not_allowed',405)
   const input=await jsonBody(request),apply=url.pathname.endsWith('/apply')
   exactKeys(input,apply?['document','previousRevision','reviewedDigest']:['document','previousRevision'])
   const previous=previousRevision(input.previousRevision)
   if(apply)return json(await applyPolicy(env,actor,input.document,previous,input.reviewedDigest),201)
   const {review,guards}=await reviewPolicy(env,actor,input.document,previous)
   await transact(env.DB,actor,[...guards.map(assertion),policyAudit(actor,review.document.id,previous,review.digest,'review')])
   return json(review)
  }
  const match=/^\/api\/operator\/policy-definitions\/([a-z][a-z0-9-]{0,63})$/.exec(url.pathname)
  if(!match)fail('not_found',404)
  if(request.method!=='GET')fail('method_not_allowed',405)
  const current=await readPolicy(env,actor,match[1])
  await transact(env.DB,actor,[assertion(policyGuard(actor,match[1],current?.revision??null)),...(current?[policyAudit(actor,match[1],current.revision,current.digest,'read')]:[])])
  return json(current?{document:JSON.parse(current.document_json),revision:current.revision,digest:current.digest,active:false}:{document:null,revision:null,active:false})
 }catch(error){return error instanceof QueryError?json({error:error.code},error.status):json({error:'policy_conflict',reason:'Review the current policy, model and sources again.'},409)}finally{await discardBody(request)}
}
