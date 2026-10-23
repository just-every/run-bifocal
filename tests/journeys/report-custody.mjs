import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export async function proveReportCustody(origin,owner,reader,fixtures,page,expectedOutcome='development',edgeState=null){
 const call=async(path,data,expected=data===undefined?200:201,method=data===undefined?'GET':'POST')=>{
  const response=await owner.request.fetch(origin+'/api/operator'+path,{method,headers:{Origin:origin},...data===undefined?{}:{data}})
  assert.equal(response.status(),expected,await response.text());return response.json()
 }
 const ownerId=(await(await owner.request.get(origin+'/auth/session')).json()).operator.id
 await call('/calendars',{id:'synthetic-bifocal-report-year',previousVersion:null,definition:{name:'Reporting year',kind:'fiscal',startMonth:1}})
 const query={version:1,dataset:fixtures.dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'}],context:{modelVersion:'owner-model-v1',metricVersion:'owner-metric-v1',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-report-year',version:1},rounding:'half-even'}}
 const certifiedEntry={kind:'metric',title:'Revenue',description:'Human-certified native revenue definition',tags:['finance'],definition:{query:structuredClone(query)},sourceLinks:['/app/queries'],verified:true,collectionId:null,sourceDatasets:[fixtures.dataset]}
 const certified=await call('/library/items',certifiedEntry)
 query.context.metricVersion=certified.id+':1'
 const v1=await call('/queries/run',query)
 const references=new Map([[v1.queryId,{id:certified.id,version:1}]])
 const policy=await call('/report-runs/retention',{previousVersion:0,days:30,consent:true},200,'PUT')
 const series=await call('/report-runs/series',{period:'2026-W43'})
 const create=async(queryId,corrects=null,acceptStale=false,expected=201)=>call('/report-runs',{seriesId:series.id,queryId,title:'Weekly business review',narrative:'Human-authored review of current company revenue.',corrects,audience:[ownerId],acceptStale,retentionVersion:policy.version,metricRef:references.get(queryId)},expected)
 const first=await create(v1.queryId)
 await call('/report-runs/'+first.id+'/send',{digest:'0'.repeat(64),previousVersion:1},409)
 const rendered=await call('/report-runs/'+first.id+'/render',{},200)
 assert.equal(rendered.answer.totals.revenue.value,'300.00');assert.equal(rendered.metricVersion,certified.id+':1')
 assert.deepEqual(rendered.sourceCutoffs,v1.answer.sourceWatermarks);assert.deepEqual(rendered.filters,v1.definition.filters);assert.deepEqual(rendered.audience,[ownerId])
 await call('/report-runs/'+first.id+'/approve',{digest:'0'.repeat(64),previousVersion:2},409)
 const approved=await call('/report-runs/'+first.id+'/approve',{digest:rendered.digest,previousVersion:2},200)
 const originalSend=await call('/report-runs/'+first.id+'/send',{digest:rendered.digest,previousVersion:approved.version},200)
 assert.equal(originalSend.outcome,expectedOutcome);assert.equal(originalSend.delivered,false)
 await call('/report-runs/'+first.id+'/send',{digest:rendered.digest,previousVersion:approved.version},409)
 const firstLink=await call('/report-runs/'+first.id+'/download-link',{expiresAt:new Date(Date.now()+60000).toISOString()})
 const download=async(link)=>{const response=await owner.request.get(origin+link.url);assert.equal(response.status(),200,await response.text());assert.match(response.headers()['content-disposition'],/attachment/);return response.text()}
 const originalBytes=await download(firstLink)
 assert.equal(createHash('sha256').update(originalBytes).digest('hex'),rendered.digest)
 if(reader)assert.equal((await reader.request.get(origin+firstLink.url)).status(),403)
 const denied=await owner.request.get(origin+firstLink.url,{headers:{Cookie:''}});assert.equal(denied.status(),401)
 const expiring=await call('/report-runs/'+first.id+'/download-link',{expiresAt:new Date(Date.now()+1300).toISOString()})
 await new Promise(resolve=>setTimeout(resolve,1500));assert.equal((await owner.request.get(origin+expiring.url)).status(),410)
 const correctedQuery={...query,measures:[{...query.measures[0],column:'net_revenue'}],context:{...query.context,metricVersion:certified.id+':2'}}
 await call('/library/items/'+certified.id,{...certifiedEntry,previousVersion:1,definition:{query:correctedQuery}},200,'PUT')
 const v2=await call('/queries/run',correctedQuery)
 references.set(v2.queryId,{id:certified.id,version:2})
 await create(v2.queryId,null,false,409)
 const second=await create(v2.queryId,first.id),corrected=await call('/report-runs/'+second.id+'/render',{},200)
 assert.equal(corrected.corrects,first.id);assert.equal(corrected.period,rendered.period);assert.equal(corrected.revision,2)
 assert.equal(corrected.answer.totals.revenue.value,'270.00');assert.notEqual(corrected.definitionVersions.metrics.revision,rendered.definitionVersions.metrics.revision)
 const correctedApproval=await call('/report-runs/'+second.id+'/approve',{digest:corrected.digest,previousVersion:2},200)
 assert.equal((await call('/report-runs/'+second.id+'/send',{digest:corrected.digest,previousVersion:correctedApproval.version},200)).outcome,expectedOutcome)
 assert.equal(await download(firstLink),originalBytes,'correction never rewrites the original received artifact')
 const secondLink=await call('/report-runs/'+second.id+'/download-link',{expiresAt:new Date(Date.now()+60000).toISOString()})
 assert.notEqual(await download(secondLink),originalBytes)
 const originalFacts=(await call('/report-runs/'+first.id)).dispatches
 assert.equal(originalFacts.length,1);assert.equal(originalFacts[0].artifact_digest,rendered.digest)
 if(edgeState){assert.equal(edgeState.messages.length,2);assert.equal(Buffer.from(edgeState.messages[0].attachments[0].content,'base64').toString(),originalBytes);assert.equal(edgeState.messages[1].subject,'Correction: Weekly business review')}
 if(page)for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/queries/'+v1.queryId)
  await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor()
  assert.match(await page.locator('#totals').innerText(),/300\.00/)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/report-original-'+width+'.png',fullPage:true})
  await page.goto(origin+'/app/queries/'+v2.queryId);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor()
  assert.match(await page.locator('#totals').innerText(),/270\.00/)
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/report-corrected-'+width+'.png',fullPage:true})
 }
 // Replacing the current source makes an old answer stale, never silently fresh.
 const updated=await fixtures.replace();fixtures.revision=updated.revision
 await create(v2.queryId,second.id,false,409)
 const stale=await create(v2.queryId,second.id,true),staleArtifact=await call('/report-runs/'+stale.id+'/render',{},200)
 assert.equal(staleArtifact.freshness,'stale');assert.match(staleArtifact.staleLabel,/Stale snapshot/)
 const queued=await create(v2.queryId,stale.id,true)
 return {firstId:first.id,queuedId:queued.id,originalFacts,firstLink,async erased(){
  const historical=await call('/report-runs/'+first.id)
  assert.equal(historical.artifact,null);assert.deepEqual(historical.dispatches,originalFacts)
  assert.equal((await call('/report-runs/'+queued.id)).state,'cancelled')
  await call('/report-runs/'+queued.id+'/render',{},409)
  assert.equal((await owner.request.get(origin+firstLink.url)).status(),410)
  if(expectedOutcome==='accepted')assert.match(historical.externalCopies,/cannot be recalled/)
  console.log('Report custody: immutable dated original/correction, exact current owner approval, '+expectedOutcome+' transport fact, current-session expiring downloads, stale labels, queued-render erasure and preserved historical dispatch facts passed')
 }}
}
