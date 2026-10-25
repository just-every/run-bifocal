import type { DemoDoor } from './door'

export async function seedRetailAnswers(call: DemoDoor) {
 if ((await call('/api/operator/library/search?tag=demo')).items.length) return
 if (!await call('/api/operator/calendars/demo-retail-calendar/1')) await call('/api/operator/calendars', { id: 'demo-retail-calendar', previousVersion: null,
  definition: { name: 'Demo retail calendar', kind: 'fiscal', startMonth: 1 } })
 const context = { modelVersion: 'demo-retail-v1', metricVersion: 'demo-retail-v1', accountingBasis: 'accrual',
  calendar: { id: 'demo-retail-calendar', version: 1 }, rounding: 'half-even' }
 const answer = await call('/api/operator/queries/run', { version: 1, dataset: 'demo-orders', joins: [], filters: [],
  groupBy: ['month'], measures: [
   { id: 'revenue', op: 'sum', column: 'revenue', unit: 'money', scale: 2, sourceCurrency: 'USD' },
   { id: 'orders', op: 'count', unit: 'count', scale: 0 },
   { id: 'refunds', op: 'sum', column: 'refunded', unit: 'money', scale: 2, sourceCurrency: 'USD' },
   { id: 'margin', op: 'ratio', numerator: 'profit', denominator: 'revenue', unit: 'percent', scale: 2, sourceCurrency: 'USD' },
  ], context })
 const title = 'Cedar & Finch Demo · January–June 2026'
 const dashboard = await call('/api/operator/dashboards', { queryId: answer.queryId, title })
 await call('/api/operator/library/items', { kind: 'dashboard', title,
  description: 'Fictional homeware retailer: 300 orders, 32 customers, 12 products and 23 returns. Net revenue is after discounts and refunds; profit assumes returned goods are restocked.',
  tags: ['demo', 'retail'], definition: { dashboardId: dashboard.id },
  sourceLinks: ['/app/dashboards/' + dashboard.id], verified: false, collectionId: null,
  sourceDatasets: ['demo-orders', 'demo-customers', 'demo-products', 'demo-returns'] })
}
