import { object, providerJson, requireValue } from '../analytics/protocol'
import type { Column } from '../../imports/files/csv'
import type { Lineage } from '../analytics/lineage'

// Supported legacy CRM v3 deal-list and object schema, reviewed 4 November 2026:
// https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/get-deals
export const hubspotReference = 'https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/get-deals'
const endpoint = 'https://api.hubapi.com/crm/v3/objects/0-3'
const properties = ['dealname', 'pipeline', 'dealstage', 'createdate', 'hs_lastmodifieddate', 'closedate', 'amount', 'deal_currency_code']
const fields = ['deal_id', 'deal_name', 'pipeline_id', 'stage_id', 'created_at', 'updated_at', 'created_date', 'modified_date', 'close_date', 'amount_observed', 'currency_observed', 'observed_pipeline_value']
function text(value: unknown): string | null {
 if (value === undefined || value === null) return null
 requireValue(typeof value === 'string' && value.length <= 4096 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'hubspot_invalid_property', 502)
 return value
}
function dated(value: unknown, required = false): string | null {
 const raw = text(value)
 if (!required && (raw === null || raw === '')) return raw
 requireValue(raw !== null && /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z)?$/.test(raw) && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw.slice(0, 10), 'hubspot_invalid_date', 502)
 return raw
}
function amount(value: string | null, currency: string | null): string | null {
 // Missing is unknown, never zero. No account-default currency is inferred.
 requireValue(currency === null || currency === '' || currency === 'USD', 'hubspot_exact_usd_required', 502)
 if (value === null || value === '') return null
 requireValue(currency === 'USD' && /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value), 'hubspot_exact_usd_required', 502)
 const [whole, fraction = ''] = value.replace(/^-/, '').split('.'), cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
 requireValue(cents <= 9007199254740991n, 'hubspot_amount_limit', 502)
 return (value.startsWith('-') && cents !== 0n ? '-' : '') + whole + '.' + fraction.padEnd(2, '0')
}
export async function readHubspot(input: Record<string, unknown>, accessToken: string, currentOwner: () => Promise<void>) {
 requireValue(typeof input.accountContext === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/.test(input.accountContext), 'hubspot_account_context_required')
 const started = new Date().toISOString(), budget = {remainingBytes: 2097152, deadline: Date.now() + 30000}
 const values: (string | null)[][] = [], ids = new Set<string>(), cursors = new Set<string>()
 let after: string | undefined, complete = false, pages = 0
 for (; pages < 20;) {
  requireValue(Date.now() < budget.deadline, 'hubspot_read_deadline', 502)
  await currentOwner()
  const params = new URLSearchParams({limit: '100', archived: 'false', properties: properties.join(','), ...(after ? {after} : {})})
  const result = await providerJson(endpoint + '?' + params, accessToken, undefined, {budget})
  pages++
  requireValue(Object.keys(result).every(k => ['results', 'paging'].includes(k)) && Array.isArray(result.results), 'hubspot_complete_results_required', 502)
  requireValue(result.results.length <= 100 && values.length + result.results.length <= 2000, 'hubspot_row_limit', 413)
  requireValue(pages === 1 || result.results.length > 0, 'hubspot_incomplete_page', 502)
  for (const deal of result.results) {
   requireValue(object(deal) && typeof deal.id === 'string' && /^[1-9]\d{0,39}$/.test(deal.id) && !ids.has(deal.id) && deal.archived === false && object(deal.properties), 'hubspot_invalid_or_duplicate_deal', 502)
   ids.add(deal.id)
   const p = deal.properties, observed = text(p.amount), currency = text(p.deal_currency_code)
   values.push([deal.id, text(p.dealname), text(p.pipeline), text(p.dealstage), dated(deal.createdAt, true), dated(deal.updatedAt, true), dated(p.createdate), dated(p.hs_lastmodifieddate), dated(p.closedate), observed, currency, amount(observed, currency)])
  }
  if (result.paging === undefined) { complete = true; break }
  requireValue(object(result.paging) && Object.keys(result.paging).every(k => k === 'next') && object(result.paging.next), 'hubspot_incomplete_paging', 502)
  const next = result.paging.next
  requireValue(Object.keys(next).every(k => ['after', 'link'].includes(k)) && typeof next.after === 'string' && /^[0-9]{1,100}$/.test(next.after) && !cursors.has(next.after) && result.results.length > 0, 'hubspot_cursor_invalid_or_repeated', 502)
  // The optional provider link is never fetched or retained. Only a bounded
  // opaque numeric cursor can alter the constructed fixed-origin GET above.
  after = next.after; cursors.add(after)
 }
 requireValue(complete, 'hubspot_incomplete_page_limit', 413)
 requireValue(values.length > 0, 'hubspot_empty_read_no_staging', 422)
 await currentOwner()
 // Preserve empty text separately from missing properties through the CSV door.
 let nullValue = '__hubspot_null__'
 while (values.some(row => row.includes(nullValue))) nullValue += '_'
 const rows = [fields, ...values.map(row => row.map(value => value === null ? nullValue : value))]
 const columns = Object.fromEntries(fields.map(name => [name, name === 'observed_pipeline_value' ? 'money' : 'text'])) as Record<string, Column['type']>
 const source: Lineage = {kind: 'hubspot-deals', link: endpoint, description: 'Observed unarchived deal pipeline values, not booked revenue or a transactional snapshot. Missing values remain unknown. Account context is owner-supplied, not verified provider identity.', from: '', to: '', timezone: 'UTC', observedAt: new Date().toISOString(), schema: 'HubSpot legacy CRM v3 deal list and object; reviewed 2026-11-04', accountContext: input.accountContext, observationStartedAt: started, pages}
 return {rows, columns, source, nullValue}
}
