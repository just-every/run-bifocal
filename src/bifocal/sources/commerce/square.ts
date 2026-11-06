import { object, providerJson, requireValue } from '../analytics/protocol'
import type { Column } from '../../imports/files/csv'
import type { Lineage } from '../analytics/lineage'

// Official SearchOrders, Order, OrderMoneyAmounts and Money schemas, dated
// 2026-09-16: https://developer.squareup.com/reference/square/orders-api/search-orders
export const squareVersion = '2026-09-16'
const origins = { production: 'https://connect.squareup.com', sandbox: 'https://connect.squareupsandbox.com' } as const
const components = ['total', 'tax', 'discount', 'tip', 'service_charge'] as const
const amounts = ['order_total', 'order_tax', 'order_discount', 'order_tip', 'order_service_charge', ...components.map(k => 'return_' + k), ...components.map(k => 'net_' + k)]
const fields = ['order_id', 'location_id', 'environment', 'state', 'created_at', 'updated_at', 'closed_at', 'version', ...amounts]
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,192}$/.test(value)
const day = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
function timestamp(value: unknown, required = false): string {
 if (value === undefined && !required) return ''
 requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && day(value.slice(0, 10)) && Number.isFinite(Date.parse(value)), 'square_invalid_timestamp', 502)
 return value
}
function money(value: unknown): string {
 if (value === undefined) return '' // Unknown is never zero, including absent rollups.
 requireValue(object(value) && value.currency === 'USD' && typeof value.amount === 'number' && Number.isSafeInteger(value.amount), 'square_exact_usd_required', 502)
 const cents = BigInt(value.amount), absolute = cents < 0n ? -cents : cents
 return (cents < 0n ? '-' : '') + (absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0')
}
function rollup(value: unknown): string[] {
 if (value === undefined) return components.map(() => '')
 requireValue(object(value), 'square_invalid_rollup', 502)
 return components.map(k => money(value[k + '_money']))
}
export async function readSquare(input: Record<string, unknown>, accessToken: string, currentOwner: () => Promise<void>) {
 requireValue(input.environment === 'production' || input.environment === 'sandbox', 'square_environment_required')
 requireValue(identifier(input.locationId), 'square_location_required')
 requireValue(day(input.from) && day(input.to) && input.from < input.to, 'square_exclusive_utc_window_required')
 const environment = input.environment, location = input.locationId
 // Fixed reviewed semantics; no caller-supplied URL, method, fields or query.
 const query = {filter: {date_time_filter: {created_at: {start_at: input.from + 'T00:00:00Z', end_at: input.to + 'T00:00:00Z'}}}, sort: {sort_field: 'CREATED_AT', sort_order: 'ASC'}}
 const fixed = {location_ids: [location], return_entries: false, limit: 500, query}
 const budget = {remainingBytes: 2097152, deadline: Date.now() + 30000}
 const rows: string[][] = [fields], ids = new Set<string>(), cursors = new Set<string>()
 let cursor: string | undefined, complete = false
 for (let page = 0; page < 10; page++) {
  requireValue(Date.now() < budget.deadline, 'square_read_deadline', 502)
  await currentOwner()
  const result = await providerJson(origins[environment] + '/v2/orders/search', accessToken, {...fixed, ...(cursor ? {cursor} : {})}, {headers: {'Square-Version': squareVersion}, budget})
  requireValue(result.errors === undefined || Array.isArray(result.errors) && result.errors.length === 0, 'square_provider_errors', 502)
  requireValue(result.order_entries === undefined && (result.orders === undefined || Array.isArray(result.orders)), 'square_orders_required', 502)
  const orders = (result.orders ?? []) as unknown[]
  requireValue(page === 0 || orders.length > 0, 'square_incomplete_page', 502)
  requireValue(orders.length <= fixed.limit && rows.length - 1 + orders.length <= 2000, 'square_row_limit', 413)
  for (const order of orders) {
   requireValue(object(order) && identifier(order.id) && order.location_id === location && !ids.has(order.id), 'square_foreign_or_duplicate_order', 502)
   ids.add(order.id)
   requireValue(['OPEN', 'COMPLETED', 'CANCELED', 'DRAFT'].includes(String(order.state)), 'square_order_state_required', 502)
   const created = timestamp(order.created_at, true)
   requireValue(Date.parse(created) >= Date.parse(input.from) && Date.parse(created) < Date.parse(input.to), 'square_order_outside_window', 502)
   requireValue(order.version === undefined || typeof order.version === 'number' && Number.isSafeInteger(order.version) && order.version >= 0 && order.version <= 2147483647, 'square_invalid_version', 502)
   // Never flatten line items, tenders, customers, fulfillments or metadata.
   rows.push([order.id, location, environment, String(order.state), created, timestamp(order.updated_at), timestamp(order.closed_at), order.version === undefined ? '' : String(order.version), ...components.map(k => money(order[k === 'total' ? 'total_money' : 'total_' + k + '_money'])), ...rollup(order.return_amounts), ...rollup(order.net_amounts)])
  }
  if (result.cursor === undefined) { complete = true; break }
  requireValue(typeof result.cursor === 'string' && result.cursor.length > 0 && result.cursor.length <= 2048 && !/[\x00-\x1f\x7f]/.test(result.cursor) && !cursors.has(result.cursor), 'square_cursor_invalid_or_repeated', 502)
  requireValue(orders.length > 0, 'square_incomplete_page', 502)
  cursor = result.cursor; cursors.add(cursor)
 }
 requireValue(complete, 'square_incomplete_page_limit', 413)
 requireValue(rows.length > 1, 'square_empty_read_no_staging', 422)
 const columns = Object.fromEntries(fields.map(name => [name, amounts.includes(name) ? 'money' : name === 'version' ? 'number' : 'text'])) as Record<string, Column['type']>
 const source: Lineage = {kind: 'square-orders', link: origins[environment] + '/v2/orders/search', description: 'Square order summaries, not payments. Offline orders may arrive up to 72 hours late with server creation time. No transactional multi-page snapshot; absent amounts and versions are unknown.', from: input.from, to: input.to, timezone: 'UTC', observedAt: new Date().toISOString(), schema: 'Square ' + squareVersion + ' SearchOrders; Order; Money; OrderMoneyAmounts'}
 return {rows, columns, source}
}
