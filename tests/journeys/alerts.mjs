import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {proveAlertCommitFences} from './alert-boundaries.mjs'

/** One native flow: reviewed source changes, exact observations and episode custody. */
export async function proveAlerts({origin,owner,reader,page,upload,proveScreen,clock,browser,devKey}) {
 const headers={Origin:origin},dataset='synthetic-bifocal-160',calendar='synthetic-bifocal-161'
 const call=async(path,data,expected=data===undefined?200:201,method=data===undefined?'GET':'POST',context=owner)=>{
  const response=await context.request.fetch(origin+'/api/operator'+path,{method,headers,...data===undefined?{}:{data}})
  assert.equal(response.status(),expected,await response.text());return response.json()
 }
 const detail=rule=>call('/alerts/'+rule.id)
 const evaluate=(rule,requestId=randomUUID())=>call('/alerts/'+rule.id+'/evaluate',{requestId},200)
 const sourceHeader='invoice,customer,status,amount\n'
 const empty=sourceHeader+'9,synthetic-bifocal-162,paid,$0.00\n'
 const overdue=sourceHeader+'1,synthetic-bifocal-163,overdue,$100.00\n2,synthetic-bifocal-164,overdue,$50.00\n9,synthetic-bifocal-162,paid,$0.00\n'
 const reordered=sourceHeader+'9,synthetic-bifocal-162,paid,$0.00\n2.0,synthetic-bifocal-164,overdue,$50.00\n1.00,synthetic-bifocal-163,overdue,$100.00\n'
 const duplicate=sourceHeader+'1,synthetic-bifocal-163,overdue,$100.00\n1,synthetic-bifocal-163,overdue,$100.00\n2,synthetic-bifocal-164,overdue,$50.00\n'
 const collision=sourceHeader+'1,synthetic-bifocal-163,overdue,$100.00\n1,synthetic-bifocal-164,overdue,$100.00\n'
 const qualityIds=['synthetic-bifocal-165','synthetic-bifocal-166']
 let now=clock.now()
 const tick=async(ms=1000)=>{now+=ms;await clock.set(new Date(now).toISOString())}
 const replace=async csv=>{await tick();await upload(dataset,csv,true)}
 const healthy=async()=>{for(const id of qualityIds)assert.equal((await call('/quality/rules/'+id+'/run',{})).result.state,'passed')}
 const unchangedOnRefusal=async(rule,expected=409,context=owner)=>{
  const before=await detail(rule)
  const refused=await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},expected,'POST',context)
  if(expected===409)assert.equal(refused.error,'alert_quality_unhealthy')
  assert.deepEqual(await detail(rule),before,'A refused check changes neither comparison baseline nor episode history')
 }
 const observed=(evaluation,{rows,total,baseline=false,triggered=false,qualifying=triggered})=>{
  const o=evaluation.observation
  assert.equal(o.baseline,baseline);assert.equal(o.triggered,triggered);assert.equal(o.qualifying,qualifying)
  assert.equal(o.answer.totals.amount.value,total)
  if(rows)assert.deepEqual(o.answer.rows.map(r=>[Number(r.dimensions[0]),r.dimensions[1],r.values.amount.value]).sort((a,b)=>a[0]-b[0]||a[1].localeCompare(b[1])),rows)
  const query=o.ruleId===threshold?.id||o.ruleId===every?.id?scalar:table
  assert.equal(o.refs.queryId,query.queryId);assert.equal(o.refs.queryDigest,query.digest)
  assert.equal(o.refs.definitionHash,o.answer.definitionHash)
  assert.deepEqual(o.refs.context.securityScope,{kind:'installation-owner',ownerId:query.context.ownerId})
  assert.deepEqual(o.refs.sourceWatermarks,o.answer.sourceWatermarks)
  assert.deepEqual(o.refs.sourceWatermarks.map(s=>s.dataset),[dataset])
  assert.deepEqual(o.refs.quality.map(q=>q.ruleId).sort(),[...qualityIds].sort())
  for(const evidence of o.refs.quality){assert.equal(evidence.sourceRevision,o.refs.sourceWatermarks[0].revision);assert.equal(evidence.result.state,'passed');assert.equal(evidence.live.state,'passed');assert.ok(evidence.runId)}
  return evaluation
 }
 let threshold,every,table,scalar
 const expected150=[[1,'synthetic-bifocal-163','100.00'],[2,'synthetic-bifocal-164','50.00']]
 const expected250=[[1,'synthetic-bifocal-163','200.00'],[2,'synthetic-bifocal-164','50.00']]
 const expected200=[[1,'synthetic-bifocal-163','100.00'],[1,'synthetic-bifocal-164','100.00']]
 const click=async name=>{await Promise.all([page.waitForNavigation(),page.getByRole('button',{name,exact:true}).click()])}
 try {
  await clock.set(new Date(now).toISOString())
  let conventions=await call('/company')
  if(!conventions.settings.name)conventions=await call('/company',{previousRevision:conventions.revision,settings:{...conventions.settings,name:'Synthetic Bifocal monitoring'}},200,'PUT')
  await upload(dataset,empty)
  await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Invoice monitoring year',kind:'fiscal',startMonth:1}})
  const query={version:1,dataset,joins:[],filters:[{column:'status',op:'eq',value:'overdue'}],groupBy:['invoice','customer'],measures:[{id:'amount',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD',empty:'zero'}],context:{modelVersion:'synthetic-bifocal-167',metricVersion:'synthetic-bifocal-168',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
  table=await call('/queries/run',query);scalar=await call('/queries/run',{...query,groupBy:[]})
  assert.deepEqual(table.answer.rows,[]);assert.equal(table.answer.certification,'unavailable')
  await call('/quality/rules',{id:qualityIds[0],dataset,definition:{name:'Invoice amount present',kind:'not-null',column:'amount'}})
  await call('/quality/rules',{id:qualityIds[1],dataset,definition:{name:'Current invoice source',kind:'freshness',maxAgeSeconds:60}})
  await healthy()
  const ruleDefinition=(title,predicate,queryId=table.queryId,comparison={kind:'multiset'},behavior='edge')=>({title,queryId,predicate,comparison,behavior,baseline:'first-observation'})
  const create=async(...args)=>(await call('/alerts',ruleDefinition(...args))).rule
  // Author two uncertified saved-query rules through the actual desktop and phone forms.
  let rowsRule
  for(const width of [1440,390]) {
   const thresholdForm=width===1440
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/alerts')
   await page.getByRole('heading',{name:'Query alerts',exact:true}).waitFor()
   await page.getByLabel('Alert name',{exact:true}).fill(thresholdForm?'Outstanding amount threshold':'Overdue invoices')
   await page.getByLabel('Saved query',{exact:true}).selectOption(thresholdForm?scalar.queryId:table.queryId)
   await page.getByLabel('Condition',{exact:true}).selectOption(thresholdForm?'threshold':'rows-exist')
   if(thresholdForm){await page.getByLabel('Measure',{exact:true}).fill('amount');await page.getByLabel('Comparison operator',{exact:true}).selectOption('gt');await page.getByLabel('Threshold',{exact:true}).fill('120')}
   await page.getByLabel('Trigger behavior',{exact:true}).selectOption('edge')
   await page.getByLabel('Comparison identity',{exact:true}).selectOption('multiset')
   const settings=page.locator('.menu > summary'),tooltip=page.getByRole('tooltip',{name:'Open settings'})
   await settings.hover();await tooltip.waitFor({state:'visible'})
   await page.mouse.move(0,0);await settings.focus();assert.equal(await tooltip.isVisible(),true)
   await proveScreen('alerts-authoring-'+(thresholdForm?'threshold':'rows'))
   await page.setViewportSize({width,height:1000});await click('Create alert')
   const created=(await call('/alerts/'+new URL(page.url()).pathname.split('/').at(-1))).rule
   if(thresholdForm)threshold=created;else rowsRule=created
  }
  assert.ok(rowsRule);assert.equal(new URL(page.url()).pathname,'/app/alerts/'+rowsRule.id)
  await proveScreen('alerts-awaiting-baseline')
  assert.deepEqual(rowsRule.predicate,{kind:'rows-exist'})
  assert.equal(rowsRule.queryId,table.queryId);assert.equal(rowsRule.behavior,'edge')
  const changed=await create('Invoice result changes',{kind:'results-changed'})
  const keyed=await create('Invoice identity changes',{kind:'results-changed'},table.queryId,{kind:'stable-key',columns:['invoice']})
  const noRows=await create('No overdue invoices',{kind:'no-rows'})
  assert.deepEqual(threshold.predicate,{kind:'threshold',measure:'amount',op:'gt',value:'120'})
  every=await create('Outstanding amount every check',{kind:'threshold',measure:'amount',op:'gte',value:'120.00'},scalar.queryId,{kind:'multiset'},'every')
  const rules=[rowsRule,changed,keyed,noRows,threshold,every]
  const machineBefore=await detail(rowsRule),machineHeaders={...headers,Authorization:'Bearer synthetic-bifocal-170'}
  for(const path of ['/api/operator/alerts','/api/operator/alerts/'+rowsRule.id,'/app/alerts','/app/alerts/'+rowsRule.id])assert.equal((await owner.request.get(origin+path,{headers:machineHeaders})).status(),403)
  for(const [path,data] of [['',ruleDefinition('Refused machine alert',{kind:'rows-exist'})],['/'+rowsRule.id+'/evaluate',{requestId:randomUUID()}],['/'+rowsRule.id+'/reset',{}],['/'+rowsRule.id+'/acknowledge',{episodeId:randomUUID()}],['/'+rowsRule.id+'/snooze',{episodeId:randomUUID(),until:new Date(now+3600000).toISOString()}]])assert.equal((await owner.request.post(origin+'/api/operator/alerts'+path,{headers:machineHeaders,data})).status(),403)
  assert.deepEqual(await detail(rowsRule),machineBefore,'A bearer cannot borrow native owner cookies for alert authority')
  for(const rule of rules) {
   await call('/alerts/'+rule.id,undefined,401,'GET',reader)
   await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},401,'POST',reader)
   for(const [action,data] of [['reset',{}],['acknowledge',{episodeId:randomUUID()}],['snooze',{episodeId:randomUUID(),until:new Date(now+3600000).toISOString()}]])await call('/alerts/'+rule.id+'/'+action,data,401,'POST',reader)
  }
  await call('/alerts',ruleDefinition('Refused reader alert',{kind:'rows-exist'}),401,'POST',reader)
  assert.equal((await fetch(origin+'/api/operator/alerts')).status,401)
  assert.equal((await owner.request.post(origin+'/api/operator/alerts/'+rowsRule.id+'/evaluate',{headers:{Origin:'https://foreign.example.test'},data:{requestId:randomUUID()}})).status(),401)
  await click('Check now')
  let state=await detail(rowsRule)
  observed({observation:state.observations[0]},{rows:[],total:'0.00',baseline:true})
  assert.equal(state.episodes.length,0)
  await proveScreen('alerts-baseline')
  await page.setViewportSize({width:1440,height:1000});await click('Check now')
  observed({observation:(await detail(rowsRule)).observations[0]},{rows:[],total:'0.00'})
  for(const rule of rules.slice(1))assert.equal(observed(await evaluate(rule),{total:'0.00',baseline:true}).episode,null)
  // A replacement is not eligible until its real quality rules have run.
  await replace(overdue)
  for(const rule of rules)await unchangedOnRefusal(rule)
  await healthy()
  await page.goto(origin+'/app/alerts/'+rowsRule.id);await click('Check now')
  state=await detail(rowsRule)
  const firstRows=observed({observation:state.observations[0],episode:state.episodes[0]},{rows:expected150,total:'150.00',triggered:true})
  const firstEpisode=firstRows.episode.id
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/alerts/'+rowsRule.id);await page.getByRole('heading',{name:rowsRule.title,exact:true}).waitFor();assert.ok((await page.getByRole('table').innerText()).includes('100.00'));assert.ok(await page.getByRole('table').evaluate(table=>table.scrollWidth<=table.parentElement.clientWidth),'Observed values fit the result pane');await proveScreen('alerts-triggered',{widths:[width],resize:false})}
  for(const rule of [changed,keyed,noRows,threshold,every])observed(await evaluate(rule),{...([threshold,every].includes(rule)?{}:{rows:expected150}),total:'150.00',triggered:rule!==noRows})
  const everyOpen=(await detail(every)).episodes.find(e=>e.state==='open')
  const againEvery=observed(await evaluate(every),{total:'150.00',triggered:true})
  assert.equal(againEvery.episode.id,everyOpen.id);assert.equal(againEvery.episode.observationCount,2)
  assert.equal(observed(await evaluate(threshold),{total:'150.00',qualifying:true}).episode.id,(await detail(threshold)).episodes[0].id)
  for(const rule of [changed,keyed]){observed(await evaluate(rule),{rows:expected150,total:'150.00'});assert.equal((await detail(rule)).episodes.filter(e=>e.state==='open').length,0)}
  // Incidental order and equivalent typed decimals are silent across revisions.
  await replace(reordered);await healthy()
  for(const rule of [changed,keyed])observed(await evaluate(rule),{rows:expected150,total:'150.00'})
  const immutable=await call('/queries/'+table.queryId)
  assert.deepEqual(immutable.answer.rows,[],'The alert rereads the current source without rewriting its saved question')
  await page.goto(origin+'/app/alerts/'+rowsRule.id);await click('Acknowledge episode')
  assert.ok((await detail(rowsRule)).episodes.find(e=>e.id===firstEpisode).acknowledgedAt)
  const until=new Date(now+3600000).toISOString()
  await page.getByLabel('Snooze until',{exact:true}).fill(until);await click('Snooze episode')
  assert.equal((await detail(rowsRule)).episodes.find(e=>e.id===firstEpisode).snoozedUntil,until)
  const followed=await detail(rowsRule),followedObservation=followed.observations[0],followedSource=await call('/datasets/'+dataset)
  for(const kind of ['acknowledged','snoozed']) {
   const transition=followed.transitions.find(t=>t.kind===kind)
   assert.ok(transition);assert.equal(transition.episodeId,firstEpisode);assert.equal(transition.observationId,followedObservation.id)
   assert.deepEqual(transition.refs,followedObservation.refs)
   assert.equal(transition.actorId,table.context.ownerId)
   assert.equal(transition.actionRefs.queryId,table.queryId);assert.equal(transition.actionRefs.queryDigest,table.digest)
   assert.deepEqual(transition.actionRefs.context.securityScope,table.context.securityScope)
   assert.equal(transition.actionRefs.sourceWatermarks[0].revision,followedSource.revision)
   assert.deepEqual(transition.actionRefs.quality.map(q=>q.ruleId).sort(),[...qualityIds].sort())
  }
  await call('/alerts/'+every.id+'/snooze',{episodeId:everyOpen.id,until},200)
  const snoozed=observed(await evaluate(every),{total:'150.00',qualifying:true})
  assert.equal(snoozed.episode.id,everyOpen.id)
  await proveScreen('alerts-acknowledged-snoozed')
  // Time alone makes a previously passed freshness rule ineligible.
  await tick(61000)
  for(const rule of rules)await unchangedOnRefusal(rule)
  const staleReplay=await detail(every)
  assert.equal((await call('/alerts/'+every.id+'/evaluate',{requestId:snoozed.observation.requestId},409)).error,'alert_quality_unhealthy')
  assert.deepEqual(await detail(every),staleReplay,'Request replay requires current healthy evidence without changing the saved observation')
  for(const [action,data] of [['reset',{}],['acknowledge',{episodeId:firstEpisode}],['snooze',{episodeId:firstEpisode,until:new Date(now+3600000).toISOString()}]]) {
   const before=await detail(rowsRule)
   assert.equal((await call('/alerts/'+rowsRule.id+'/'+action,data,409)).error,'alert_quality_unhealthy')
   assert.deepEqual(await detail(rowsRule),before,'Stale quality cannot change episode follow-up or reset the baseline')
  }
  await page.goto(origin+'/app/alerts/'+rowsRule.id)
  await page.getByRole('button',{name:'Check now',exact:true}).click()
  await page.getByRole('status').filter({hasText:'baseline and episode are unchanged'}).waitFor()
  await proveScreen('alerts-quality-refusal')
  await replace(sourceHeader+'1,synthetic-bifocal-163,overdue,\n')
  assert.equal((await call('/quality/rules/'+qualityIds[0]+'/run',{})).result.state,'failed')
  assert.equal((await call('/quality/rules/'+qualityIds[1]+'/run',{})).result.state,'passed')
  for(const rule of rules)await unchangedOnRefusal(rule)
  await tick(3600000);await replace(overdue);await healthy()
  const afterSnooze=observed(await evaluate(every),{total:'150.00',triggered:true})
  assert.equal(afterSnooze.episode.id,everyOpen.id,'Snooze expiry resumes qualifying observations in the existing episode')
  // Duplicate source records are retained in the exact result's multiplicity.
  await replace(duplicate);await healthy()
  observed(await evaluate(changed),{rows:expected250,total:'250.00',triggered:true})
  observed(await evaluate(keyed),{rows:expected250,total:'250.00',triggered:true})
  await replace(collision);await healthy()
  const keyedBefore=await detail(keyed)
  assert.equal((await call('/alerts/'+keyed.id+'/evaluate',{requestId:randomUUID()},409)).error,'alert_stable_key_not_unique')
  assert.deepEqual(await detail(keyed),keyedBefore,'A nonunique declared key cannot replace the previous eligible baseline')
  observed(await evaluate(changed),{rows:expected200,total:'200.00',qualifying:true})
  // A healthy empty query is a business observation and recovers open episodes.
  await replace(empty);await healthy()
  for(const rule of [rowsRule,threshold,every]){observed(await evaluate(rule),{...(rule===rowsRule?{rows:[]}:{}),total:'0.00'});assert.equal((await detail(rule)).episodes.filter(e=>e.state==='open').length,0)}
  observed(await evaluate(noRows),{rows:[],total:'0.00',triggered:true})
  assert.ok((await detail(rowsRule)).transitions.some(t=>t.kind==='recovered'&&t.episodeId===firstEpisode))
  const closed=await detail(rowsRule)
  for(const [action,data] of [['acknowledge',{episodeId:firstEpisode}],['snooze',{episodeId:firstEpisode,until:new Date(now+3600000).toISOString()}]])await call('/alerts/'+rowsRule.id+'/'+action,data,409)
  assert.deepEqual(await detail(rowsRule),closed,'Closed episodes cannot accept new follow-up actions')
  await page.goto(origin+'/app/alerts/'+rowsRule.id);await proveScreen('alerts-recovered')
  for(const rule of [changed,keyed]){observed(await evaluate(rule),{rows:[],total:'0.00',qualifying:true});observed(await evaluate(rule),{rows:[],total:'0.00'})}
  await replace(overdue);await healthy()
  const secondRows=observed(await evaluate(rowsRule),{rows:expected150,total:'150.00',triggered:true})
  assert.notEqual(secondRows.episode.id,firstEpisode)
  observed(await evaluate(noRows),{rows:expected150,total:'150.00'})
  await page.goto(origin+'/app/alerts/'+rowsRule.id);await click('Reset baseline')
  const reset=await detail(rowsRule)
  assert.equal(reset.rule.baselineObservationId,null);assert.ok(reset.transitions.some(t=>t.kind==='reset'))
  assert.equal(reset.episodes.filter(e=>e.state==='open').length,0)
  await proveScreen('alerts-reset')
  observed(await evaluate(rowsRule),{rows:expected150,total:'150.00',baseline:true})
  // Two transports for one request are exactly one observation and episode.
  const beforeDuplicate=await detail(rowsRule),requestId=randomUUID()
  const duplicates=await Promise.all([evaluate(rowsRule,requestId),evaluate(rowsRule,requestId)])
  assert.equal(duplicates[0].observation.id,duplicates[1].observation.id);assert.equal(duplicates[0].episode.id,duplicates[1].episode.id)
  observed(duplicates[0],{rows:expected150,total:'150.00',triggered:true})
  const afterDuplicate=await detail(rowsRule)
  assert.equal(afterDuplicate.observations.length,beforeDuplicate.observations.length+1)
  assert.equal(afterDuplicate.episodes.length,beforeDuplicate.episodes.length+1)
  assert.equal(afterDuplicate.transitions.filter(t=>t.kind==='opened'&&t.observationId===duplicates[0].observation.id).length,1)
  // Native session withdrawal is checked again at the transport door.
  const withdrawn=await browser.newContext()
  try {
   assert.equal((await withdrawn.request.post(origin+'/__dev/key',{headers,data:{key:devKey}})).status(),204)
   const ownerEmail=(await(await owner.request.get(origin+'/auth/session')).json()).operator.email
   assert.equal((await withdrawn.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(ownerEmail),{maxRedirects:0})).status(),303)
   const session=await(await withdrawn.request.get(origin+'/auth/session')).json()
   await proveAlertCommitFences({origin,owner,withdrawn,sessionId:session.id,rule:rowsRule,dataset,detail,evaluate,replace,healthy,overdue,qualityIds,now})
   await unchangedOnRefusal(rowsRule,401,withdrawn)
  } finally {await withdrawn.close()}
  // A changed money unit cannot silently reinterpret an existing threshold or baseline.
  const differentCurrency=await call('/company',{previousRevision:conventions.revision,settings:{...conventions.settings,currency:'EUR'}},200,'PUT')
  for(const rule of rules){const before=await detail(rule);assert.equal((await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},409)).error,'alert_query_currency_changed');assert.deepEqual(await detail(rule),before)}
  await call('/company',{previousRevision:differentCurrency.revision,settings:conventions.settings},200,'PUT')
  // Retention holds protect all value-bearing alert stores; eligible erase removes them.
  const source=await call('/datasets/'+dataset)
  let previousRevision=null
  for(const protection of [{legalHold:true,minimumRetainUntil:null},{legalHold:false,minimumRetainUntil:new Date(now+86400000).toISOString()}]) {
   const policy=await call('/retention/'+dataset,{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,...protection,releaseHold:true},200,'PUT');previousRevision=policy.revision
   const before=await Promise.all(rules.map(detail))
   await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},423)
   assert.deepEqual(await Promise.all(rules.map(detail)),before,'A held erasure preserves rules, observed values and follow-up')
  }
  await call('/retention/'+dataset,{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,legalHold:false,minimumRetainUntil:null,releaseHold:true},200,'PUT')
  const erased=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200)
  for(const store of ['bf_alert_rules','bf_alert_sources','bf_alert_observations','bf_alert_episodes','bf_alert_transitions'])assert.ok(erased.stores.some(s=>s.store===store&&s.rows>0),store+' participates in source erasure')
  const listed=(await call('/alerts')).rules
  assert.ok(rules.every(rule=>!listed.some(r=>r.id===rule.id)))
  for(const rule of rules){await call('/alerts/'+rule.id,undefined,404);await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},404)}
  const receipt=JSON.stringify(await call('/erasure-receipts/'+erased.auditId))
  for(const value of [dataset,'synthetic-bifocal-163','synthetic-bifocal-164',rowsRule.title,'150.00','250.00'])assert.ok(!receipt.includes(value),'Erasure receipts retain no controlled alert values')
  await page.goto(origin+'/app/alerts/'+rowsRule.id);assert.equal(await page.getByRole('table').count(),0)
  await proveScreen('alerts-erased')
  console.log('Query alerts: browser authoring and follow-up, exact current-source predicates, typed order-independent comparison, duplicate rows and stable keys, deduplicated episodes, reset and recovery, quality and authority refusal, held erasure and source withdrawal passed')
 } finally {await clock.set(null)}
}
