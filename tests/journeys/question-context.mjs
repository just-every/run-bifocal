import assert from 'node:assert/strict'
import {fixturePlan} from './question-edge.mjs'
import {questionReferences,sameQuestionAnswer} from './question-reference.mjs'
const rational=value=>({n:BigInt(value.numerator),d:BigInt(value.denominator)})
const plus=(a,b)=>({n:a.n*b.d+b.n*a.d,d:a.d*b.d})
const minus=(a,b)=>plus(a,{n:-b.n,d:b.d})
export async function proveQuestionContext(first,edge,live,call){
 const seed=await first.ask(first.company.cases[1]),queries=[
  {question:'Now only West, for September 2026.',from:'2026-09-01',to:'2026-09-30'},
  {question:'And August 2026 instead.',from:'2026-08-01',to:'2026-08-31'},
 ]
 let context=seed.interpretation
 for(const q of queries){
  const from=" FROM sales WHERE region <> 'Restricted' AND region=? AND date>=? AND date<=?",fixture={question:q.question,asOf:first.base.asOf,expected:{decision:'answer',measureIds:['revenue'],groupBy:['region'],filters:[{column:'region',op:'eq',value:'West'}],date:{from:q.from,to:q.to}},reference:{sql:'SELECT region,SUM(revenue_cents) AS revenue_minor'+from+' GROUP BY region ORDER BY region',totalsSql:'SELECT SUM(revenue_cents) AS revenue_minor'+from,filteredRowsSql:'SELECT count(*)'+from,params:['West',q.from,q.to],totalsParams:['West',q.from,q.to]}}
  if(!live)edge.plans.set(q.question,fixturePlan(fixture))
  const result=await first.ask(fixture,{context});assert.equal(sameQuestionAnswer(result,fixture,questionReferences({...first.company,cases:[fixture]})[0]),null);context=result.interpretation
 }
 await call('/quality/rules',{id:'synthetic-bifocal-question-quality',dataset:first.company.id,definition:{name:'Expected invoice row count',kind:'count',expected:'89'}});await call('/quality/rules/synthetic-bifocal-question-quality/run',{})
 const q='Explain September 2026 revenue compared with August 2026 by region, product, channel and customer. Include price versus volume by product.',fixture={question:q,asOf:first.base.asOf,expected:{decision:'answer',measureIds:['revenue'],groupBy:[],filters:[],date:{from:'2026-09-01',to:'2026-09-30'},comparison:{from:'2026-08-01',to:'2026-08-31'},why:true}}
 if(!live){const plan=fixturePlan(fixture);plan.priceVolume={revenue:'revenue',quantity:'quantity',product:'product'};edge.plans.set(q,plan)}
 const result=await first.ask(fixture),why=result.why
 assert.equal(why.quality.state,'at risk');assert.equal(why.dimensions.length,4);assert.equal(why.priceVolume.state,'computed');assert.deepEqual(why.hypotheses,[]);assert.match(why.causalEvidence,/None/)
 const total=plus(plus(rational(why.priceVolume.price),rational(why.priceVolume.volume)),rational(why.priceVolume.unpricedResidual)),delta=minus(rational(why.after.totals.revenue.exact),rational(why.before.totals.revenue.exact))
 assert.equal(total.n*delta.d,delta.n*total.d)
 return result
}
