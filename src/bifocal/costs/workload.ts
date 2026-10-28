import { integer, object, requireValue, text } from '../company/protocol'

const numericFields = [
 'internalReaders', 'refreshesPerSourceDaily', 'portalTenants', 'portalReaders',
 'retainedGB', 'newGBMonthly', 'dashboards', 'tilesPerDashboard', 'dashboardOpensDaily',
 'peakUsers', 'dailyChangeMBPerSource', 'weeklyBurstRuns', 'burstRecipients',
 'alertEvaluationsDaily', 'agentRunsMonthly',
] as const
type NumericField = typeof numericFields[number]
export type Workload = Record<NumericField, number> & { sources: string[]; burstFormats: string[] }
export type Quantity = { numerator: bigint; denominator: bigint; derivation: string }

export const referenceWorkload: Workload = {
 internalReaders:50, sources:['finance','billing','crm','marketing','support','commerce','inventory','people','projects','files'],
 refreshesPerSourceDaily:24, portalTenants:1, portalReaders:10, retainedGB:100, newGBMonthly:10,
 dashboards:20, tilesPerDashboard:20, dashboardOpensDaily:100, peakUsers:5, dailyChangeMBPerSource:100,
 weeklyBurstRuns:4, burstFormats:['PDF','PPTX'], burstRecipients:50, alertEvaluationsDaily:100, agentRunsMonthly:100,
}

export function quoteWorkload(value: unknown): Workload {
 const workload = {...referenceWorkload, sources:[...referenceWorkload.sources], burstFormats:[...referenceWorkload.burstFormats]}
 if (value === undefined) return workload
 const input = object(value, ['sources', ...numericFields])
 for (const field of numericFields) {
  if (input[field] !== undefined) workload[field] = integer(input[field], field, 0, 1000000000)
 }
 if (input.sources !== undefined) {
  requireValue(Array.isArray(input.sources) && input.sources.length <= 1000, 'invalid_sources', { max:1000 })
  const sources = input.sources.map(source => text(source, 'source', 120))
  requireValue(new Set(sources.map(source => source.toLowerCase())).size === sources.length, 'duplicate_source_name')
  workload.sources = sources
 }
 return workload
}

export function exactQuantity(numerator: bigint, denominator: bigint, derivation: string): Quantity {
 let a = numerator, b = denominator
 while (b !== 0n) { const remainder = a % b; a = b; b = remainder }
 return { numerator:numerator / a, denominator:denominator / a, derivation }
}

