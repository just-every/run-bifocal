import { runtimeBindings,type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { boundedText, datasetId, inputBody, requireValue } from '../analytics/protocol'
import { RangeError } from '../spreadsheets/protocol'
import { approvedOrigins, readId, webInput } from './input'
import { startRead, checkRead, finishRead, cancelRead } from './consent.server'
import { readWeb } from './read'
import { planWeb } from './door.server'
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
export async function webSourceResponse(request:Request,original:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!['/api/operator/web-source/config','/api/operator/web-source/preview','/api/operator/web-source/cancel'].includes(path))return null
 try {
  const env=runtimeBindings(original),owner=await fileOwner(request,env)
  if(!owner){if(request.body)await boundedText(request.body,32768,'web_request_limit');return Response.json({error:'owner_required'},{status:401,headers})}
  if(path.endsWith('/config')){requireValue(request.method==='GET','method_not_allowed',405);return Response.json({origins:approvedOrigins(env.BIFOCAL_WEB_SOURCE_ORIGINS)},{headers})}
  requireValue(request.method==='POST','method_not_allowed',405)
  const value=await inputBody(request)
  if(path.endsWith('/cancel')) {
   requireValue(Object.keys(value).sort().join(',')==='datasetId,readId' && readId(value.readId) && datasetId(value.datasetId),'web_identity_required')
   await cancelRead(env,owner,value.readId,value.datasetId);return Response.json({cancelled:true},{headers})
  }
  const input=webInput(value,approvedOrigins(env.BIFOCAL_WEB_SOURCE_ORIGINS))
  await startRead(env,owner,input)
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000)
  try {
   const snapshot=await readWeb(input,()=>checkRead(env,owner,input),controller.signal)
   input.accessToken=''
   await checkRead(env,owner,input)
   const response=await planWeb(request,env,input,snapshot)
   await finishRead(env,owner,input.readId,response.ok?'staged':'failed')
   return response
  } catch(error){await finishRead(env,owner,input.readId,'failed');throw error}
  finally{clearTimeout(timer);input.accessToken=''}
 } catch(error){return Response.json({error:error instanceof RangeError?error.code:'web_read_conflict'},{status:error instanceof RangeError?error.status:409,headers})}
}
