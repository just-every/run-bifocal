import { runtimeBindings, type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { RangeError } from '../spreadsheets/protocol'
import { AnalyticsError, boundedText, datasetId, inputBody, publicOrigin, requireValue, token } from './protocol'
import { lineage } from './lineage'
import { readVane } from '../siblings/vane'
import { readProductTable } from '../databases/bigquery'
import { planSource } from './door.server'
import { readAudit } from './audit.server'
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
export async function analyticsSourceResponse(request:Request, original:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!['/api/operator/analytics/vane/preview','/api/operator/analytics/product-table/preview','/api/operator/analytics/config'].includes(path))return null
 const env=runtimeBindings(original)
 try {
  const owner=await fileOwner(request,env)
  if(!owner){if(request.body)await boundedText(request.body,32768,'analytics_request_limit');return Response.json({error:'owner_required'},{status:401,headers})}
  if(path.endsWith('/config')) {
   requireValue(request.method === 'GET','method_not_allowed',405)
   return Response.json({vaneConfigured:!!env.BIFOCAL_VANE_ORIGIN,vaneOrigin:env.BIFOCAL_VANE_ORIGIN ? publicOrigin(env.BIFOCAL_VANE_ORIGIN) : null},{headers})
  }
  requireValue(request.method === 'POST','method_not_allowed',405)
  const input=await inputBody(request), vane=path.includes('/vane/')
  requireValue(Object.keys(input).every(k=>(vane?['datasetId','siteId','from','to','accessToken','confirmRead','catchup']:['datasetId','project','dataset','table','fields','from','to','timezone','accessToken','confirmRead','catchup']).includes(k)), 'unsupported_source_field')
  requireValue(datasetId(input.datasetId) && input.confirmRead === true && (input.catchup === undefined || typeof input.catchup === 'boolean'),'explicit_source_read_required')
  const grant=token(input.accessToken),{accessToken,...meaning}=input
  requireValue(!JSON.stringify(meaning).includes(grant),'credential_in_source')
  requireValue(!vane || !!env.BIFOCAL_VANE_ORIGIN,'vane_installation_setup_required',409)
  const audit=readAudit(env,owner,input.datasetId,meaning)
  await audit('consented')
  try {
   const data=vane?await readVane(env.BIFOCAL_VANE_ORIGIN!,input,grant):await readProductTable(input,grant)
   lineage(data.source)
   const response=await planSource(request,env,input.datasetId,data.rows,data.columns,data.source,input.catchup === true)
   await audit(response.ok?'staged':'refused')
   return response
  } catch(error){await audit('failed');throw error}
 }catch(error){return Response.json({error:error instanceof RangeError?error.code:'analytics_source_conflict'},{status:error instanceof RangeError?error.status:409,headers})}
}
