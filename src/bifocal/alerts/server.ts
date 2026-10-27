import { runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity } from '../data/snapshots/store'
import { exact, input, json, text } from '../metrics/transport'
import { fail, QueryError } from '../query/types'
import { rejectedUpload } from '../http/rejected'
import { uuid } from './protocol'
import { alertAction, alertList, alertView, createAlert, evaluateAlert } from './store.server'

/** Explicit synchronous native owner actions; there is no background evaluator. */
export async function alertResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),match=/^\/api\/operator\/alerts(?:\/([^/]+)(?:\/(evaluate|reset|acknowledge|snooze))?)?$/.exec(url.pathname)
 if(!match)return url.pathname.startsWith('/api/operator/alerts/')?json({error:'not_found'},404):null
 let response:Response
 try {
  if(request.headers.has('authorization'))fail('native_owner_session_required',403)
  const env=runtimeBindings(original),authority=await fileOwner(request,env)
  if(!authority)fail('owner_required',401)
  const ownerId=await ownerIdentity(env,authority),id=match[1]?uuid(match[1]):null,action=match[2]
  if(url.search)fail('query_parameters_not_supported',400)
  if(request.method==='GET'&&!action)response=json(id?await alertView(env,authority,ownerId,id):{rules:await alertList(env,authority,ownerId)})
  else if(request.method==='POST') {
   if(!request.headers.get('content-type')?.startsWith('application/json'))fail('json_body_required',400)
   const v=await input(request)
   if(!id)response=json({rule:await createAlert(env,authority,ownerId,v)},201)
   else if(action==='evaluate') {exact(v,['requestId']);response=json(await evaluateAlert(env,authority,ownerId,id,uuid(v.requestId)))}
   else if(action==='reset') {exact(v,[]);await alertAction(env,authority,ownerId,id,'reset',null,null);response=json(await alertView(env,authority,ownerId,id))}
   else if(action==='acknowledge'||action==='snooze') {
    exact(v,action==='snooze'?['episodeId','until']:['episodeId'])
    const episodeId=uuid(v.episodeId)
    let until:string|null=null
    if(action==='snooze') {
     const value=text(v.until,40),expiry=Date.parse(value)
     if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(expiry)||expiry<=Date.now())fail('future_iso_snooze_required',400)
     until=new Date(expiry).toISOString()
    }
    response=json({episode:await alertAction(env,authority,ownerId,id,action,episodeId,until)})
   }else fail('method_not_allowed',405)
  }else fail('method_not_allowed',405)
 }catch(error){response=error instanceof QueryError?json({error:error.code},error.status):json({error:'alert_conflict'},409)}
 return rejectedUpload(request,response)
}
