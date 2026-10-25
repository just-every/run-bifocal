import {runtimeBindings,type Bindings} from '../../auth.server'
import {currentAuthority,type Authority} from '../catalog/authority.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {discardBody,exactKeys,json,jsonBody} from '../models/validation/transport'
import {fail,QueryError} from '../query/types'
import {prepareEstateDraft,saveEstateDraft,readEstate,readEstateRevision,estateGuard,publicationReview} from './store.server'
import {positiveVersion} from './protocol'
import {approveEstate,promoteEstate,rollbackEstate} from './publish.server'
import {runEnvironment} from './run.server'
export async function environmentDefinition(env:Bindings,actor:Authority,id:string){
 const state=await readEstate(env,actor,id),revision=state?await readEstateRevision(env,actor,id,state.head_revision):null
 await transact(env.DB,actor,[assertion(estateGuard(actor,id,state))])
 return revision?{document:JSON.parse(revision.document_json),revision:revision.revision,digest:revision.digest,state:'draft',environments:{development:state!.development,staging:state!.staging,production:state!.production},generation:state!.generation}:{document:null,revision:null}
}
export async function environmentResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),definition=/^\/api\/operator\/environment-definitions\/([a-z][a-z0-9-]{0,63})$/.exec(url.pathname),estate=/^\/api\/operator\/environments\/([a-z][a-z0-9-]{0,63})(?:\/(review|approve|promote|rollback-review|rollback|run))?$/.exec(url.pathname)
 if(!definition&&!estate)return null
 const env=runtimeBindings(original)
 try{
  const actor=await currentAuthority(request,env);if(!actor)fail('owner_required',401);if(actor.role!=='owner')fail('owner_required',403)
  if(url.search)fail('query_parameters_not_supported',400)
  if(definition){
   if(request.method==='GET')return json(await environmentDefinition(env,actor,definition[1]))
   if(request.method!=='POST'||!['review','apply'].includes(definition[1]))fail('method_not_allowed',405)
   const input=await jsonBody(request);exactKeys(input,['document','previousRevision','reviewedDigest'])
   if(input.previousRevision!==null)positiveVersion(input.previousRevision)
   if(definition[1]==='apply')return json(await saveEstateDraft(env,actor,input.document,input.previousRevision,input.reviewedDigest),201)
   const prepared=await prepareEstateDraft(env,actor,input.document,input.previousRevision);await transact(env.DB,actor,prepared.guards.map(assertion));return json(prepared.review)
  }
  const [,id,action]=estate!
  if(!action){
   if(request.method!=='GET')fail('method_not_allowed',405)
   const state=await environmentDefinition(env,actor,id)
   const rows=(await env.DB.prepare('SELECT revision,environment,action,actor_id,digest,recorded_at FROM bf_environment_history WHERE owner_id=? AND estate_id=? ORDER BY recorded_at,id LIMIT 201').bind(actor.id,id).all()).results
   await transact(env.DB,actor,[])
   return json({...state,history:rows})
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request)
  if(action==='run'){exactKeys(input,['environment','key','viewId']);return json(await runEnvironment(env,actor,id,input),201)}
  const n=positiveVersion(input.version)
  if(action==='review'||action==='rollback-review'){
   exactKeys(input,['version']);const prepared=await publicationReview(env,actor,id,n,action==='rollback-review');await transact(env.DB,actor,prepared.guards.map(assertion));return json(prepared.review)
  }
  if(action==='approve'){exactKeys(input,['version','digest','securityResolution']);return json(await approveEstate(env,actor,id,n,input.digest,input.securityResolution))}
  if(action==='promote'){
   exactKeys(input,['version','digest','environment']);if(input.environment!=='staging'&&input.environment!=='production')fail('invalid_environment',400)
   return json(await promoteEstate(env,actor,id,n,input.environment,input.digest))
  }
  exactKeys(input,['version','digest','previousGeneration','securityResolution']);return json(await rollbackEstate(env,actor,id,n,input.previousGeneration,input.digest,input.securityResolution))
 }catch(error){return error instanceof QueryError?json({error:error.code},error.status):json({error:'environment_conflict'},409)}finally{await discardBody(request)}
}
