import { runtimeBindings, type Bindings } from '../../auth.server'
import { currentAuthority } from '../catalog/authority.server'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'
import { createFromImport, reviewFromImport } from './import/create.server'
import { appList, appDetail, createApp, saveDraft, setMember } from './owner.server'
import { publish, reviewPublication, reviewRollback, rollback } from './publication.server'
import { appId, key } from './protocol'
import { appView, endSubscription, homeEntries, pageView, subscribe, subscriptionPreview, subscriptions } from './reader.server'
import { appGuard, readApp } from './store.server'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'

const prefix='/api/operator/apps'
/** Owners author and publish; members only read the audiences they currently belong to. */
export async function appResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path!==prefix&&!path.startsWith(prefix+'/'))return null
 const env=runtimeBindings(original)
 try {
  const actor=await currentAuthority(request,env)
  if(!actor)fail('sign_in_required',401)
  if(url.search)fail('query_parameters_not_supported',400)
  const owner=()=>{if(actor.role!=='owner')fail('owner_required',403)}
  const route=request.method+' '+path.slice(prefix.length)
  if(route==='GET ')return json(actor.role==='owner'?{apps:await appList(env,actor)}:fail('owner_required',403))
  if(route==='POST '){owner();const input=await jsonBody(request);exactKeys(input,['document']);return json(await createApp(env,actor,input.document),201)}
  if(route==='GET /home')return json({apps:await homeEntries(env,actor)})
  const imported=/^POST \/imports\/([a-z][a-z0-9-]{0,63})\/(review|create)$/.exec(route)
  if(imported){owner();const input=await jsonBody(request);return imported[2]==='review'?json(await reviewFromImport(env,actor,imported[1],input)):json(await createFromImport(env,actor,imported[1],input),201)}
  const match=/^(GET|POST|PUT) \/([a-f0-9-]{36})(\/draft|\/publication\/review|\/publication\/publish|\/rollback\/review|\/rollback\/apply|\/members|\/subscriptions|\/audiences\/([a-z][a-z0-9-]{0,63})\/pages\/([a-z][a-z0-9-]{0,63})|\/subscriptions\/([a-f0-9-]{36})\/preview)?$/.exec(route)
  const del=/^DELETE \/([a-f0-9-]{36})\/subscriptions\/([a-f0-9-]{36})$/.exec(route)
  if(del)return json(await endSubscription(env,actor,appId(del[1]),del[2]))
  if(!match)fail('not_found',404)
  const id=appId(match[2]),action=match[3]
  if(!action)return json(actor.role==='owner'?await appDetail(env,actor,id):await appView(env,actor,id))
  if(match[4])return json(await pageView(env,actor,id,key(match[4]),key(match[5])))
  if(match[6])return json(await subscriptionPreview(env,actor,id,match[6]))
  if(action==='/subscriptions')return json(request.method==='GET'?await subscriptions(env,actor,id):await subscribe(env,actor,id,await jsonBody(request)),request.method==='GET'?200:201)
  owner()
  const input=request.method==='GET'?{}:await jsonBody(request),app=await readApp(env,actor.id,id)
  if(action==='/draft'&&request.method==='POST'){exactKeys(input,['previousRevision','document']);return json(await saveDraft(env,actor,id,input.previousRevision,input.document),201)}
  if(action==='/members'&&request.method==='PUT'){exactKeys(input,['audience','operatorId','operatorVersion','enabled']);return json(await setMember(env,actor,id,input))}
  if(action==='/publication/review'&&request.method==='POST'){exactKeys(input,['draftRevision']);const {guards,...review}=await reviewPublication(env,actor,app,input.draftRevision);await transact(env.DB,actor,[assertion(appGuard(app)),...guards.map(assertion)]);return json(review)}
  if(action==='/publication/publish'&&request.method==='POST'){exactKeys(input,['draftRevision','reviewedDigest']);return json(await publish(env,actor,app,input.draftRevision,input.reviewedDigest),201)}
  if(action==='/rollback/review'&&request.method==='POST'){exactKeys(input,['version','previousPublished']);const {guards,...review}=await reviewRollback(env,actor,app,input.version,input.previousPublished);await transact(env.DB,actor,[assertion(appGuard(app)),...guards.map(assertion)]);return json(review)}
  if(action==='/rollback/apply'&&request.method==='POST'){exactKeys(input,['version','previousPublished','reviewedDigest']);return json(await rollback(env,actor,app,input.version,input.previousPublished,input.reviewedDigest),201)}
  fail('method_not_allowed',405)
 }catch(error){return error instanceof QueryError?json({error:error.code},error.status):json({error:'app_conflict',reason:'Review the current app, content and sources again.'},409)}finally{await discardBody(request)}
}
