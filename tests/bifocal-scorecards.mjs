import assert from 'node:assert/strict'
export async function proveScorecards({call,today,proveScreen}) {
 const year=today.slice(0,4),month=Number(today.slice(5,7)),quarter=Math.floor((month-1)/3)*3+1
 const from=`${year}-${String(quarter).padStart(2,'0')}-01`,to=quarter===10?`${Number(year)+1}-01-01`:`${year}-${String(quarter+3).padStart(2,'0')}-01`
 const definition={id:'synthetic-bifocal-revenue-goal',metricId:'synthetic-bifocal-revenue',title:'Quarterly USD revenue',from,to,dateColumn:'date',target:'1000.00',currency:'USD',maxAgeSeconds:86400}
 await call('/goals',definition)
 let goal=await call('/goals/'+definition.id)
 assert.equal(goal.actual.state,'value');assert.equal(goal.actual.value.value,'30.00');assert.equal(goal.actual.metric.revision,1);assert.equal(goal.actual.forecast.kind,'linear pace, not a financial forecast');assert.equal(goal.easel.state,'unresolved')
 const source=await call('/queries/run',goal.actual.query);assert.deepEqual(goal.actual.value,source.answer.totals.revenue)
 await call('/goals/'+definition.id+'/checkins',{previousVersion:1,observation:'Owner observation, without changing actuals',observedOn:today})
 goal=await call('/goals/'+definition.id);assert.equal(goal.checkins.length,1);assert.equal(goal.actual.value.value,'30.00')
 const {id,metricId,...changed}=definition
 await call('/goals/'+id+'/revise',{...changed,previousVersion:1,from:year+'-01-01',to:(Number(year)+1)+'-01-01',target:'1200.00'})
 await call('/goals/'+id+'/revise',{...changed,previousVersion:1,from:year+'-01-01',to:(Number(year)+1)+'-01-01',target:'1200.00'},409)
 goal=await call('/goals/'+id);assert.equal(goal.versions.length,2);assert.equal(goal.definition.target,'1200.00');assert.equal(goal.versions[1].definition.target,'1000.00')
 await proveScreen('/app/goals','goals');await proveScreen('/app/goals/'+id,'goal-checkins')
 console.log('Scorecards: certified source-query parity, exact USD target versions, dated attributed observations, stale revision refusal and phone workflow passed; Easel remains unresolved')
}
