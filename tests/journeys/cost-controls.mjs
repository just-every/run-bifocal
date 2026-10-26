import assert from 'node:assert/strict'
export async function proveCostControls(origin,context){
 const quoteUrl=origin+'/api/cost-reference'
 const rates=Object.fromEntries(['product','control','compute','scan','storage','refresh','delivery','agents','portal'].map(id=>[id,{microUsdPerUnit:1000000,rateDate:'2026-10-26',reference:'Owner-entered synthetic provider size and rate'}]))
 const compute={provider:'synthetic-bifocal-1',size:'one bounded worker',region:'US'}
 const quote=await fetch(quoteUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({compute,rates,sourceLicencesMicroUsd:9000000})})
 assert.equal(quote.status,200)
 const result=await quote.json()
 assert.equal(result.totalUsd,'247762.000000')
 assert.equal(result.totalMicroUsd,'247762000000')
 assert.equal(result.fullComparisonMicroUsd,'247771000000')
 assert.equal(result.lines.every(line=>line.quantityBasis==='assumed'&&line.rateBasis==='owner-entered'),true)
 const changed=await context.request.post(quoteUrl,{data:{compute,rates,quantities:{compute:1,control:0}}})
 assert.equal((await changed.json()).totalMicroUsd,'7033000000')
 const missing={...rates};delete missing.agents
 assert.equal((await context.request.post(quoteUrl,{data:{compute,rates:missing}})).status(),422)
 assert.equal((await context.request.post(quoteUrl,{data:{compute,rates,quantities:{compute:-1}}})).status(),422)
 const url=origin+'/api/operator/costs'
 const call=async(path,data,method,expected=200)=>{
  const response=await context.request.fetch(url+path,{method,headers:{Origin:origin},data})
  assert.equal(response.status(),expected,await response.text());return response.json()
 }
 assert.equal((await fetch(url+'/budgets')).status,401)
 assert.equal((await context.request.put(url+'/budgets',{headers:{Origin:'https://foreign.example.test'},data:{}})).status(),401)
 for(const scope of ['source','job','agent','tenant']){
  const input={scope,id:'synthetic-bifocal-1',previousRevision:null,limitMicroUsd:100,warnMicroUsd:50}
  let budget=await call('/budgets',input,'PUT')
  await call('/budgets',input,'PUT',409)
  const reservation={scope,budgetId:input.id,reviewedBudgetRevision:budget.revision,estimatedMicroUsd:60}
  const attempts=await Promise.all([context.request.post(url+'/reservations',{headers:{Origin:origin},data:reservation}),context.request.post(url+'/reservations',{headers:{Origin:origin},data:reservation})])
  assert.deepEqual(attempts.map(r=>r.status()).sort(),[201,409])
  const booked=await attempts.find(r=>r.status()===201).json()
  assert.equal(booked.warning,true)
  await call('/reservations',{...reservation,estimatedMicroUsd:41},'POST',409)
  await call('/reservations/'+booked.id,{state:'settled',actualMicroUsd:120},'PUT')
  await call('/reservations/'+booked.id,{state:'released'},'PUT',409)
  await call('/reservations',{...reservation,estimatedMicroUsd:1},'POST',409)
  budget=await call('/budgets',{...input,previousRevision:budget.revision,limitMicroUsd:200},'PUT')
  await call('/reservations',{...reservation,estimatedMicroUsd:1},'POST',409)
  const next=await call('/reservations',{...reservation,reviewedBudgetRevision:budget.revision,estimatedMicroUsd:80},'POST',201)
  await call('/reservations/'+next.id,{state:'released'},'PUT')
  const final=await call('/budgets',undefined,'GET')
  const usage=await call('/reservations?scope='+scope+'&budgetId='+input.id,undefined,'GET')
  assert.equal(usage.reservations.filter(row=>row.state==='settled').length,1)
  assert.equal(usage.reservations.find(row=>row.state==='settled').actual_micro,120)
  assert.equal(final.budgets.find(b=>b.scope===scope&&b.id===input.id).committed_micro,120)
 }
 console.log('Cost controls: public owner-entered reference quote, exact numeric totals, workload recomputation, all four cumulative budget scopes, atomic competing reservations, warnings, estimate holds, actual overage, owner increase, stale revision and duplicate settlement refusal passed')
}
