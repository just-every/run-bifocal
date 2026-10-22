import { runtimeBindings, type Bindings } from '../../../auth.server'
import { fileOwner } from '../../imports/files/owner.server'
import { boundedText, rangeInput, RangeError } from './protocol'
import { readProvider } from './provider'
import { planRange } from './door.server'
import { readConsent, consentHistory } from './consent.server'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' }
const json = (error: string, status: number) => Response.json({ error }, { status, headers })

/** Mount before fileImportResponse. Each POST authorizes exactly one bounded
 * provider GET and stages a shared-door preview; it never applies a plan. */
export async function spreadsheetRangeResponse(request: Request, original: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (!['/api/operator/spreadsheets/preview','/api/operator/spreadsheets/reads'].includes(path)) return null
 try {
  const env = runtimeBindings(original), owner = await fileOwner(request, env)
  if (!owner) {
   // Finish bounded denied bodies without parsing or retaining their grant.
   if (request.body) await boundedText(request.body, 32768, 'spreadsheet_request_limit')
   return json('owner_required', 401)
  }
  if (path.endsWith('/reads')) {
   if (request.method !== 'GET') return json('method_not_allowed',405)
   return Response.json(await consentHistory(env,owner),{headers})
  }
  if (request.method !== 'POST') return json('method_not_allowed', 405)
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json('spreadsheet_json_required', 415)
  let value: unknown
  const text = await boundedText(request.body, 32768, 'spreadsheet_request_limit')
  try { value = JSON.parse(text) } catch { return json('spreadsheet_invalid_request', 400) }
  const input = rangeInput(value)
  // A current-session SQL fence precedes the only external request. Every
  // synthetic upload and plan rechecks the native owner through the same door.
  const record = readConsent(env,owner,input)
  await record('consented')
  let data
  try { data = await readProvider(input) } catch (error) { await record('failed'); throw error }
  input.accessToken = ''
  const response = await planRange(request,env,input,data)
  await record(response.ok ? 'staged' : 'refused')
  return response
 } catch (error) {
  if (error instanceof RangeError) return json(error.code, error.status)
  // No provider error body, grant, URL, submitted cell or internal exception
  // is serialized or logged, including fetch and database failure paths.
  return json('spreadsheet_preview_failed', 409)
 }
}
