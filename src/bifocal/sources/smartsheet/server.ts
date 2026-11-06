import { runtimeBindings, type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { RangeError } from '../spreadsheets/protocol'
import { boundedText, datasetId, inputBody, requireValue, token } from '../analytics/protocol'
import { readAudit } from '../analytics/audit.server'
import { planSource } from '../analytics/door.server'
import { safeId, selection } from './protocol'
import { readSheet, SmartsheetError } from './read'
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
export async function smartsheetResponse(request: Request, original: Bindings): Promise<Response|null> {
 if (new URL(request.url).pathname !== '/api/operator/smartsheet/preview') return null
 const env = runtimeBindings(original)
 try {
  const owner = request.headers.has('authorization') ? null : await fileOwner(request,env)
  if (!owner) { if (request.body) await boundedText(request.body,32768,'smartsheet_request_limit'); return Response.json({error:'owner_required'},{status:401,headers}) }
  requireValue(request.method === 'POST','method_not_allowed',405)
  const input = await inputBody(request)
  requireValue(Object.keys(input).every(key=>['datasetId','sheetId','columns','accessToken','confirmRead','catchup'].includes(key)) && datasetId(input.datasetId) && safeId(input.sheetId) && input.confirmRead === true && (input.catchup === undefined || typeof input.catchup === 'boolean'), 'smartsheet_explicit_read_required')
  const selected = selection(input.columns), grant = token(input.accessToken), {accessToken,...meaning} = input
  requireValue(!JSON.stringify(meaning).includes(grant), 'credential_in_source')
  const audit = readAudit(env,owner,input.datasetId,meaning)
  const authorize = async () => { requireValue((await fileOwner(request,env))?.email === owner.email,'owner_required',401) }
  await audit('consented')
  try {
   const data = await readSheet(input.sheetId,selected,grant,authorize)
   await authorize()
   const response = await planSource(request,env,input.datasetId,data.rows,data.columns,undefined,input.catchup === true,{smartsheet:data.snapshot,nullValue:data.nullValue,key:'smartsheet_row_id'})
   await audit(response.ok ? 'staged' : 'refused')
   return response
  } catch (error) {
   // Revocation also withdraws audit-write authority. Preserve the refusal
   // without using the retired session to append another event.
   await audit('failed').catch(() => {})
   throw error
  }
 } catch (error) {
  return Response.json({error:error instanceof RangeError ? error.code : 'smartsheet_source_conflict',...(error instanceof SmartsheetError ? {details:error.details,reason:`Smartsheet column ${error.details.columnId}${error.details.rowId ? ' in row '+error.details.rowId : ''} (${error.details.sourceType ?? 'unknown type'}) cannot use the selected native mapping. Choose a supported scalar column or correct the mapping.`} : {})},{status:error instanceof RangeError ? error.status : 409,headers})
 }
}
