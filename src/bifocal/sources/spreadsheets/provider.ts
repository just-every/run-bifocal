import { boundedText, RangeError, type RangeInput, type RangeData } from './protocol'
import { googleEndpoint, googleData } from './google'
import { microsoftEndpoint, microsoftData } from './microsoft'

/** Only these constructed HTTPS GETs receive the ephemeral grant. No cookies,
 * refresh, redirect, provider session creation, writes or arbitrary URLs. */
export async function readProvider(input: RangeInput): Promise<RangeData> {
 const url = input.provider === 'google' ? googleEndpoint(input) : microsoftEndpoint(input)
 const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000)
 try {
  const response = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json', 'cache-control': 'no-store' }, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
  if (response.status !== 200) {
   await response.body?.cancel()
   if ([401,403].includes(response.status)) throw new RangeError('spreadsheet_grant_revoked', 403)
   if (response.status >= 300 && response.status < 400) throw new RangeError('spreadsheet_redirect_refused', 502)
   if (response.status === 429) throw new RangeError('spreadsheet_provider_rate_limited', 503)
   throw new RangeError('spreadsheet_provider_failed', 502)
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new RangeError('spreadsheet_provider_malformed', 502) }
  if (Number(response.headers.get('content-length') ?? 0) > 1048576) { await response.body?.cancel(); throw new RangeError('spreadsheet_response_limit', 413) }
  const text = await boundedText(response.body, 1048576, 'spreadsheet_response_limit')
  if (text.includes(input.accessToken)) throw new RangeError('spreadsheet_credential_in_source', 502)
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new RangeError('spreadsheet_provider_malformed', 502) }
  if (JSON.stringify(body).includes(input.accessToken)) throw new RangeError('spreadsheet_credential_in_source', 502)
  return input.provider === 'google' ? googleData(body, input) : microsoftData(body, input)
 } catch (error) {
  if (error instanceof RangeError) throw error
  throw new RangeError(controller.signal.aborted ? 'spreadsheet_provider_timeout' : 'spreadsheet_provider_failed', 502)
 } finally { clearTimeout(timeout) }
}
