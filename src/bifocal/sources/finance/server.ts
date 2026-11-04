import { runtimeBindings, type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { RangeError } from '../spreadsheets/protocol'
import { boundedText, datasetId, inputBody, requireValue, token } from '../analytics/protocol'
import { readAudit } from '../analytics/audit.server'
import { planSource } from '../analytics/door.server'
import { lineage } from '../analytics/lineage'
import { readStripe, stripeWindow } from './stripe'
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
export async function financeSourceResponse(request:Request,original:Bindings):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/operator/analytics/stripe/preview')return null
 const env=runtimeBindings(original)
 try {
  // Machine bearers never borrow native owner cookies for provider acquisition.
  const owner=request.headers.has('authorization')?null:await fileOwner(request,env)
  if(!owner){if(request.body)await boundedText(request.body,32768,'analytics_request_limit');return Response.json({error:'owner_required'},{status:401,headers})}
  requireValue(request.method==='POST' && !new URL(request.url).search,'method_not_allowed',405)
  const input=await inputBody(request)
  requireValue(Object.keys(input).every(k=>['datasetId','from','to','accountContext','accessToken','confirmRead','catchup'].includes(k)),'unsupported_source_field')
  requireValue(datasetId(input.datasetId) && input.confirmRead===true && (input.catchup===undefined || typeof input.catchup==='boolean'),'explicit_source_read_required')
  stripeWindow(input)
  const grant=token(input.accessToken),{accessToken,...meaning}=input
  requireValue(!JSON.stringify(meaning).includes(grant),'credential_in_source')
  const audit=readAudit(env,owner,input.datasetId,{provider:'stripe',...meaning})
  await audit('consented')
  try {
   const data=await readStripe(input,grant)
   lineage(data.source)
   const response=await planSource(request,env,input.datasetId,data.rows,data.columns,data.source,input.catchup===true,{key:'transaction_id'})
   await audit(response.ok?'staged':'refused')
   return response
  } catch(error){await audit('failed');throw error}
 } catch(error){return Response.json({error:error instanceof RangeError?error.code:'finance_source_conflict'},{status:error instanceof RangeError?error.status:409,headers})}
}
