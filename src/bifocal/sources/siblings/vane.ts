import { object, publicOrigin, providerJson, requireValue } from '../analytics/protocol'
import type { Lineage } from '../analytics/lineage'
/** Vane Stats v1, pinned schema documented in ANALYTICS-HANDOFFS.md.
 * Conversion visits and attributed revenue never become ledger revenue. */
export async function readVane(origin: string, input: Record<string,unknown>, accessToken: string) {
 origin=publicOrigin(origin)
 requireValue(typeof input.siteId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.siteId),'vane_site_required')
 requireValue(typeof input.from === 'string' && typeof input.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.from) && /^\d{4}-\d{2}-\d{2}$/.test(input.to) && input.from < input.to,'vane_exclusive_date_window_required')
 const params=new URLSearchParams({site_id:input.siteId,from:input.from,to:input.to,dimension:'utm_campaign',metrics:'visitors,visits',imported:'on'})
 const body=await providerJson(origin+'/api/v1/stats?'+params,accessToken)
 requireValue(body.site_id === input.siteId && body.from === input.from && body.to === input.to && body.dimension === 'utm_campaign' && typeof body.time_zone === 'string' && Array.isArray(body.breakdown) && body.breakdown.length > 0 && body.breakdown.length <= 2000,'vane_schema_mismatch',502)
 const rows=[['campaign','visitors','visits','conversions','conversion_rate','attributed_revenue','currency']]
 const seen=new Set<string>()
 for(const item of body.breakdown) {
  requireValue(object(item) && typeof item.value === 'string' && item.value.length <= 4096 && !seen.has(item.value),'vane_schema_mismatch',502)
  seen.add(item.value)
  const count=(value:unknown) => { requireValue(Number.isSafeInteger(value) && Number(value) >= 0,'vane_invalid_count',502); return String(value) }
  const nullable=(value:unknown) => {requireValue(value === null || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER,'vane_invalid_number',502); return value === null ? '' : String(value)}
  requireValue(item.currency === null || typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency),'vane_invalid_currency',502)
  rows.push([item.value,count(item.visitors),count(item.visits),count(item.conversions),nullable(item.conversionRate),nullable(item.revenue),String(item.currency ?? '')])
 }
 const source:Lineage={kind:'vane-api',link:origin+'/app/sites/'+encodeURIComponent(input.siteId)+'?'+new URLSearchParams({section:'report',from:input.from,to:input.to})+'#sources',description:'Vane UTM campaigns: conversions are visits with a goal; attributed revenue is not ledger revenue.',from:input.from,to:input.to,timezone:body.time_zone,observedAt:new Date().toISOString(),schema:'run-vane Stats v1 @ 8549e6e129e1725d8e85d8d25ca3814831f204da'}
 return {rows,columns:{campaign:'text',visitors:'number',visits:'number',conversions:'number',conversion_rate:'number',attributed_revenue:'number',currency:'text'} as const,source}
}
