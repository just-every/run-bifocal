import assert from 'node:assert/strict'
import {proveReportReviewers} from './report-reviewers.mjs'
import { createHash,createHmac } from 'node:crypto'
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
 const arbitraryLabel=await call('/queries/run',{...query,context:{...query.context,metricVersion:'synthetic-bifocal-999'}})
 references.set(arbitraryLabel.queryId,{id:certified.id,version:1})
 const refusedLabel=await create(arbitraryLabel.queryId,null,false,409)
 assert.equal(refusedLabel.error,'certified_metric_query_mismatch')
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
 if(reader)assert.equal((await reader.request.get(origin+firstLink.url)).status(),404)
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
 const correctedBytes=await download(secondLink);assert.notEqual(correctedBytes,originalBytes)
 const originalFacts=(await call('/report-runs/'+first.id)).dispatches
 assert.equal(originalFacts.length,1);assert.equal(originalFacts[0].artifact_digest,rendered.digest)
 const reviewers=reader?await proveReportReviewers(origin,owner,reader,{first,second,firstLink,originalBytes,correctedBytes,originalFacts,queryId:v2.queryId,metricRef:references.get(v2.queryId),policyVersion:policy.version,ownerId,dataset:fixtures.dataset},call):null
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
  await reviewers?.erased()
  const historical=await call('/report-runs/'+first.id)
  assert.equal(historical.artifact,null);assert.deepEqual(historical.dispatches,originalFacts)
  assert.equal((await call('/report-runs/'+queued.id)).state,'cancelled')
  await call('/report-runs/'+queued.id+'/render',{},409)
  assert.equal((await owner.request.get(origin+firstLink.url)).status(),410)
  if(expectedOutcome==='accepted')assert.match(historical.externalCopies,/cannot be recalled/)
  console.log('Report custody: immutable dated original/correction, exact current owner approval, '+expectedOutcome+' transport fact, current-session expiring downloads, stale labels, queued-render erasure and preserved historical dispatch facts passed')
 }}
}

