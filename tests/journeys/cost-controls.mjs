import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

/** The installed quote is reachable while signed out, before first-run setup. */
export async function proveReferenceEstimator(origin,context,page){
 const requests=[]
 const collect=request=>requests.push({url:request.url(),method:request.method()})
 page.on('request',collect)
 try{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   assert.equal((await page.goto(origin+'/cost-estimator')).status(),200)
   await page.getByRole('heading',{name:'Monthly cost estimator',exact:true}).waitFor()
   const form=page.locator('#cost-estimator'),status=page.locator('#quote-status'),result=page.locator('#quote-result')
   assert.equal(await result.isVisible(),false,'No invented rate or cheap default estimate')
   if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/cost-empty-'+width+'.png'})}
   for(const [name,value] of Object.entries({provider:'Owner analytical provider',size:'Two core bounded instance',region:'US East',rateDate:'2026-10-28',reference:'https://provider.example.test/rates'}))await form.locator(`[name="${name}"]`).fill(value)
   // Independently frozen prices and totals, never derived from calculator output.
   const prices={product:'0',control:'0.000001',compute:'0.05',scan:'0.005',storage:'0.02',refresh:'0.1',delivery:'0.002',agents:'0.03',portal:'2'}
   for(const [id,value]of Object.entries(prices))await form.locator(`[name="rate-${id}"]`).fill(value)
   const calculate=page.getByRole('button',{name:'Calculate monthly estimate',exact:true})
   for(const invalid of ['','0.0000001']){
    await form.locator('[name="rate-agents"]').fill(invalid)
    await calculate.click();await status.filter({hasText:'at most six decimal places'}).waitFor()
    assert.equal(await result.isVisible(),false)
    assert.equal(await form.locator('[name="rate-agents"]').getAttribute('aria-invalid'),'true')
    await page.getByRole('alert').filter({hasText:'at most six decimal places'}).waitFor()
   }
   await form.locator('[name="rate-agents"]').fill('0.03')
   await calculate.click();await status.filter({hasText:'Estimate calculated'}).waitFor()
   const expected={product:'0.000000',control:'0.251100',compute:'36.500000',scan:'31.500000',storage:'2.000000',refresh:'3.000000',delivery:'1.600000',agents:'3.000000',portal:'2.000000'}
   for(const [id,amount]of Object.entries(expected)){
    const line=page.locator(`[data-line="${id}"]`)
    assert.equal(await line.locator('.quote-amount').textContent(),'USD '+amount)
    assert.match(await line.innerText(),/Assumed quantity.*owner-entered rate/)
    assert.match(await line.innerText(),/2026-10-28/)
    assert.equal(await line.getByRole('link',{name:'Open rate provenance'}).getAttribute('href'),'https://provider.example.test/rates')
   }
   assert.equal(await page.locator('#quote-total').textContent(),'79.851100')
   if(process.env.BIFOCAL_PROOF_DIR)await result.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/cost-reference-result-'+width+'.png'})
   assert.equal(await page.locator('#quote-comparison').isVisible(),false)
   await page.locator('#workload>summary').click()
   assert.equal(await form.locator('[name="sources"]').inputValue(),'finance\nbilling\ncrm\nmarketing\nsupport\ncommerce\ninventory\npeople\nprojects\nfiles')
   for(const[name,value]of Object.entries({internalReaders:'50',refreshesPerSourceDaily:'24',portalTenants:'1',portalReaders:'10',retainedGB:'100',newGBMonthly:'10',dashboards:'20',tilesPerDashboard:'20',dashboardOpensDaily:'100',peakUsers:'5',dailyChangeMBPerSource:'100',weeklyBurstRuns:'4',burstRecipients:'50',alertEvaluationsDaily:'100',agentRunsMonthly:'100'}))assert.equal(await form.locator(`[name="${name}"]`).inputValue(),value)
   if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/cost-reference-'+width+'.png',fullPage:true})}
   await form.locator('[name="sources"]').fill('finance\nbilling\ncrm\nmarketing\nsupport')
   assert.equal(await result.isVisible(),false,'Editing assumptions invalidates the displayed quote')
   assert.equal(await page.locator('#source-count').textContent(),'Source count: 5')
   await form.locator('[name="refreshesPerSourceDaily"]').fill('12')
   await form.locator('[name="refreshesPerSourceDaily"]').press('Enter')
   await status.filter({hasText:'Estimate calculated'}).waitFor()
   assert.equal(await page.locator('[data-line="refresh"] [data-quantity]').getAttribute('data-quantity'),'7.5')
   assert.equal(await page.locator('[data-line="refresh"] .quote-amount').textContent(),'USD 0.750000')
   assert.equal(await page.locator('[data-line="control"] .quote-amount').textContent(),'USD 0.245700')
   assert.equal(await page.locator('#quote-total').textContent(),'77.595700')
   await page.locator('#licences>summary').click()
   await form.locator('[name="includeLicences"]').check()
   await form.locator('[name="licences"]').fill('200.000001')
   await calculate.focus();await page.keyboard.press('Enter');await status.filter({hasText:'Estimate calculated'}).waitFor()
   assert.equal(await page.locator('#quote-total').textContent(),'77.595700')
   assert.match(await page.locator('#quote-comparison').textContent(),/USD 277.595701, including USD 200.000001 source licences. Tax excluded/)
   if(process.env.BIFOCAL_PROOF_DIR)await result.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/cost-buyer-'+width+'.png'})
   await form.locator('[name="rate-storage"]').fill('0.0000001');await calculate.click()
   await status.filter({hasText:'at most six decimal places'}).waitFor()
   assert.equal(await result.isVisible(),false)
   assert.equal(await form.locator('[name="sources"]').inputValue(),'finance\nbilling\ncrm\nmarketing\nsupport')
   if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/cost-refused-'+width+'.png'})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Estimator reflows without page overflow')
   assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0)
   assert.deepEqual(await page.locator('main :is(p,label,input,button,summary,h1,h2,h3)').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName)),[])
  }
  assert.ok(requests.every(request=>new URL(request.url).origin===origin),'No external provider request')
  assert.ok(requests.filter(request=>request.method!=='GET').every(request=>request.method==='POST'&&new URL(request.url).pathname==='/api/cost-reference'),'Only quote calculation is requested, never activation or reservation')
  assert.equal((await context.request.post(origin+'/cost-estimator',{data:{}})).status(),405)
  assert.equal((await context.request.head(origin+'/cost-estimator')).status(),200)
 }finally{page.off('request',collect)}
 console.log('Reference estimator: signed-out pre-setup calculation, independent amounts, sources and cadence, licences, refusals, keyboard and no outbound work at 1440 and 390 passed')
}

