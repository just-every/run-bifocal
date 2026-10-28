import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

/** Totals are part of a grouped result even when each displayed group is unchanged. */
export async function proveAlertTotals({call,upload,calendar,page,origin,proveScreen}) {
 const dataset='synthetic-bifocal-171'
 const csv='region,numerator,denominator,score,weight\n'
 await upload(dataset,csv+'West,1,1,1,1\nEast,2,1,2,1\n')
 const qualityId='synthetic-bifocal-177'
 await call('/quality/rules',{id:qualityId,dataset,definition:{name:'Regional denominator present',kind:'not-null',column:'denominator'}})
 const healthy=async()=>assert.equal((await call('/quality/rules/'+qualityId+'/run',{})).result.state,'passed')
 await healthy()
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[
  {id:'ratio',op:'ratio',numerator:'numerator',denominator:'denominator',unit:'number',scale:2},
  {id:'weighted',op:'weighted-average',column:'score',weight:'weight',unit:'number',scale:2},
 ],context:{modelVersion:'synthetic-bifocal-173',metricVersion:'synthetic-bifocal-174',accountingBasis:'not-applicable',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const saved=await call('/queries/run',query),rules=[]
 for(const comparison of [{kind:'multiset'},{kind:'stable-key',columns:['region']}]) {
  const {rule}=await call('/alerts',{title:'Regional ratio and weighted results '+comparison.kind,queryId:saved.queryId,predicate:{kind:'results-changed'},comparison,behavior:'edge',baseline:'first-observation'})
  const baseline=await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},200)
  assert.equal(baseline.observation.baseline,true)
  for(const measure of ['ratio','weighted'])assert.equal(baseline.observation.answer.totals[measure].value,'1.50')
  rules.push(rule)
 }
 await upload(dataset,csv+'West,9,9,1,9\nEast,2,1,2,1\n',true);await healthy()
 for(const rule of rules) {
  const changed=await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},200)
  assert.deepEqual(changed.observation.answer.rows,saved.answer.rows,'Group values remain unchanged while the total changes')
  for(const measure of ['ratio','weighted'])assert.equal(changed.observation.answer.totals[measure].value,'1.10')
  assert.equal(changed.observation.triggered,true,'A total-only grouped result change opens an episode')
  assert.equal(changed.episode.state,'open')
 }
 await page.goto(origin+'/app/alerts/'+rules[0].id)
 await page.getByRole('heading',{name:rules[0].title,exact:true}).waitFor()
 await proveScreen('alerts-total-change')
 // Equivalent numeric cells and incidental order do not produce another change.
 await upload(dataset,csv+'East,2.0,1.0,2.0,1.0\nWest,9.0,9.0,1.0,9.0\n',true);await healthy()
 for(const rule of rules) {
  const unchanged=await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},200)
  assert.equal(unchanged.observation.triggered,false)
  assert.equal(unchanged.observation.qualifying,false)
  assert.equal(unchanged.episode.state,'closed')
  assert.equal((await call('/alerts/'+rule.id)).episodes.filter(episode=>episode.state==='open').length,0)
 }
}

/** First-import Undo removes a source and must obey its retained alert custody. */
export async function proveHeldAlertUndo({call,upload,calendar,clock,owner,origin}) {
 const dataset='synthetic-bifocal-172'
 await upload(dataset,'id,amount\n1,10\n')
 const qualityId='synthetic-bifocal-178'
 await call('/quality/rules',{id:qualityId,dataset,definition:{name:'Retained amount present',kind:'not-null',column:'amount'}})
 assert.equal((await call('/quality/rules/'+qualityId+'/run',{})).result.state,'passed')
 const saved=await call('/queries/run',{version:1,dataset,joins:[],filters:[],groupBy:[],measures:[{id:'amount',op:'sum',column:'amount',unit:'number',scale:2}],context:{modelVersion:'synthetic-bifocal-175',metricVersion:'synthetic-bifocal-176',accountingBasis:'not-applicable',calendar:{id:calendar,version:1},rounding:'half-even'}})
 const {rule}=await call('/alerts',{title:'Retained first source',queryId:saved.queryId,predicate:{kind:'rows-exist'},comparison:{kind:'multiset'},behavior:'edge',baseline:'first-observation'})
 const evaluate=()=>call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},200)
 await evaluate()
 const open=await evaluate();assert.equal(open.episode.state,'open')
 await call('/alerts/'+rule.id+'/acknowledge',{episodeId:open.episode.id},200)
 const source=await call('/datasets/'+dataset),before=await call('/alerts/'+rule.id)
 assert.ok(before.observations.length>0&&before.episodes.length>0&&before.transitions.length>0)
 const history=await owner.request.get(origin+'/api/operator/import/history',{headers:{'X-Import-Dataset':dataset}})
 assert.equal(history.status(),200)
 const planId=(await history.json()).history[0].planId
 const undo=()=>owner.request.post(origin+'/api/operator/import/undo',{headers:{Origin:origin,'X-Import-Dataset':dataset},data:{planId}})
 let previousRevision=null
 for(const protection of [{legalHold:true,minimumRetainUntil:null},{legalHold:false,minimumRetainUntil:new Date(clock.now()+86400000).toISOString()}]) {
  const policy=await call('/retention/'+dataset,{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,...protection,releaseHold:true},200,'PUT')
  previousRevision=policy.revision
  await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},423)
  const refused=await undo()
  assert.equal(refused.status(),409,'Held first-import Undo must refuse source deletion')
  assert.deepEqual(await call('/datasets/'+dataset),source,'Held Undo retains the exact source')
  assert.deepEqual(await call('/alerts/'+rule.id),before,'Held Undo retains observations, episodes and transitions')
 }
 await call('/retention/'+dataset,{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,legalHold:false,minimumRetainUntil:null,releaseHold:true},200,'PUT')
 const allowed=await undo();assert.equal(allowed.status(),200,await allowed.text())
 assert.equal((await allowed.json()).job.state,'undone')
 await call('/datasets/'+dataset,undefined,404)
 await call('/alerts/'+rule.id,undefined,404)
 await call('/alerts/'+rule.id+'/evaluate',{requestId:randomUUID()},404)
 console.log('Alert data: total-only ratio and weighted changes trigger; held first-import Undo preserves source and all alert values until explicit release')
}
