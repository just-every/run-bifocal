import { integer, object, requireValue, text } from '../company/protocol'
// Owner-entered USD rates avoid implying that a stale card is a live quote.
const items = [
 ['product', 'product fees', 'installation month', 1],
 ['control', 'Cloudflare control plane', 'request', 240000],
 ['compute', 'analytical compute', 'compute hour', 730],
 ['scan', 'analytical scans', 'GB scanned', 6000],
 ['storage', 'analytical storage', 'GB month', 100],
 ['refresh', 'refresh and ingestion', 'GB ingested', 30],
 ['delivery', 'PDF and PPTX delivery', 'recipient burst', 800],
 ['agents', 'external-model and agent infrastructure', 'run', 100],
 ['portal', 'portal capacity', 'tenant month', 1],
] as const
const usd=(value:bigint)=>`${value/1000000n}.${(value%1000000n).toString().padStart(6,'0')}`
export function referenceQuote(value: unknown) {
 const input = object(value, ['rates','quantities','sourceLicencesMicroUsd','compute']), rates = object(input.rates, items.map(item=>item[0]))
 const quantities = input.quantities === undefined ? {} : object(input.quantities, items.map(item=>item[0]))
 const compute=object(input.compute,['provider','size','region'])
 const computeConfiguration={provider:text(compute.provider,'provider',120),size:text(compute.size,'size',120),region:text(compute.region,'region',120)}
 requireValue(Object.keys(rates).length===items.length,'all_rates_required')
 const lines = items.map(([id,label,unit,reference])=>{
  const rate = object(rates[id], ['microUsdPerUnit','rateDate','reference'])
  const price=integer(rate.microUsdPerUnit,'microUsdPerUnit',0,1000000000000)
  const rateDate=text(rate.rateDate,'rateDate',10)
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(rateDate) && !Number.isNaN(Date.parse(`${rateDate}T00:00:00Z`)) && new Date(`${rateDate}T00:00:00Z`).toISOString().slice(0,10)===rateDate,'invalid_rate_date')
  const quantity=quantities[id]===undefined?reference:integer(quantities[id],'quantity',0,1000000000)
  return {id,label,unit,quantity,quantityBasis:'assumed',rateBasis:'owner-entered',rateDate,reference:text(rate.reference,'reference',500),microUsdPerUnit:price,amountMicroUsd:(BigInt(price)*BigInt(quantity)).toString(),amountUsd:usd(BigInt(price)*BigInt(quantity))}
 })
 const total=lines.reduce((sum,line)=>sum+BigInt(line.amountMicroUsd),0n)
 const licences=input.sourceLicencesMicroUsd===undefined?null:integer(input.sourceLicencesMicroUsd,'sourceLicencesMicroUsd',0,1000000000000)
 return {currency:'USD',period:'monthly',compute:computeConfiguration,lines,totalMicroUsd:total.toString(),totalUsd:usd(total),fullComparisonMicroUsd:licences===null?null:(total+BigInt(licences)).toString(),
  workload:{internalReaders:50,sources:['finance','billing','crm','marketing','support','commerce','inventory','people','projects','files'],refreshesPerSourceDaily:24,portalTenants:1,portalReaders:10,retainedGB:100,newGBMonthly:10,dashboards:20,tilesPerDashboard:20,dashboardOpensDaily:100,peakUsers:5,dailyChangeMBPerSource:100,weeklyBurstRuns:4,burstFormats:['PDF','PPTX'],burstRecipients:50,alertEvaluationsDaily:100,agentRunsMonthly:100},
  assumptions:['30-day refresh and scan month; four-week delivery month; 730-hour compute month','Compute size and provider must be specified in the compute rate reference','Compute runs continuously at the entered hourly rate; autoscaling is not assumed','240000 control requests assume four requests per tile read; 6000 GB of scans assumes 0.1 GB per tile per dashboard open over 30 days; neither is measured','Each burst recipient receives both formats in one recipient burst','No source licence or tax is included in the core total'],
  uncertainty:'All quantities are assumptions, not measured usage or a guaranteed bill. Include provider size, region, scan charges and licences in the entered rate references and recompute with the buyer workload.',
  exclusions:['source-vendor licences unless supplied in the optional comparison','tax'],productPricing:'Product fees are a monthly line item; no product charge per prompt or token. External-model infrastructure charges remain separate.',spending:'Quote only; no activation, reservation, provider request or execution occurs.'}
}
