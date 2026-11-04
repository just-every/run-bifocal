import { runtimeBindings, type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { transact } from '../../../modules/import-kit/src/door/store.ts'
import { RangeError } from '../spreadsheets/protocol'
import { boundedText, inputBody, requireValue, token } from '../analytics/protocol'
import { readAudit } from '../analytics/audit.server'
import { browseBigQuery } from './bigquery-catalog'
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
export async function bigQueryCatalogResponse(request: Request, original: Bindings): Promise<Response | null> {
 if (new URL(request.url).pathname !== '/api/operator/analytics/bigquery/catalog') return null
 const env = runtimeBindings(original)
 try {
  // Bearers never borrow an accompanying human cookie for this owner door.
  const owner = request.headers.has('authorization') ? null : await fileOwner(request, env)
  if (!owner) { if(request.body) await boundedText(request.body,32768,'analytics_request_limit'); return Response.json({error:'owner_required'}, {status:401,headers}) }
  requireValue(request.method === 'POST', 'method_not_allowed', 405)
  const input = await inputBody(request)
  requireValue(Object.keys(input).every(key => ['action','project','dataset','table','accessToken','confirmBrowse'].includes(key)), 'unsupported_catalog_field')
  requireValue(input.confirmBrowse === true, 'explicit_catalog_consent_required')
  const grant = token(input.accessToken), {accessToken, ...meaning} = input
  requireValue(!JSON.stringify(meaning).includes(grant), 'credential_in_source')
  const audit = readAudit(env, owner, 'bigquery-catalog', meaning)
  await audit('consented')
  try {
   const result = await browseBigQuery(input, grant, () => transact(env.DB, owner, []))
   // Recheck the exact session and membership after the bounded network operation.
   await transact(env.DB, owner, [])
   return Response.json(result, {headers})
  } catch (error) { await audit('failed'); throw error }
 } catch (error) {
  return Response.json({error:error instanceof RangeError ? error.code : 'bigquery_catalog_unavailable'}, {status:error instanceof RangeError ? error.status : 409,headers})
 }
}
