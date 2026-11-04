import { AnalyticsError, object, providerJson, requireValue } from '../analytics/protocol'
import type { Lineage } from '../analytics/lineage'

// The official list and object schemas are cited in ./STRIPE.md. Only the
// balance movement projection is retained; provider metadata stays outside custody.
export const STRIPE_VERSION='2026-10-28.endive'
export const STRIPE_LIMITS={pages:20,rows:2000,bytes:2097152,deadlineMs:15000,pageRows:100} as const
const endpoint='https://api.stripe.com/v1/balance_transactions'
const reference=(value:unknown):value is string=>typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
const int=(value:unknown):value is number=>typeof value === 'number' && Number.isSafeInteger(value)
const day=(value:unknown):value is string=>typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value && value>='1000-01-01'
export function stripeWindow(input:Record<string,unknown>) {
 requireValue(day(input.from) && day(input.to) && input.from<input.to,'stripe_utc_interval_required')
 requireValue(typeof input.accountContext === 'string' && /^[A-Za-z0-9 _.-]{1,64}$/.test(input.accountContext) && input.accountContext.trim()===input.accountContext,'stripe_account_context_required')
 return {from:input.from,to:input.to,accountContext:input.accountContext,start:Date.parse(input.from)/1000,end:Date.parse(input.to)/1000}
}
/** Inspect numeric lexemes before JSON.parse can round them. Escaped JSON keys
 * are decoded too. Decimal or exponential monetary or timestamp integers are
 * refused, even when binary rounding would turn them into safe integers. */
function exactIntegers(text:string) {
 const tokens=text.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]|true|false|null/g) ?? []
 for(let i=0;i<tokens.length-2;i++)if(tokens[i].startsWith('"') && tokens[i+1] === ':' && ['amount','fee','net','created','available_on'].includes(JSON.parse(tokens[i]))) {
  const value=tokens[i+2]
  requireValue(/^-?(?:0|[1-9]\d*)$/.test(value) && BigInt(value)>=-9007199254740991n && BigInt(value)<=9007199254740991n,'stripe_unsafe_integer',502)
 }
}
const dollars=(cents:number)=>{
 const value=BigInt(cents),absolute=value<0n?-value:value
 return `${value<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`
}
const timestamp=(value:unknown)=>{
 requireValue(int(value) && value>=-30610224000 && value<=253402300799,'stripe_invalid_timestamp',502)
 return new Date(value*1000).toISOString()
}
const csvDate=(iso:string)=>iso.slice(5,7)+'/'+iso.slice(8,10)+'/'+iso.slice(0,4)
export async function readStripe(input:Record<string,unknown>,accessToken:string) {
 const window=stripeWindow(input),observedAt=new Date().toISOString(),deadline=Date.now()+STRIPE_LIMITS.deadlineMs
 const columns={transaction_id:'text',account_context:'text',created_at:'text',available_at:'text',created_on:'date',available_on:'date',currency:'text',type:'text',status:'text',source:'text',amount:'money',fee:'money',net:'money'} as const
 const rows:string[][]=[Object.keys(columns)],seen=new Set<string>();let after:string|undefined,pages=0,bytes=0,lastCreated=window.end
 for(;;) {
  requireValue(pages<STRIPE_LIMITS.pages,'stripe_page_limit',413)
  const params=new URLSearchParams({limit:String(STRIPE_LIMITS.pageRows),'created[gte]':String(window.start),'created[lt]':String(window.end),...(after?{starting_after:after}:{})})
  const body=await providerJson(endpoint+'?'+params,accessToken,undefined,{deadline,bytes:STRIPE_LIMITS.bytes-bytes,headers:{'Stripe-Version':STRIPE_VERSION},inspect:text=>{bytes+=new TextEncoder().encode(text).byteLength;exactIntegers(text)}})
  pages++
  requireValue(body.object==='list' && body.url==='/v1/balance_transactions' && typeof body.has_more==='boolean' && Array.isArray(body.data) && body.data.length<=STRIPE_LIMITS.pageRows,'stripe_incomplete_response',502)
  requireValue(body.data.length>0 || (!after && !body.has_more),'stripe_inconsistent_pagination',502)
  for(const item of body.data) {
   requireValue(object(item) && item.object==='balance_transaction' && reference(item.id),'stripe_invalid_transaction',502)
   requireValue(!seen.has(item.id),'stripe_duplicate_transaction',502)
   requireValue(seen.size<STRIPE_LIMITS.rows,'stripe_row_limit',413)
   requireValue(item.currency==='usd','stripe_usd_required',502)
   requireValue(int(item.amount) && int(item.fee) && int(item.net),'stripe_unsafe_integer',502)
   requireValue(BigInt(item.net)===BigInt(item.amount)-BigInt(item.fee),'stripe_net_mismatch',502)
   requireValue(typeof item.type==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(item.type) && ['pending','available'].includes(String(item.status)) && (item.source===null || reference(item.source)),'stripe_invalid_transaction',502)
   const created=timestamp(item.created),available=timestamp(item.available_on)
   requireValue(int(item.created) && item.created>=window.start && item.created<window.end,'stripe_outside_interval',502)
   requireValue(item.created<=lastCreated,'stripe_inconsistent_pagination',502)
   lastCreated=item.created
   seen.add(item.id)
   rows.push([item.id,window.accountContext,created,available,csvDate(created),csvDate(available),'USD',item.type,String(item.status),item.source===null?'':item.source,dollars(item.amount),dollars(item.fee),dollars(item.net)])
  }
  if(!body.has_more)break
  after=String((body.data.at(-1) as Record<string,unknown>).id)
 }
 requireValue(seen.size>0,'stripe_empty_interval',409)
 if(Date.now()>=deadline)throw new AnalyticsError('provider_timeout',502)
 const source:Lineage={kind:'stripe-balance',link:endpoint,description:'Stripe balance movements, not recognized revenue or MRR. Account context is owner-declared, identity unverified. Observed pages are not a transactional source snapshot.',from:window.from,to:window.to,timezone:'UTC',observedAt,schema:'Stripe-Version '+STRIPE_VERSION+'; balance_transactions list and object',stripe:{accountContext:window.accountContext,pages,rows:seen.size,bytes,completedAt:new Date().toISOString()}}
 return {rows,columns,source}
}
