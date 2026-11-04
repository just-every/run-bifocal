import { transact } from '../../../modules/import-kit/src/door/store.ts'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { RangeError } from '../spreadsheets/protocol'
import { boundedText, datasetId, inputBody, requireValue, token } from '../analytics/protocol'
import { planSource } from '../analytics/door.server'
import { readAudit } from '../analytics/audit.server'
import { lineage } from '../analytics/lineage'
import { readSquare } from './square'
const headers = {'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; sandbox"}
export async function commerceSourceResponse(request: Request, original: Bindings): Promise<Response | null> {
 if (new URL(request.url).pathname !== '/api/operator/analytics/square/preview') return null
 const env = runtimeBindings(original)
 try {
  const owner = !request.headers.has('authorization') && await fileOwner(request, env)
  if (!owner) { if (request.body) await boundedText(request.body, 32768, 'analytics_request_limit'); return Response.json({error: 'owner_required'}, {status: 401, headers}) }
  requireValue(request.method === 'POST', 'method_not_allowed', 405)
  const input = await inputBody(request)
  requireValue(Object.keys(input).every(k => ['datasetId', 'locationId', 'environment', 'from', 'to', 'accessToken', 'confirmRead', 'catchup'].includes(k)), 'unsupported_source_field')
  requireValue(datasetId(input.datasetId) && input.confirmRead === true && (input.catchup === undefined || typeof input.catchup === 'boolean'), 'explicit_source_read_required')
  const grant = token(input.accessToken), {accessToken, ...meaning} = input
  requireValue(!JSON.stringify(meaning).includes(grant), 'credential_in_source')
  const audit = readAudit(env, owner, input.datasetId, {provider: 'square', ...meaning})
  await audit('consented')
  try {
   const data = await readSquare(input, grant, () => transact(env.DB, owner, []))
   lineage(data.source)
   const response = await planSource(request, env, input.datasetId, data.rows, data.columns, data.source, input.catchup === true, {key: 'order_id'})
   await audit(response.ok ? 'staged' : 'refused')
   return response
  } catch (error) { await audit('failed'); throw error }
 } catch (error) { return Response.json({error: error instanceof RangeError ? error.code : 'commerce_source_conflict'}, {status: error instanceof RangeError ? error.status : 409, headers}) }
}
