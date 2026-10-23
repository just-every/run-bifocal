import { boundedText, object, RangeError } from '../spreadsheets/protocol'
export { object, boundedText }
export class AnalyticsError extends RangeError {}
export const requireValue: (condition: unknown, code: string, status?: number) => asserts condition = (condition, code, status = 400) => { if (!condition) throw new AnalyticsError(code, status) }
export const datasetId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)
export function token(value: unknown): string {
 requireValue(typeof value === 'string' && /^[A-Za-z0-9._~+\/-]{12,8192}={0,2}$/.test(value), 'fresh_access_token_required')
 return value
}
export function publicOrigin(value: unknown): string {
 requireValue(typeof value === 'string' && value.length <= 253, 'public_https_origin_required')
 let url: URL
 try { url = new URL(value) } catch { throw new AnalyticsError('public_https_origin_required') }
 requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) && !/\.(?:localhost|local|internal|test|invalid)$/i.test(url.hostname), 'public_https_origin_required')
 return url.origin
}
export async function inputBody(request: Request): Promise<Record<string, unknown>> {
 requireValue(/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''), 'json_body_required', 415)
 let value: unknown
 try { value = JSON.parse(await boundedText(request.body, 32768, 'analytics_request_limit')) } catch(error) { if(error instanceof RangeError) throw error; throw new AnalyticsError('invalid_json') }
 requireValue(object(value), 'json_object_required')
 return value
}
/** Every destination is constructed from validated identifiers. No redirects,
 * native cookies, ambient grants, retries, provider error bodies or logging. */
export async function providerJson(url: string, accessToken: string, data?: unknown): Promise<Record<string, unknown>> {
 const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000)
 try {
  const response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', ...(data === undefined ? {} : {'content-type':'application/json'}) }, ...(data === undefined ? {} : {body:JSON.stringify(data)}), redirect:'manual', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal })
  if (response.status !== 200) {
   await response.body?.cancel()
   throw new AnalyticsError([401,403].includes(response.status) ? 'provider_grant_refused' : response.status === 429 ? 'provider_rate_limited' : response.status >= 300 && response.status < 400 ? 'provider_redirect_refused' : 'provider_request_failed', response.status === 429 ? 503 : [401,403].includes(response.status) ? 403 : 502)
  }
  requireValue(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''), 'provider_json_required', 502)
  const text = await boundedText(response.body, 1048576, 'provider_response_limit')
  const result: unknown = JSON.parse(text)
  requireValue(!text.includes(accessToken) && !JSON.stringify(result).includes(accessToken), 'provider_credential_in_response', 502)
  requireValue(object(result), 'provider_schema_mismatch', 502)
  return result
 } catch(error) {
  if(error instanceof RangeError) throw error
  throw new AnalyticsError(controller.signal.aborted ? 'provider_timeout' : 'provider_response_unavailable', 502)
 } finally { clearTimeout(timeout) }
}
