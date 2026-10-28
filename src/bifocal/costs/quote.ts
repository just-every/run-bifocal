import { integer, object, requireValue, text } from '../company/protocol'
import { exactQuantity, quoteWorkload, workloadAssumptions, workloadQuantities } from './workload'
// Owner-entered USD rates avoid implying that a stale card is a live quote.
const items = [
 ['product', 'product fees', 'installation month'],
 ['control', 'Cloudflare control plane', 'request'],
 ['compute', 'analytical compute', 'compute hour'],
 ['scan', 'analytical scans', 'GB scanned'],
 ['storage', 'analytical storage', 'GB month'],
 ['refresh', 'refresh and ingestion', 'GB ingested'],
 ['delivery', 'PDF and PPTX delivery', 'recipient burst'],
 ['agents', 'external-model and agent infrastructure', 'run'],
 ['portal', 'portal capacity', 'tenant month'],
] as const
const usd=(value:bigint)=>`${value/1000000n}.${(value%1000000n).toString().padStart(6,'0')}`
export function referenceQuote(value: unknown) {
 const input = object(value, ['rates','quantities','sourceLicencesMicroUsd','compute','workload']), rates = object(input.rates, items.map(item=>item[0]))
 const quantities = input.quantities === undefined ? {} : object(input.quantities, items.map(item=>item[0]))
 const workload = quoteWorkload(input.workload), derived = workloadQuantities(workload, input.workload !== undefined)
 const compute=object(input.compute,['provider','size','region'])
 const computeConfiguration={provider:text(compute.provider,'provider',120),size:text(compute.size,'size',120),region:text(compute.region,'region',120)}
 requireValue(Object.keys(rates).length===items.length,'all_rates_required')
 const lines = items.map(([id,label,unit])=>{
  const rate = object(rates[id], ['microUsdPerUnit','rateDate','reference'])
  const price=integer(rate.microUsdPerUnit,'microUsdPerUnit',0,1000000000000)
  const rateDate=text(rate.rateDate,'rateDate',10)
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(rateDate) && !Number.isNaN(Date.parse(`${rateDate}T00:00:00Z`)) && new Date(`${rateDate}T00:00:00Z`).toISOString().slice(0,10)===rateDate,'invalid_rate_date')
  const overridden = quantities[id] !== undefined
  const exact = overridden
   ? exactQuantity(BigInt(integer(quantities[id],'quantity',0,1000000000)), 1n, `Owner quantity override replaces the workload-derived ${unit} quantity. Workload formula: ${derived[id].derivation}`)
   : derived[id]
  const numerator = BigInt(price) * exact.numerator
  const amount = (numerator + exact.denominator - 1n) / exact.denominator
  return {id,label,unit,quantity:Number(exact.numerator)/Number(exact.denominator),
   quantityExact:{numerator:exact.numerator.toString(),denominator:exact.denominator.toString()},
   quantityBasis:'assumed',quantitySource:overridden?'override':input.workload===undefined?'reference-workload':'buyer-workload',derivation:exact.derivation,
   rateBasis:'owner-entered',rateDate,reference:text(rate.reference,'reference',500),microUsdPerUnit:price,
   amountMicroUsd:amount.toString(),amountUsd:usd(amount),roundingMicroUsd:numerator%exact.denominator!==0n}
 })
 const total=lines.reduce((sum,line)=>sum+BigInt(line.amountMicroUsd),0n)
 const licences=input.sourceLicencesMicroUsd===undefined?null:integer(input.sourceLicencesMicroUsd,'sourceLicencesMicroUsd',0,1000000000000)
 return {currency:'USD',period:'monthly',compute:computeConfiguration,lines,totalMicroUsd:total.toString(),totalUsd:usd(total),
  fullComparisonMicroUsd:licences===null?null:(total+BigInt(licences)).toString(),fullComparisonUsd:licences===null?null:usd(total+BigInt(licences)),
  sourceLicencesMicroUsd:licences===null?null:licences.toString(),sourceLicencesUsd:licences===null?null:usd(BigInt(licences)),
  workload,assumptions:workloadAssumptions(workload, input.workload !== undefined),
  rounding:'Quantities are exact rational numbers. Each line amount is rounded up only when a fraction of one micro USD remains; the total sums those rounded line amounts. Numeric quantities are for display; quantityExact supplies the authoritative fraction.',
  uncertainty:'All quantities are assumptions, not measured usage or a guaranteed bill. Include provider size, region, scan charges and licences in the entered rate references and recompute with the buyer workload.',
  exclusions:['source-vendor licences unless supplied in the optional comparison','tax'],productPricing:'Product fees are a monthly line item; no product charge per prompt or token. External-model infrastructure charges remain separate.',spending:'Quote only; no activation, reservation, provider request or execution occurs.'}
}
