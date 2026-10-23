import assert from 'node:assert/strict'
export async function proveQualityLineage({origin,context,page,call,upload,dataset,good,us,proveScreen,report,dashboard}) {
 const rules=[['synthetic-bifocal-key',{name:'Invoice identity',kind:'unique',column:'invoice'}],['synthetic-bifocal-fresh',{name:'Recent source',kind:'freshness',maxAgeSeconds:60}],['synthetic-bifocal-null',{name:'Customer required',kind:'not-null',column:'customer'}],['synthetic-bifocal-state',{name:'Recognized state',kind:'accepted-values',column:'state',values:['active','inactive']}],['synthetic-bifocal-count',{name:'Expected rows',kind:'count',expected:'3'}],['synthetic-bifocal-money',{name:'Revenue control total',kind:'money',column:'revenue',expected:'30.00'}]]
 for(const [id,definition] of rules)await call('/quality/rules',{id,dataset,definition})
 assert.equal((await call('/reports/'+report.id)).quality.state,'unknown')
 for(const [id] of rules){const r=await call('/quality/rules/'+id+'/run',{});assert.equal(r.result.state,'passed')}
 const impact=await call('/quality/impact/'+dataset+'?column=customer');assert.ok(impact.artifacts.some(a=>a.id===report.id));assert.ok(impact.metrics.some(m=>m.id==='synthetic-bifocal-customers'))
 const failedData=`invoice,date,customer,revenue,state\n1,${us},c1,$10.01,active\n1,${us},c1,$20.02,active\n3,${us},c2,-$0.03,inactive\n`
 await upload(failedData,true,{kind:'revenue-table',link:'https://warehouse.example.com/source',description:'Synthetic dated source extract',from:'2026-01-01',to:'2027-01-01',timezone:'America/New_York',observedAt:'2000-01-01T00:00:00.000Z',schema:'Synthetic source schema'})
 assert.equal((await call('/reports/'+report.id)).quality.state,'unknown')
 const stale=await call('/goals/synthetic-bifocal-revenue-goal');assert.equal(stale.actual.state,'stale');assert.equal(stale.actual.status,'unknown');assert.equal(stale.actual.forecast,null);assert.equal(stale.definition.target,'1200.00');await proveScreen('/app/goals/synthetic-bifocal-revenue-goal','goal-stale')
 const key=await call('/quality/rules/synthetic-bifocal-key/run',{});assert.equal(key.result.state,'failed');assert.deepEqual(key.result.failingRowNumbers,[2])
 const fresh=await call('/quality/rules/synthetic-bifocal-fresh/run',{});assert.equal(fresh.result.state,'failed')
 for(const path of ['/reports/'+report.id,'/dashboards/'+dashboard.id]){const a=await call(path);assert.equal(a.quality.state,'at risk');assert.equal(a.answer.totals.customers.value,'1');assert.ok(a.quality.tests.some(t=>t.ruleId==='synthetic-bifocal-key'&&t.runId===key.id))}
 const until=new Date(Date.now()+2500).toISOString()
 await call('/quality/runs/'+key.id+'/waive',{reason:'Reviewed temporary exception',expiresAt:until,confirm:'waive'})
 let q=await call('/quality');assert.ok(q.quality.tests.find(t=>t.runId===key.id).waiver.active);assert.equal(q.quality.state,'at risk')
 await call('/quality/runs/'+fresh.id+'/waive',{reason:'Expired',expiresAt:'2000-01-01T00:00:00.000Z',confirm:'waive'},400)
 await proveScreen('/app/quality','quality-failed')
 for(const [kind,id] of [['reports',report.id],['dashboards',dashboard.id]]){await page.goto(origin+'/app/'+kind+'/'+id);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();assert.match(await page.locator('#certification').innerText(),/Quality at risk/);await proveScreen('/app/'+kind+'/'+id,'quality-'+kind)}
 await new Promise(r=>setTimeout(r,2600))
 q=await call('/quality');assert.equal(q.quality.tests.find(t=>t.runId===key.id).waiver.active,false)
 assert.equal((await context.request.get(origin+'/api/operator/quality',{headers:{Cookie:''}})).status(),401)
 await upload(good,true)
 for(const [id] of rules)await call('/quality/rules/'+id+'/run',{})
 q=await call('/quality');assert.equal(q.quality.state,'healthy');assert.ok(q.histories.some(r=>r.result.state==='failed'));assert.ok(q.histories.some(r=>r.result.state==='passed'))
 await proveScreen('/app/quality','quality-repaired')
 console.log('Quality and lineage: six rule types, duplicate and freshness failures, immutable at-risk results, column impact, expiring reviewed waiver, repaired-input history and denied raw reads passed')
}