export async function proveCostControls(origin,context,page){
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
 const fractional=await context.request.post(quoteUrl,{data:{compute,rates,workload:{sources:['finance'],refreshesPerSourceDaily:1,dailyChangeMBPerSource:1}}})
 assert.equal(fractional.status(),200)
 const fractionalQuote=await fractional.json()
 assert.equal(fractionalQuote.lines.find(line=>line.id==='refresh').amountMicroUsd,'1250')
 assert.equal(fractionalQuote.lines.every(line=>line.quantityBasis==='assumed'),true)
 const microRates=Object.fromEntries(Object.entries(rates).map(([id,rate])=>[id,{...rate,microUsdPerUnit:1}]))
 const rounded=await context.request.post(quoteUrl,{data:{compute,rates:microRates,workload:{sources:['finance'],refreshesPerSourceDaily:1,dailyChangeMBPerSource:1}}})
 assert.equal(rounded.status(),200)
 const roundedRefresh=(await rounded.json()).lines.find(line=>line.id==='refresh')
 assert.equal(roundedRefresh.amountMicroUsd,'1')
 assert.equal(roundedRefresh.roundingMicroUsd,true)
 for(const invalid of [{workload:{refreshesPerSourceDaily:1.5}},{workload:{sources:['finance','FINANCE']}},{rates:{...rates,storage:{...rates.storage,microUsdPerUnit:0.1}}}])assert.equal((await context.request.post(quoteUrl,{data:{compute,rates,...invalid}})).status(),422)
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
 if(page)for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings')
  await page.getByRole('link',{name:'Monthly cost estimator',exact:true}).click()
  await page.getByRole('heading',{name:'Monthly cost estimator',exact:true}).waitFor()
  await page.goto(origin+'/app/settings')
  for(const scope of ['source','job','agent','tenant']){
   const review=page.locator('#budget-review'),save=page.locator('#budget-save')
   await review.getByLabel('Budget scope',{exact:true}).selectOption(scope)
   await review.getByLabel('Budget id',{exact:true}).fill('synthetic-bifocal-ui-'+width)
   await review.getByRole('button',{name:'Review USD budget',exact:true}).click()
   await page.locator('#budget-status').filter({hasText:'USD budget loaded'}).waitFor()
   await save.getByLabel('Budget limit (USD)',{exact:true}).fill('125.000001')
   await save.getByLabel('Warning threshold (USD)',{exact:true}).fill('80.500001')
   await save.getByRole('checkbox').check()
   await save.getByRole('button',{name:'Save reviewed USD budget',exact:true}).click()
   await page.locator('#budget-status').filter({hasText:'USD budget saved'}).waitFor()
   const value=(await (await context.request.get(url+'/budgets')).json()).budgets.find(row=>row.scope===scope&&row.id==='synthetic-bifocal-ui-'+width)
   assert.equal(value.limit_micro,125000001);assert.equal(value.warn_micro,80500001)
  }
  await page.locator('#budget-review').getByRole('button').click()
  await page.locator('#budget-status').filter({hasText:'USD budget loaded'}).waitFor()
  const save=page.locator('#budget-save')
  await save.getByLabel('Budget limit (USD)',{exact:true}).fill('1.0000001')
  await save.getByRole('checkbox').check();await save.getByRole('button').click()
  await page.locator('#budget-status').filter({hasText:'at most six decimal places'}).waitFor()
  await save.getByLabel('Budget limit (USD)',{exact:true}).fill('130')
  const row=(await (await context.request.get(url+'/budgets')).json()).budgets.find(row=>row.scope==='tenant'&&row.id==='synthetic-bifocal-ui-'+width)
  await call('/budgets',{scope:'tenant',id:row.id,previousRevision:row.revision,limitMicroUsd:140000000,warnMicroUsd:80500001},'PUT')
  await save.getByRole('button').click()
  await page.locator('#budget-status').filter({hasText:'cost_conflict'}).waitFor()
  assert.equal((await (await context.request.get(url+'/budgets')).json()).budgets.find(value=>value.scope==='tenant'&&value.id===row.id).limit_micro,140000000)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0)
  if(process.env.BIFOCAL_PROOF_DIR){await import('node:fs/promises').then(fs=>fs.mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true}));await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/settings-budgets-'+width+'.png',fullPage:true})}
 }
 console.log('Cost controls: public owner-entered reference quote, exact numeric totals, workload recomputation, all four cumulative budget scopes, atomic competing reservations, warnings, estimate holds, actual overage, owner increase, stale revision and duplicate settlement refusal passed')
}