/** Actual native authoring, immutable files and withdrawal through public doors. */
export async function proveNativeReportAuthoring({origin,context,page,upload,proveScreen,reader=null,directory,nativeSessionProof=false}){
 const {unzipSync,strFromU8}=await import('fflate'),{DOMParser}=await import('@xmldom/xmldom')
 const {execFileSync}=await import('node:child_process'),{writeFile,mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const root='/api/operator/report-authoring',headers={Origin:origin}
 const call=async(path,data,expected=data===undefined?200:201,method=data===undefined?'GET':'POST')=>{const response=await context.request.fetch(origin+path,{method,headers,...data===undefined?{}:{data}});assert.equal(response.status(),expected,await response.text());return response.json()}
 const dataset='synthetic-bifocal-native-report',calendar='synthetic-bifocal-native-report-year'
 const csv='invoice,region,amount,units,active\n1,East,10,2,true\n2,East,-4,2,false\n3,East,0,1,true\n4,East,,3,false\n'+Array.from({length:40},(_,i)=>(i+5)+',East,0,1,true\n').join('')+'45,West,20,4,true\n'
 await upload(dataset,csv)
 await call('/api/operator/calendars',{id:calendar,previousVersion:null,definition:{name:'Native reporting year',kind:'fiscal',startMonth:1}})
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region','invoice'],measures:[{id:'amount',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD'},{id:'rate',op:'ratio',numerator:'amount',denominator:'units',unit:'number',scale:4},{id:'weighted',op:'weighted-average',column:'amount',weight:'units',unit:'number',scale:4}],context:{modelVersion:'native-report-source',metricVersion:'native-report-source',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const snapshot=await call('/api/operator/queries/run',query)
 let definition={version:1,queryId:snapshot.queryId,title:'Regional operating statement',header:'October operations',footer:'Reviewed internal statement',groupBy:'region',pageBreakGroups:true,parameters:[]}
 const draft={definition,reportId:null,previousVersion:0}
 const review=await call(root+'/review',draft,200)
 assert.equal(review.manifest.snapshot.queryId,snapshot.queryId);assert.equal(review.manifest.snapshot.digest,snapshot.digest);assert.deepEqual(review.manifest.query,snapshot.definition);assert.deepEqual(review.manifest.sourceWatermarks,snapshot.answer.sourceWatermarks);assert.deepEqual(review.manifest.context.securityScope,snapshot.context.securityScope)
 assert.equal(review.manifest.answer.totals.amount.value,'26.00');assert.equal(review.manifest.answer.totals.rate.value,'0.5306');assert.equal(review.manifest.answer.totals.weighted.value,'1.8776')
 assert.deepEqual(review.manifest.groups.map(group=>[group.value,group.values.amount.value,group.values.rate.value,group.values.weighted.value]),[['East','6.00','0.1333','0.2667'],['West','20.00','5.0000','20.0000']]);assert.equal(review.manifest.answer.totals.amount.nulls,1)
 assert.ok(review.pages.length>=3,'Dense East group continues before an explicit West page break')
 const render=review=>({definition:review.definition,reportId:review.reportId,previousVersion:review.previousVersion,reviewedDigest:review.digest,expiresAt:review.expiresAt})
 await call(root+'/render',{...render(review),reviewedDigest:'0'.repeat(64)},409)
 await call(root+'/render',{...render(review),definition:{...review.definition,parameters:[{column:'region',value:'West'}]}},409)
 assert.equal((await context.request.post(origin+root+'/review',{headers:{Origin:'https://invalid.example.test'},data:draft})).status(),401)
 assert.equal((await fetch(origin+root+'/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify(draft)})).status,401)
 assert.equal((await context.request.post(origin+root+'/review',{headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-1',Cookie:''},data:draft})).status(),401)
 if(reader){assert.equal((await reader.request.post(origin+root+'/review',{headers,data:draft})).status(),403);assert.equal((await reader.request.get(origin+'/app/report-editor')).status(),403)}
 await page.goto(origin+'/app/queries/'+snapshot.queryId);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();await proveScreen('native-report-answer-entry');await page.getByRole('link',{name:'Printable reports',exact:true}).click();await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor()
 await page.getByLabel('Query snapshot',{exact:true}).selectOption(snapshot.queryId);await page.getByLabel('Report title',{exact:true}).fill(definition.title);await page.getByLabel('Page header',{exact:true}).fill(definition.header);await page.getByLabel('Page footer',{exact:true}).fill(definition.footer);await page.getByLabel('Subtotal group',{exact:true}).selectOption('region');await page.getByLabel('Start each group on a new page',{exact:true}).check()
 const [browserReview]=await Promise.all([page.waitForResponse(response=>response.url().endsWith(root+'/review')),page.getByRole('button',{name:'Review printable report',exact:true}).click()]);assert.equal(browserReview.status(),200,await browserReview.text());await page.getByRole('status').filter({hasText:'Review the exact parameters'}).waitFor();assert.match(await page.locator('#native-summary').innerText(),/amount 26\.00.*rate 0\.5306.*weighted 1\.8776/);await proveScreen('native-report-review')
 await page.getByLabel('I reviewed these exact parameters, totals and pages',{exact:true}).check()
 const [savedResponse]=await Promise.all([page.waitForResponse(response=>response.url().endsWith(root+'/render')),page.getByRole('button',{name:'Save and render reviewed report',exact:true}).click()]);assert.equal(savedResponse.status(),201,await savedResponse.text());const saved=await savedResponse.json();await page.getByRole('status').filter({hasText:'Reviewed report retained'}).waitFor();await proveScreen('native-report-retained')
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));const settings=page.locator('.topbar .menu > summary');await settings.focus();await page.getByRole('tooltip',{name:'Open settings',exact:true}).waitFor({state:'visible'});if(directory)await writeFile(join(directory,'native-report-tooltip-'+width+'.png'),await page.screenshot({fullPage:false}));await page.locator('#native-title').focus();await settings.hover();await page.getByRole('tooltip',{name:'Open settings',exact:true}).waitFor({state:'visible'})}
 const artifacts={}
 for(const format of ['pdf','xlsx','csv']){const response=await context.request.get(origin+root+'/runs/'+saved.runId+'/'+format);assert.equal(response.status(),200,await response.text());assert.equal(response.headers()['cache-control'],'no-store');assert.match(response.headers()['content-disposition'],new RegExp('\\.'+format));artifacts[format]=await response.body();assert.equal(createHash('sha256').update(artifacts[format]).digest('hex'),saved.manifest.artifacts[format]);if(directory)await writeFile(join(directory,'native-report.'+format),artifacts[format]);if(reader)assert.equal((await reader.request.get(origin+root+'/runs/'+saved.runId+'/'+format)).status(),403)}
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const format of ['pdf','xlsx','csv']){const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download '+format.toUpperCase(),exact:true}).click()]);assert.equal(await download.failure(),null);const file=await download.path();assert.deepEqual(await (await import('node:fs/promises')).readFile(file),artifacts[format])}}
 if(nativeSessionProof)await proveNativeReportRevocation({origin,context,root,runId:saved.runId})
 const scratch=await mkdtemp(join(tmpdir(),'bifocal-native-report-inspect-'))
 try{
  await writeFile(join(scratch,'report.pdf'),artifacts.pdf)
  const text=execFileSync('pdftotext',['-layout',join(scratch,'report.pdf'),'-'],{encoding:'utf8'})
  assert.match(text,/Regional operating statement/);assert.match(text,/Grand total/);assert.match(text,/26\.00/);assert.match(text,/0\.5306/);assert.match(text,/1\.8776/);assert.match(text,/NULL/);assert.equal((text.match(/Detail/g)??[]).length,45,'Every detail row is printed once')
  const bbox=execFileSync('pdftotext',['-bbox',join(scratch,'report.pdf'),'-'],{encoding:'utf8'}),pdfPages=Array.from(bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g))
  assert.equal(pdfPages.length,saved.manifest.pages.length);assert.match(pdfPages[0][3],/East/);assert.match(pdfPages[1][3],/East/);assert.match(pdfPages[2][3],/West/);assert.ok(!pdfPages[2][3].includes('East'),'The explicit West group starts on its own page')
  for(const [i,p] of pdfPages.entries()){assert.equal(Number(p[1]),612);assert.equal(Number(p[2]),792);assert.match(p[3],/October/);assert.match(p[3],/invoice/);assert.match(p[3],/amount/);assert.match(p[3],new RegExp('>'+String(i+1)+'<'));for(const word of p[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)){assert.ok(Number(word[1])>=30&&Number(word[2])>=20&&Number(word[3])<=582&&Number(word[4])<=772,'PDF text stays inside page margins')}}
 }finally{await rm(scratch,{recursive:true,force:true})}
 const zipped=unzipSync(artifacts.xlsx);assert.equal(JSON.parse(strFromU8(zipped['bifocal-provenance.json'])).snapshot.digest,snapshot.digest);assert.ok(artifacts.pdf.includes(Buffer.from(snapshot.digest)),'The PDF retains its exact source-query provenance');const parse=value=>new DOMParser().parseFromString(strFromU8(value),'application/xml'),sheet=parse(zipped['xl/worksheets/sheet1.xml']),cells=Array.from(sheet.getElementsByTagName('c'))
 const workbookRows=Array.from(sheet.getElementsByTagName('row')).map(row=>Object.fromEntries(Array.from(row.getElementsByTagName('c')).map(cell=>[cell.getAttribute('r').replace(/\d/g,''),cell])))
 const amountRow=invoice=>workbookRows.find(row=>row.A?.textContent==='Detail'&&row.C?.textContent===invoice)
 assert.equal(amountRow('4').D.getElementsByTagName('v').length,0,'NULL amount is a blank Excel cell, distinct from numeric zero');assert.equal(amountRow('3').D.textContent,'0.00');assert.equal(amountRow('2').D.textContent,'-4.00');assert.equal(workbookRows.filter(row=>row.A?.textContent==='Detail').length,45)
 const grand=workbookRows.find(row=>row.A?.textContent==='Grand total'),east=workbookRows.find(row=>row.A?.textContent==='Subtotal'&&row.B?.textContent==='East');assert.deepEqual([grand.D.textContent,grand.E.textContent,grand.F.textContent],['26.00','0.5306','1.8776']);assert.deepEqual([east.D.textContent,east.E.textContent,east.F.textContent],['6.00','0.1333','0.2667'])
 assert.ok(cells.some(cell=>cell.getAttribute('t')!=='inlineStr'&&cell.getElementsByTagName('v')[0]?.textContent==='26.00'),'Excel grand total is a numeric cell')
 assert.ok(cells.some(cell=>cell.getAttribute('t')!=='inlineStr'&&cell.getElementsByTagName('v')[0]?.textContent==='-4.00'),'Excel preserves negative numeric detail')
 assert.ok(cells.some(cell=>cell.getAttribute('t')!=='inlineStr'&&cell.getElementsByTagName('v')[0]?.textContent==='0.00'),'Excel preserves zero numeric detail')
 assert.ok(cells.some(cell=>cell.getAttribute('t')==='inlineStr'&&cell.textContent==='East'),'Excel text dimensions stay text')
 assert.match(artifacts.csv.toString(),/Grand total/);assert.match(artifacts.csv.toString(),/26\.00/)
 const nextDefinition={...definition,title:'Corrected native statement',parameters:[{column:'region',value:'West'}]},secondReview=await call(root+'/review',{definition:nextDefinition,reportId:saved.id,previousVersion:saved.version},200)
 assert.equal(secondReview.manifest.answer.rows.length,1);assert.equal(secondReview.manifest.answer.totals.amount.value,'20.00');assert.equal(secondReview.manifest.answer.totals.rate.value,'5.0000');assert.equal(secondReview.manifest.answer.totals.weighted.value,'20.0000')
 await page.getByLabel('Report title',{exact:true}).fill(nextDefinition.title);await page.getByLabel('Bound parameters (JSON)',{exact:true}).fill(JSON.stringify(nextDefinition.parameters));await page.getByRole('button',{name:'Review printable report',exact:true}).click();await page.getByRole('status').filter({hasText:'Review the exact parameters'}).waitFor();assert.match(await page.locator('#native-summary').innerText(),/amount 20\.00.*rate 5\.0000.*weighted 20\.0000/);await page.getByLabel('I reviewed these exact parameters, totals and pages',{exact:true}).check();const [correctionResponse]=await Promise.all([page.waitForResponse(response=>response.url().endsWith(root+'/render')),page.getByRole('button',{name:'Save and render reviewed report',exact:true}).click()]);assert.equal(correctionResponse.status(),201,await correctionResponse.text());const second=await correctionResponse.json();await page.getByRole('status').filter({hasText:'Reviewed report retained'}).waitFor();await proveScreen('native-report-filtered')
 await call(root+'/render',render(secondReview),409)
 for(const format of ['pdf','xlsx','csv'])assert.deepEqual(await(await context.request.get(origin+root+'/runs/'+saved.runId+'/'+format)).body(),artifacts[format],'A later revision never changes prior bytes')
 await page.goto(origin+'/app/report-editor?report='+saved.id);await page.getByRole('status').filter({hasText:'Loaded retained revision 2'}).waitFor();await page.getByRole('button',{name:'Inspect revision 1',exact:true}).click();await page.getByRole('status').filter({hasText:'Loaded retained revision 1'}).waitFor();assert.match(await page.locator('#native-summary').innerText(),/26\.00/);await proveScreen('native-report-historical')
 await proveNativeReportLimits({call,upload,root,definition,query})
 const stale=await call(root+'/review',{definition,reportId:saved.id,previousVersion:second.version},200);await upload(dataset,csv.replace(',West,20,4,true',',West,21,4,true'),true);await call(root+'/render',render(stale),409)
 await page.getByRole('button',{name:'Review printable report',exact:true}).click();await page.getByRole('status').filter({hasText:'Source data changed'}).waitFor();await proveScreen('native-report-stale-refusal')
 const typed=await proveNativeReportTypes({origin,context,call,upload,root,definition,query,render,reportId:saved.id,previousVersion:second.version})
 const typedSource=await call('/api/operator/datasets/'+typed.dataset),typedHold=await call('/api/operator/retention/'+typed.dataset,{confirmDataset:typed.dataset,reviewedDatasetRevision:typedSource.revision,previousRevision:null,legalHold:true,minimumRetainUntil:null,releaseHold:false},200,'PUT')
 const sourceBeforeErase=await call('/api/operator/datasets/'+dataset)
 await call('/api/operator/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:sourceBeforeErase.revision},423)
 assert.equal((await context.request.get(origin+root+'/runs/'+typed.saved.runId+'/pdf')).status(),200,'Another protected source in report history prevents erasing its controlled copies')
 await call('/api/operator/retention/'+typed.dataset,{confirmDataset:typed.dataset,reviewedDatasetRevision:typedSource.revision,previousRevision:typedHold.revision,legalHold:false,minimumRetainUntil:null,releaseHold:true},200,'PUT')
 const current=await call('/api/operator/datasets/'+dataset),retention={confirmDataset:dataset,reviewedDatasetRevision:current.revision,previousRevision:null,legalHold:true,minimumRetainUntil:null,releaseHold:false}
 let policy=await call('/api/operator/retention/'+dataset,retention,200,'PUT')
 await call('/api/operator/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},423)
 assert.equal((await context.request.get(origin+root+'/runs/'+saved.runId+'/pdf')).status(),200,'A legal hold preserves the report')
 policy=await call('/api/operator/retention/'+dataset,{...retention,previousRevision:policy.revision,legalHold:false,minimumRetainUntil:new Date(Date.now()+86400000).toISOString(),releaseHold:true},200,'PUT')
 await call('/api/operator/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},423)
 await call('/api/operator/retention/'+dataset,{...retention,previousRevision:policy.revision,legalHold:false,releaseHold:true},200,'PUT')
 const erased=await call('/api/operator/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
 for(const store of ['bf_native_reports','bf_native_report_revisions','bf_native_report_runs','bf_native_report_artifacts','bf_native_report_audit'])assert.ok(erased.stores.some(row=>row.store===store&&row.rows>0),store+' is included in controlled erasure')
 await call(root+'/'+saved.id,undefined,404);for(const runId of [saved.runId,second.runId,typed.saved.runId])for(const format of ['pdf','xlsx','csv'])assert.equal((await context.request.get(origin+root+'/runs/'+runId+'/'+format)).status(),404)
 await call(root+'/render',render(stale),404)
 await page.reload();await page.getByRole('status').filter({hasText:'This report was withdrawn'}).waitFor();await proveScreen('native-report-withdrawn')
 console.log('Native reports: reviewed typed query parameters, grouped and recomputed nonadditive totals, Letter continuation and explicit breaks, independent PDF and typed Excel inspection, immutable prior files, stale and concurrent refusal, owner-only access and retention-protected controlled erasure passed')
}

async function proveNativeReportLimits({call,upload,root,definition,query}){
 const before=(await call(root)).reports.length
 const pages=await call(root+'/review',{definition:{...definition,groupBy:'invoice',pageBreakGroups:true},reportId:null,previousVersion:0},422)
 assert.equal(pages.error,'native_report_page_limit')
 const dataset='synthetic-bifocal-native-report-limits'
 await upload(dataset,'invoice,amount\n'+Array.from({length:2001},(_,i)=>(i+1)+',1\n').join(''))
 const oneMeasure={...query,dataset,groupBy:['invoice'],measures:[{id:'amount',op:'sum',column:'amount',unit:'number',scale:2}]},rows=await call('/api/operator/queries/run',oneMeasure)
 const base={...definition,groupBy:null,pageBreakGroups:false,queryId:rows.queryId}
 assert.equal((await call(root+'/review',{definition:base,reportId:null,previousVersion:0},422)).error,'native_report_result_row_limit')
 const dense=await call('/api/operator/queries/run',{...oneMeasure,filters:[{column:'invoice',op:'lte',value:'400'}],measures:Array.from({length:11},(_,i)=>({id:String.fromCharCode(97+i),op:'sum',column:'amount',unit:'number',scale:2}))})
 assert.equal((await call(root+'/review',{definition:{...base,queryId:dense.queryId},reportId:null,previousVersion:0},422)).error,'native_report_pdf_byte_limit')
 assert.equal((await call(root)).reports.length,before,'Overflow refuses the whole report without retaining a truncated run')
 const current=await call('/api/operator/datasets/'+dataset);await call('/api/operator/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
}

async function proveNativeReportTypes({origin,context,call,upload,root,definition,query,render,reportId,previousVersion}){
 const {unzipSync,strFromU8}=await import('fflate'),{DOMParser}=await import('@xmldom/xmldom')
 const dataset='synthetic-bifocal-native-report-types'
 await upload(dataset,'invoice,region,amount,units,active,date\n1,=2+2,7.25,2,true,10/01/2026\n2,=2+2,,3,false,10/02/2026\n3,,0,0,true,10/03/2026\n')
 const snapshot=await call('/api/operator/queries/run',{...query,dataset,groupBy:['region','active','date','invoice'],measures:[{id:'amount',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD'}]})
 const typed={...definition,queryId:snapshot.queryId,groupBy:'region',pageBreakGroups:true,parameters:[{column:'active',value:true}]}
 const review=await call(root+'/review',{definition:typed,reportId,previousVersion},200)
 assert.equal(review.manifest.answer.rows.length,2);assert.equal(review.manifest.answer.totals.amount.value,'7.25')
 const saved=await call(root+'/render',render(review))
 const xlsx=await context.request.get(origin+root+'/runs/'+saved.runId+'/xlsx'),zip=unzipSync(await xlsx.body()),xml=new DOMParser().parseFromString(strFromU8(zip['xl/worksheets/sheet1.xml']),'application/xml'),cells=Array.from(xml.getElementsByTagName('c'))
 assert.ok(cells.some(cell=>cell.getAttribute('t')==='b'&&cell.textContent==='1'),'Boolean dimensions remain typed booleans')
 assert.ok(cells.some(cell=>cell.getAttribute('t')==='d'&&cell.textContent==='2026-10-01'),'Date dimensions remain typed dates')
 assert.ok(cells.some(cell=>cell.getAttribute('t')==='n'&&cell.textContent==='1'),'Numeric dimensions remain numeric')
 assert.ok(cells.some(cell=>cell.getAttribute('t')==='inlineStr'&&cell.textContent==='=2+2'),'Formula-shaped source text stays inert text')
 assert.equal(xml.getElementsByTagName('f').length,0)
 const csv=await context.request.get(origin+root+'/runs/'+saved.runId+'/csv');assert.match(await csv.text(),/"'=2\+2"/)
 const missing=await call(root+'/review',{definition:{...typed,parameters:[{column:'region',value:null}]},reportId,previousVersion:saved.version},200);assert.equal(missing.manifest.answer.rows.length,1);assert.equal(missing.manifest.answer.totals.amount.value,'0.00')
 const empty=await call(root+'/review',{definition:{...typed,parameters:[{column:'region',value:"West' OR '1'='1"}]},reportId,previousVersion:saved.version},200);assert.equal(empty.manifest.answer.rows.length,0);assert.equal(empty.manifest.answer.totals.amount.state,'null')
 for(const parameter of [{column:'active',value:'true'},{column:'date',value:'10/01/2026'},{column:'invoice',value:'1 OR 1=1'}])assert.equal((await call(root+'/review',{definition:{...typed,parameters:[parameter]},reportId,previousVersion:saved.version},422)).error,'filter_value_type_mismatch')
 return {dataset,saved}
}

async function proveNativeReportRevocation({origin,context,root,runId}){
 const secondary=await context.browser().newContext()
 try{
  const proof=createHmac('sha256','synthetic-bifocal-2'.repeat(3)).update('local-cli'+String.fromCharCode(0)+'sign-in').digest('hex')
  assert.equal((await secondary.request.post(origin+'/auth/local/cli-session',{headers:{Origin:origin,'x-rer-local-cli':proof},data:{returnTo:'/app'},maxRedirects:0})).status(),303)
  const session=await(await secondary.request.get(origin+'/auth/session')).json()
  assert.equal((await secondary.request.get(origin+root+'/runs/'+runId+'/pdf')).status(),200)
  assert.equal((await context.request.post(origin+'/auth/session/revoke',{headers:{Origin:origin},data:{sessionId:session.id}})).status(),204)
  for(const format of ['pdf','xlsx','csv'])assert.equal((await secondary.request.get(origin+root+'/runs/'+runId+'/'+format)).status(),401,'A revoked native credential cannot read retained report bytes')
  assert.equal((await context.request.get(origin+root+'/runs/'+runId+'/pdf')).status(),200,'Revoking one session preserves the other current owner session')
 }finally{await secondary.close()}
}