export function workloadQuantities(workload: Workload, includeWorkflowOverhead: boolean) {
 const w = workload, opens = BigInt(w.dashboardOpensDaily), tiles = BigInt(w.tilesPerDashboard)
 const refreshes = BigInt(w.sources.length) * BigInt(w.refreshesPerSourceDaily) * 30n
 const alerts = BigInt(w.alertEvaluationsDaily) * 30n
 const bursts = BigInt(w.weeklyBurstRuns) * 4n * BigInt(w.burstRecipients)
 const overhead = includeWorkflowOverhead ? refreshes + alerts + BigInt(w.agentRunsMonthly) + bursts : 0n
 return {
  product:exactQuantity(1n, 1n, 'One installation month at the entered monthly product fee.'),
  control:exactQuantity(opens * tiles * 30n * 4n + overhead, 1n,
   `${w.dashboardOpensDaily} estate-wide dashboard opens daily × ${w.tilesPerDashboard} tiles × 30 days × 4 assumed control requests per tile read.`
   + (includeWorkflowOverhead
    ? ` Add one assumed control request for each of ${refreshes} monthly source refreshes, ${alerts} monthly alert evaluations, ${w.agentRunsMonthly} monthly agent runs and ${bursts} monthly combined-format recipient bursts.`
    : ' Legacy requests without a workload retain the original dashboard-only request estimate; provide workload to include refresh, alert, agent and delivery overhead.')),
  compute:exactQuantity(730n, 1n, '730 hours of continuous analytical compute at the entered provider, size and region; no autoscaling adjustment.'),
  scan:exactQuantity(opens * tiles * 30n + (includeWorkflowOverhead ? alerts : 0n), 10n,
   `${w.dashboardOpensDaily} estate-wide dashboard opens daily × ${w.tilesPerDashboard} tiles × 30 days × 0.1 assumed GB scanned per tile read.`
   + (includeWorkflowOverhead
    ? ` Add ${w.alertEvaluationsDaily} daily alert evaluations × 30 days × 0.1 assumed GB scanned per evaluation.`
    : ' Legacy requests without a workload retain the original dashboard-only scan estimate; provide workload to include alert scans.')),
  storage:exactQuantity(BigInt(w.retainedGB), 1n,
   `${w.retainedGB} GB retained for one month. The ${w.newGBMonthly} GB monthly new-data assumption is separate future storage growth, not additional current storage or refresh bytes.`),
  refresh:exactQuantity(BigInt(w.sources.length) * BigInt(w.refreshesPerSourceDaily) * BigInt(w.dailyChangeMBPerSource) * 30n, 24000n,
   `${w.sources.length} named sources × ${w.refreshesPerSourceDaily} refreshes per source daily ÷ 24 reference refreshes × ${w.dailyChangeMBPerSource} MB daily change per source ÷ 1000 MB per GB × 30 days. This assumes ingestion scales with refresh frequency; it is not measured transfer volume.`),
  delivery:exactQuantity(bursts, 1n,
   `${w.weeklyBurstRuns} burst runs weekly × 4 weeks × ${w.burstRecipients} recipients. Each recipient burst includes both PDF and PPTX once.`),
  agents:exactQuantity(BigInt(w.agentRunsMonthly), 1n,
   `${w.agentRunsMonthly} bounded analyst-agent runs monthly at the entered external infrastructure rate per run; product fees do not meter prompts or tokens.`),
  portal:exactQuantity(BigInt(w.portalTenants), 1n,
   `${w.portalTenants} portal tenants for one month at the entered capacity rate; reader counts and capacity require separate provider qualification.`),
 }
}

export function workloadAssumptions(workload: Workload, includeWorkflowOverhead: boolean): string[] {
 const w = workload
 return [
  '30-day refresh and scan month; four-week delivery month; 730-hour compute month',
  'Compute size and provider must be specified in the compute rate reference',
  'Compute runs continuously at the entered hourly rate; autoscaling is not assumed',
  'Control requests assume four requests per tile read; scans assume 0.1 GB per tile read; neither is measured',
  includeWorkflowOverhead
   ? 'Workload quotes also assume one control request per source refresh, alert evaluation, agent run and combined-format recipient burst, plus 0.1 GB scanned per alert evaluation'
   : 'Legacy requests without workload retain dashboard-only control and scan quantities for compatibility; provide workload to include refresh, alert, agent and delivery request overhead and alert scans',
  'Dashboard opens are the daily total across the estate, not opens per dashboard; the dashboard inventory is not multiplied into opens',
  'Each burst recipient receives both formats in one recipient burst',
  `${w.internalReaders} internal readers, ${w.portalReaders} portal readers per tenant and ${w.peakUsers} peak users are workload and capacity assumptions, not measured usage, validated capacity or extra metered lines`,
  `${w.dashboards} dashboards describe the inventory. Continuous compute covers the assumed refresh, delivery, alert and agent orchestration; provider-specific extra analytical scans require owner quantity overrides`,
  `${w.newGBMonthly} GB of monthly new data describes storage growth separately from the daily source change sets. Current storage charges use ${w.retainedGB} retained GB only; update retained storage for a future month`,
  'Refresh volume scales the daily change set by refresh frequency relative to 24 daily refreshes; repeated reads and source behavior require provider validation',
  'Owner rates must cover the declared workload and capacity; query performance, portal-reader capacity, provider invoices and the seven-day measured estimate comparison remain unverified',
  'No source licence or tax is included in the core total',
 ]
}
