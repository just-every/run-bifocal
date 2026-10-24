import { execute } from '../query/execute'
import { queryInput } from '../query/validate'
import { fail,type Query,type Measure,type Value } from '../query/types'
import { rational,plus,times,divide,exact,type Rational } from '../currency/decimal'
import type { QuestionScope } from './scope.server'
import type { QuestionPlan } from './planning'
const zero=rational(0n),one=rational(1n)
const subtract=(a:Rational,b:Rational)=>plus(a,rational(-b.numerator,b.denominator))
const value=(v:Value|undefined):Rational|null=>v?.state==='value'&&v.exact?rational(BigInt(v.exact.numerator),BigInt(v.exact.denominator)):null
const ratio=(a:Rational|null,b:Rational|null)=>a&&b&&b.numerator!==0n?divide(a,b):null
export function explainDrivers(scope:QuestionScope,current:Query,prior:Query,plan:QuestionPlan){
 const metric=current.measures[0],dimensions=current.semantic!.dimensions,allowed=new Map(dimensions.map(d=>[d.column,d.type]))
 const run=(q:Query)=>execute(queryInput(q),scope.sources,scope.context)
 const currentAnswer=run({...current,groupBy:[]}),priorAnswer=run({...prior,groupBy:[]})
 const dimensionDrivers=plan.drivers.map(column=>{
  if(!allowed.has(column))fail('question_driver_not_permitted',403)
  const before=run({...prior,groupBy:[column]}),after=run({...current,groupBy:[column]}),keys=new Map<string,unknown[]>()
  for(const row of [...before.rows,...after.rows])keys.set(JSON.stringify(row.dimensions),row.dimensions)
  let ratioParts:null|{before:ReturnType<typeof execute>;after:ReturnType<typeof execute>;beforeTotal:Rational|null;afterTotal:Rational|null}=null
  if(metric.op==='ratio'){
   const sum=(id:string,column:string):Measure=>{const money=allowed.get(column)==='money';return {id,op:'sum',column,unit:money?'money':'number',scale:12,...(money?{sourceCurrency:metric.sourceCurrency,currencyColumn:metric.currencyColumn,rateDateColumn:metric.rateDateColumn}:{})}}
   const parts=[sum('numerator',metric.numerator!),sum('denominator',metric.denominator!)]
   const b=run({...prior,groupBy:[column],measures:parts}),a=run({...current,groupBy:[column],measures:parts})
   ratioParts={before:b,after:a,beforeTotal:value(b.totals.denominator),afterTotal:value(a.totals.denominator)}
  }
  const rows=[...keys].map(([key,dimensions])=>{
   const b=before.rows.find(row=>JSON.stringify(row.dimensions)===key)?.values[metric.id],a=after.rows.find(row=>JSON.stringify(row.dimensions)===key)?.values[metric.id],bv=b?value(b):zero,av=a?value(a):zero
   let contribution=av&&bv?subtract(av,bv):null
   if(ratioParts){
    const b=ratioParts.before.rows.find(row=>JSON.stringify(row.dimensions)===key)?.values.numerator,a=ratioParts.after.rows.find(row=>JSON.stringify(row.dimensions)===key)?.values.numerator
    const before=ratio(b?value(b):zero,ratioParts.beforeTotal),after=ratio(a?value(a):zero,ratioParts.afterTotal)
    contribution=before&&after?times(subtract(after,before),metric.unit==='percent'?rational(100n):one):null
   }
   return {dimensions,before:b??null,after:a??null,contribution:contribution?exact(contribution):null}
  })
  return {dimension:column,metric:metric.id,method:ratioParts?'Change in group numerator divided by its period-wide denominator; contributions add to overall ratio change':metric.op==='sum'||metric.op==='count'?'Exact additive group changes':'Group comparison only; non-additive values are not summed',rows}
 })
 let priceVolume:Record<string,unknown>={state:'unavailable',reason:'No permitted revenue, quantity and product mapping was supplied.'}
 if(plan.priceVolume){
  const {revenue,quantity,product}=plan.priceVolume
  if(!['number','money'].includes(allowed.get(revenue)??'')||allowed.get(quantity)!=='number'||!allowed.has(product))fail('question_price_volume_not_permitted',403)
  const sourceMetric=scope.query.measures.find(m=>m.op==='sum'&&m.column===revenue)
  if(!sourceMetric)priceVolume={state:'unavailable',reason:'The selected revenue column has no permitted additive metric with currency semantics.'}
  else{
   const measures:Measure[]=[{...sourceMetric,id:'revenue'},{id:'quantity',op:'sum',column:quantity,unit:'number',scale:12}],before=run({...prior,groupBy:[product],measures}),after=run({...current,groupBy:[product],measures}),products=new Set([...before.rows,...after.rows].map(r=>JSON.stringify(r.dimensions)))
   let price=zero,volume=zero,residual=zero
   const rows=[...products].map(key=>{
    const b=before.rows.find(r=>JSON.stringify(r.dimensions)===key),a=after.rows.find(r=>JSON.stringify(r.dimensions)===key),r0=b?value(b.values.revenue):zero,r1=a?value(a.values.revenue):zero,q0=b?value(b.values.quantity):zero,q1=a?value(a.values.quantity):zero,p0=ratio(r0,q0),p1=ratio(r1,q1)
    if(!r0||!r1||!q0||!q1)return {product:JSON.parse(key),state:'unavailable',reason:'Incomplete or unknown revenue or quantity.'}
    const delta=subtract(r1,r0)
    if(!p0||!p1){residual=plus(residual,delta);return {product:JSON.parse(key),state:'unpriced',residual:exact(delta),reason:'New, discontinued or zero-quantity product; no invented unit price.'}}
    const pv=times(subtract(p1,p0),divide(plus(q0,q1),rational(2n))),vv=times(subtract(q1,q0),divide(plus(p0,p1),rational(2n)))
    price=plus(price,pv);volume=plus(volume,vv)
    return {product:JSON.parse(key),state:'computed',beforeRevenue:exact(r0),afterRevenue:exact(r1),price:exact(pv),volume:exact(vv),delta:exact(delta)}
   })
   priceVolume={state:rows.some(r=>r.state==='unavailable')?'incomplete':'computed',method:'Symmetric arithmetic decomposition per product using average realized price and quantity; not causal evidence',price:exact(price),volume:exact(volume),unpricedResidual:exact(residual),rows}
  }
 }
 return {before:priorAnswer,after:currentAnswer,dimensions:dimensionDrivers,priceVolume,arithmetic:'Observed arithmetic differences in permitted rows and declared periods.',correlation:'No correlation is inferred from group differences alone.',hypotheses:[],causalEvidence:'None supplied; causal claims require independent evidence.'}
}
