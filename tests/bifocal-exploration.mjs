import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {unzipSync,strFromU8} from 'fflate'
import {DOMParser} from '@xmldom/xmldom'

/** One governed question journey through the built Worker and its browser. */
export async function proveExploration({origin,context,page,call,upload,proveScreen,definition}) {
 const dataset='synthetic-bifocal-exploration',records=Array.from({length:61},(_,i)=>({invoice:'synthetic-bifocal-'+(i+1),region:i%2?'East':'West',cents:101+i,date:i<10?'06/30/2026':'07/02/2026'}))
 const csv='invoice,date,region,revenue,source_url,salary\n'+records.map(r=>[r.invoice,r.date,r.region,'$'+(r.cents/100).toFixed(2),'https://example.test/invoices/'+r.invoice,9000].join(',')).join('\n')+'\nsynthetic-bifocal-hidden,07/02/2026,Hidden,$99999.00,https://example.test/hidden,9999\n'
 await upload(dataset,csv)
 await upload('synthetic-bifocal-customer-map','region,segment\nWest,Priority\n')
 const model=structuredClone(definition),q=model.views[0].query
 q.dataset=dataset;q.joins=[{dataset:'synthetic-bifocal-customer-map',as:'customer',left:'region',right:'region',duplicates:'reject',cardinality:'many-to-one'}];q.groupBy=['region'];q.semantic={grain:['invoice'],dimensions:[{column:'invoice',type:'text'},{column:'date',type:'date'},{column:'region',type:'text'},{column:'revenue',type:'money'},{column:'source_url',type:'text'},{column:'customer.segment',type:'text'}],hierarchies:[['region','invoice']],slowlyChanging:'reject-duplicate-grain'}
 q.fiscal={column:'date',asOf:'2026-08-15',window:'quarter-to-date'}
 q.measures=[q.measures[0],{id:'invoices',op:'count',unit:'count',scale:0}]
 model.views[0].rowRules=[{column:'region',op:'ne',value:'Hidden'}];model.quality=[]
 const saved=await call('/models',{definition:model}),base='/models/'+saved.modelId+'/branches/'+saved.branchId
 const review=await call(base+'/validate',{},200);assert.equal(review.compatible,true)
 await call(base+'/approve',{digest:review.digest},200);await call(base+'/promote',{environment:'staging',digest:review.digest},200);await call(base+'/promote',{environment:'production',digest:review.digest},200)
 const input={modelId:saved.modelId,revision:saved.revision,viewId:model.views[0].id,groupBy:['region'],filters:[]}
 const sql=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json
c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE invoice(id TEXT,region TEXT,cents INTEGER,day TEXT)')
c.executemany('INSERT INTO invoice VALUES(?,?,?,?)',[(f'synthetic-bifocal-{i+1}','East' if i%2 else 'West',101+i,'2026-06-30' if i<10 else '2026-07-02') for i in range(61)])
print(json.dumps([list(c.execute("SELECT count(*),sum(cents) FROM invoice WHERE day>=?",(start,)).fetchone()) for start in ['2026-07-01','2025-07-01']]))`],{encoding:'utf8'}))
 const run=await call('/explore/run',input)
 assert.deepEqual(run.answer.joinDiagnostics,[{alias:'customer',duplicateRowsRemoved:0,unmatchedRows:31}])
 assert.equal(run.answer.filteredRows,sql[0][0]);assert.equal(run.answer.totals.revenue.value,(sql[0][1]/100).toFixed(2));assert.equal(run.answer.totals.invoices.value,String(sql[0][0]))
 const compared=await call('/explore/run',{...input,compareAsOf:'2026-06-30'});assert.equal(compared.context.exploration.comparison.answer.filteredRows,10);assert.equal(compared.context.exploration.comparison.answer.totals.revenue.value,'10.55');assert.equal((await call('/explore/'+compared.snapshotId)).context.exploration.comparison.answer.totals.revenue.value,'10.55')
 await call('/explore/run',{...input,joins:[]},400)
 await call('/explore/run',{...input,groupBy:['salary']},403)
 await call('/explore/run',{...input,filters:[{column:'salary',op:'eq',value:'9000'}]},403)
 await call('/explore/run',{...input,revision:'stale'},409)
 const hidden=await call('/explore/run',{...input,filters:[{column:'region',op:'eq',value:'Hidden'}]});assert.equal(hidden.answer.filteredRows,0)
 assert.equal((await fetch(origin+'/api/operator/explore')).status,401)
 await call('/explore/run',input,401,{Origin:'https://foreign.example.test'})
 assert.equal((await context.request.post(origin+'/api/operator/explore/'+run.snapshotId+'/export',{headers:{Origin:'https://foreign.example.test'},data:{scope:'underlying',format:'csv'}})).status(),401)
 const rows=[];let offset=0
 do{const p=await call('/explore/'+run.snapshotId+'/page',{scope:'underlying',offset},200);rows.push(...p.rows);offset=p.nextOffset}while(offset!==null)
 assert.equal(rows.length,sql[0][0]);assert.equal(new Set(rows.map(r=>r[0])).size,rows.length);assert.ok(rows.every(r=>r[2]!=='Hidden'));assert.equal(rows.reduce((sum,r)=>sum+Math.round(Number(r[3])*100),0),sql[0][1])
 const parseCSV=text=>text.trimEnd().split('\r\n').map(row=>row.split(',').map(c=>c.slice(1,-1).replaceAll('""','"')))
 for(const scope of ['summary','underlying'])for(const format of ['csv','xlsx']){
  const response=await context.request.post(origin+'/api/operator/explore/'+run.snapshotId+'/export',{headers:{Origin:origin},data:{scope,format}});assert.equal(response.status(),200,await response.text());assert.equal(response.headers()['x-bifocal-scope'],scope)
  const count=scope==='summary'?2:sql[0][0];assert.equal(Number(response.headers()['x-bifocal-row-count']),count)
  if(format==='csv'){
   const exported=parseCSV(await response.text());assert.equal(exported.length,count+1)
   const money=exported[0].indexOf('revenue');assert.equal(exported.slice(1).reduce((sum,r)=>sum+Math.round(Number(r[money])*100),0),sql[0][1]);assert.ok(!exported.flat().includes('Hidden'))
  }else{
   const parts=unzipSync(new Uint8Array(await response.body())),xml=strFromU8(parts['xl/worksheets/sheet1.xml']),doc=new DOMParser().parseFromString(xml,'application/xml')
   const allRows=Array.from(doc.getElementsByTagName('row'));assert.equal(allRows.length,count+1)
   const headers=Array.from(allRows[0].getElementsByTagName('t')).map(t=>t.textContent),money=headers.indexOf('revenue'),values=allRows.slice(1).map(row=>Array.from(row.getElementsByTagName('c'))[money])
   assert.ok(values.every(c=>c.getAttribute('t')==='n'));assert.equal(values.reduce((sum,c)=>sum+Math.round(Number(c.getElementsByTagName('v')[0].textContent)*100),0),sql[0][1]);assert.equal(doc.getElementsByTagName('f').length,0);assert.ok(!xml.includes('Hidden'))
   if(scope==='underlying')assert.ok(allRows.slice(1).every(r=>r.getElementsByTagName('c')[1].getAttribute('t')==='d'))
  }
 }
 for(const width of [1440,390]){
  const screen=async(label)=>{await proveScreen(label);await page.setViewportSize({width,height:1000})}
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/questions');await page.getByRole('status').filter({hasText:'Ready to explore'}).waitFor()
  const option=page.getByLabel('Published model').locator('option').filter({hasText:saved.modelId.slice(0,8)});await page.getByLabel('Published model').selectOption(await option.getAttribute('value'))
  await page.getByRole('button',{name:'Run and save question'}).focus();await page.keyboard.press('Enter');await page.getByRole('status').filter({hasText:'Question saved'}).waitFor()
  assert.match(await page.locator('#totals').innerText(),new RegExp((sql[0][1]/100).toFixed(2).replace('.','\\.')))
  assert.match(await page.locator('#join-note').innerText(),/31 matching and 31 unmatched/);await screen('explore-summary')
  const parent=await page.getByRole('link',{name:'Reopen saved question'}).getAttribute('href');await page.getByRole('button',{name:'Drill to invoice for West',exact:true}).click();await page.getByRole('status').filter({hasText:'Hierarchy level loaded'}).waitFor();assert.equal(await page.getByLabel('Group by',{exact:true}).inputValue(),'invoice');assert.match(await page.locator('#totals').innerText(),/35.36/);assert.match(await page.locator('#page-note').innerText(),/of 26 summary rows/);await screen('explore-hierarchy');await page.goto(origin+parent);await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor()
  // One click from the regional total opens precisely that region's invoices.
  await page.getByRole('button',{name:'View records for West',exact:true}).click();await page.getByRole('status').filter({hasText:'Filtered source rows loaded'}).waitFor()
  assert.match(await page.locator('#results').innerText(),/West/);assert.doesNotMatch(await page.locator('#results').innerText(),/East|Hidden|salary/)
  assert.match(await page.getByRole('link',{name:'Open source'}).first().getAttribute('href'),/^https:\/\/example\.test\/invoices\/synthetic-bifocal-/)
  assert.equal(await page.getByRole('link',{name:'Open source'}).first().getAttribute('rel'),'noopener noreferrer')
  await context.route('https://example.test/invoices/**',route=>route.fulfill({contentType:'text/plain',body:'Synthetic source record'}));const sourcePagePromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Open source'}).first().click();const sourcePage=await sourcePagePromise;await sourcePage.waitForLoadState();assert.match(sourcePage.url(),/^https:\/\/example\.test\/invoices\/synthetic-bifocal-/);await sourcePage.close()
  await screen('explore-drill')
  const link=await page.getByRole('link',{name:'Reopen saved question'}).getAttribute('href');await page.goto(origin+link);await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor();assert.equal(await page.getByLabel('Filter field').inputValue(),'region');assert.equal(await page.getByLabel('Filter equals').inputValue(),'West')
  await page.getByRole('button',{name:'Underlying rows',exact:true}).click();await page.getByRole('status').filter({hasText:'Question scope changed'}).waitFor();assert.match(await page.locator('#page-note').innerText(),/1–25 of 26/)
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page-note').textContent.includes('26–26'));await screen('explore-last-page')
  await page.getByText('Export this question',{exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();assert.match((await download).suggestedFilename(),/underlying.csv$/);await page.getByRole('status').filter({hasText:'Export complete: 26'}).waitFor();await screen('explore-export')
  await page.getByLabel('Filter field').selectOption('');await page.getByLabel('Group by',{exact:true}).selectOption('region');await page.getByLabel('Pivot columns').selectOption('date');await page.getByLabel('Fiscal window').selectOption('year-to-date');await page.getByLabel('As of',{exact:true}).fill('2026-06-30');await page.getByLabel('Compare as of (optional)').fill('2026-08-15');await page.getByRole('button',{name:'Run and save question'}).click();await page.getByRole('status').filter({hasText:'Question saved'}).waitFor()
  assert.match(await page.locator('#scope-note').innerText(),/10 matching source rows/);assert.match(await page.locator('#results').innerText(),/2026-06-30/);assert.equal(await page.getByRole('region',{name:'Pivot of summarized rows',exact:true}).isVisible(),true);assert.match(await page.locator('#comparison').innerText(),/69.36/);await screen('explore-period-pivot')
  await page.getByLabel('Filter field').selectOption('region');await page.getByLabel('Filter equals').fill('Hidden');await page.getByRole('button',{name:'Run and save question'}).click();await page.getByRole('status').filter({hasText:'Question saved'}).waitFor();assert.match(await page.locator('#scope-note').innerText(),/0 matching source rows/);await screen('explore-empty')
 }
 // Exports preserve source text or refuse an unrepresentable workbook value.
 const formulaCSV=csv.replace('synthetic-bifocal-12,','=synthetic-bifocal-12,').replace('synthetic-bifocal-13,','synthetic-bifocal-13_x0041_,')
 await upload(dataset,formulaCSV.replace('synthetic-bifocal-11,','synthetic-bifocal-11\u0001,'),true)
 const unusual=await call('/explore/run',input)
 const csvResponse=await context.request.post(origin+'/api/operator/explore/'+unusual.snapshotId+'/export',{headers:{Origin:origin},data:{scope:'underlying',format:'csv'}});assert.equal(csvResponse.status(),200);const unusualCSV=await csvResponse.text();assert.ok(unusualCSV.includes('synthetic-bifocal-11\u0001'));assert.ok(unusualCSV.includes("\"'=synthetic-bifocal-12\""))
 const invalid=await call('/explore/'+unusual.snapshotId+'/export',{scope:'underlying',format:'xlsx'},422);assert.equal(invalid.error,'xlsx_xml_character_refused')
 await upload(dataset,formulaCSV,true)
 const literal=await call('/explore/run',input),workbook=await context.request.post(origin+'/api/operator/explore/'+literal.snapshotId+'/export',{headers:{Origin:origin},data:{scope:'underlying',format:'xlsx'}});assert.equal(workbook.status(),200)
 const literalXML=strFromU8(unzipSync(new Uint8Array(await workbook.body()))['xl/worksheets/sheet1.xml']);assert.ok(literalXML.includes('=synthetic-bifocal-12'));assert.ok(literalXML.includes('synthetic-bifocal-13_x005F_x0041_'),'A literal workbook escape remains source text rather than becoming A');assert.ok(!literalXML.includes('<f>'))
 // Model promotion inventories real exploration answers, then invalidates old questions.
 const branch=await call('/models/'+saved.modelId+'/branches',{definition:model}),branchPath='/models/'+saved.modelId+'/branches/'+branch.branchId
 const next=await call(branchPath+'/validate',{},200);assert.ok(next.dependencies.some(d=>d.kind==='query'&&d.id===run.snapshotId))
 await call(branchPath+'/approve',{digest:next.digest},200);await call(branchPath+'/promote',{environment:'staging',digest:next.digest},200);await call(branchPath+'/promote',{environment:'production',digest:next.digest},200)
 const catalog=await call('/explore');assert.ok(catalog.questions.some(q=>q.id===run.snapshotId));assert.ok(catalog.questions.every(q=>!('comparison' in q)&&!('parameters' in q)&&!('answer' in q)),'Question history contains labels only, including after promotion')
 await call('/explore/'+run.snapshotId,undefined,409);await call('/explore/'+run.snapshotId+'/page',{scope:'underlying',offset:0},409);await call('/explore/'+run.snapshotId+'/export',{scope:'summary',format:'csv'},409)
 await page.goto(origin+'/app/questions/'+run.snapshotId);await page.getByRole('status').filter({hasText:'published model changed'}).waitFor();assert.equal(await page.locator('#result').isVisible(),false);await proveScreen('explore-stale')
 const datasetState=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:datasetState.revision},200);await call('/explore/'+run.snapshotId,undefined,404)
 const mapping=await call('/datasets/synthetic-bifocal-customer-map');await call('/datasets/synthetic-bifocal-customer-map/erase',{confirmDataset:'synthetic-bifocal-customer-map',reviewedRevision:mapping.revision},200)
 console.log('Exploration: published model rules, exact fiscal totals and paged drill, scoped CSV and typed XLSX, saved parameters, stale model and source erasure passed at 1440 and 390')
}

/** Native invited sales-manager access, distinct export grants and revocation. */
export async function proveExplorationAccess(origin,owner,reader,readerId){
 const headers={Origin:origin},call=async(context,path,data,expected=data===undefined?200:201)=>{
  const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers,...data===undefined?{}:{data}});assert.equal(response.status(),expected,await response.text());return response.headers()['content-type']?.startsWith('application/json')?response.json():response
 }
 const dataset='synthetic-bifocal-delegated',records=Array.from({length:61},(_,i)=>({id:'synthetic-bifocal-'+(i+1),region:i%2?'East':'West',cents:101+i,date:i<10?'06/30/2026':'07/02/2026'}))
 const text='invoice,date,region,revenue,source_url,salary\n'+records.map(r=>[r.id,r.date,r.region,'$'+(r.cents/100).toFixed(2),'https://example.test/invoices/'+r.id,9999].join(',')).join('\n')
 const upload=async(data,catchup=false)=>{
  const bytes=Buffer.from(JSON.stringify({version:1,datasetId:dataset,filename:'synthetic-bifocal-1.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:null,formulaTreatment:'literal-text',data})),hash=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
  const post=async(action,data)=>{const response=await owner.request.post(origin+'/api/operator/import/'+action,{headers:{...headers,'X-Import-Dataset':dataset},data});assert.equal(response.status(),200,await response.text());return response.json()}
  const uploaded=await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')}),plan=await post('plan',{uploadId:uploaded.uploadId,...catchup?{catchup:true}:{}})
  for(let i=0;i<20;i++)if((await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})).job.state==='completed')return ()=>post('undo',{planId:plan.planId})
  assert.fail('Source import did not finish')
 }
 await upload(text)
 await call(owner,'/calendars',{id:'synthetic-bifocal-delegated',previousVersion:null,definition:{name:'Sales fiscal year',kind:'fiscal',startMonth:7}})
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',sourceCurrency:'USD',scale:2},{id:'invoices',op:'count',unit:'count',scale:0}],context:{modelVersion:'sales-v1',metricVersion:'draft',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-delegated',version:1},rounding:'half-even'},fiscal:{column:'date',asOf:'2026-08-15',window:'quarter-to-date'},semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'text'},{column:'date',type:'date'},{column:'region',type:'text'},{column:'revenue',type:'money'},{column:'source_url',type:'text'}],hierarchies:[['region','invoice']],slowlyChanging:'reject-duplicate-grain'}}
 const model=await call(owner,'/models',{definition:{views:[{id:'sales',kind:'chart',query,rowRules:[]}],quality:[]}}),base='/models/'+model.modelId+'/branches/'+model.branchId,review=await call(owner,base+'/validate',{},200)
 await call(owner,base+'/approve',{digest:review.digest},200);await call(owner,base+'/promote',{environment:'staging',digest:review.digest},200);await call(owner,base+'/promote',{environment:'production',digest:review.digest},200)
 const person=async()=>(await(await owner.request.get(origin+'/auth/operators')).json()).find(p=>p.id===readerId)
 const body={operatorId:readerId,operatorVersion:(await person()).version,modelId:model.modelId,revision:model.revision,viewId:'sales',filters:[{column:'region',op:'eq',value:'West'}],dimensions:['region','date'],underlying:true,summaryExport:true,underlyingExport:true,expiresAt:new Date(Date.now()+300000).toISOString()}
 const issue=async(input)=>{const preview=await call(owner,'/explore/access/review',input,200);return call(owner,'/explore/access',{...input,reviewedDigest:preview.digest})}
 const parameters={modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['region'],filters:[]}
 await call(reader,'/explore/run',parameters,403)
 assert.equal((await reader.request.get(origin+'/app/questions')).status(),403)
 await call(reader,'/explore/access/review',body,403)
 await call(owner,'/explore/access',{...body,reviewedDigest:'0'.repeat(64)},409)
 const grant=await issue(body)
 const audit=await call(owner,'/explore/access');assert.ok(audit.audit.some(a=>a.grant_id===grant.id&&a.action==='issued'&&a.digest===grant.digest))
 const input={...parameters,grantId:grant.id}
 await call(reader,'/explore/run',{...input,viewId:'hidden'},403)
 await call(reader,'/explore/run',{...input,groupBy:['salary']},403)
 await call(reader,'/explore/run',{...input,filters:[{column:'salary',op:'eq',value:'9999'}]},403)
 assert.equal((await reader.request.get(origin+'/api/operator/datasets/'+dataset)).status(),401)
 assert.equal((await reader.request.get(origin+'/api/operator/models/'+model.modelId)).status(),401)
 assert.equal((await reader.request.post(origin+'/api/operator/explore/run',{headers:{Origin:'https://foreign.example.test'},data:input})).status(),401)
 const run=await call(reader,'/explore/run',input),expected=records.filter(r=>r.region==='West'&&r.date==='07/02/2026'),money=expected.reduce((sum,r)=>sum+r.cents,0)
 assert.equal(run.answer.filteredRows,26);assert.equal(run.answer.inputRows,26,'Unpermitted input counts never leave the server');assert.deepEqual(run.answer.joinDiagnostics,[]);assert.equal(run.answer.totals.revenue.value,(money/100).toFixed(2));assert.equal(run.context.securityScope.operatorId,readerId)
 assert.deepEqual((await call(reader,'/explore/'+run.snapshotId)).definition.filters,run.definition.filters)
 const discovered=async(id)=>(await call(reader,'/explore')).questions.some(q=>q.id===id)
 assert.equal(await discovered(run.snapshotId),true,'Current grant exposes its saved question metadata')
 assert.ok((await call(owner,'/explore/access')).audit.some(a=>a.grant_id===grant.id&&a.action==='question-discovery'&&a.actor_id===readerId),'Discovery records grant use without source rows')
 const rows=[];let offset=0
 do{const result=await call(reader,'/explore/'+run.snapshotId+'/page',{scope:'underlying',offset},200);rows.push(...result.rows);offset=result.nextOffset}while(offset!==null)
 assert.deepEqual(rows.map(r=>r[0]).sort(),expected.map(r=>r.id).sort());assert.equal(rows.reduce((sum,r)=>sum+Math.round(Number(r[3])*100),0),money)
 const ownerRun=await call(owner,'/explore/run',parameters);await call(reader,'/explore/'+ownerRun.snapshotId,undefined,404)
 for(const scope of ['summary','underlying'])for(const format of ['csv','xlsx']){
  const response=await reader.request.post(origin+'/api/operator/explore/'+run.snapshotId+'/export',{headers,data:{scope,format}});assert.equal(response.status(),200,await response.text());assert.equal(Number(response.headers()['x-bifocal-row-count']),scope==='summary'?1:26)
  if(format==='csv'){const csv=await response.text();assert.ok(csv.includes((money/100).toFixed(2))||scope==='underlying');assert.ok(!csv.includes('East')&&!csv.includes('salary'));if(scope==='underlying'){const exported=csv.trimEnd().split('\r\n').slice(1).map(row=>row.split(',').map(c=>c.slice(1,-1)));assert.deepEqual(exported.map(r=>r[0]).sort(),expected.map(r=>r.id).sort());assert.equal(exported.reduce((sum,r)=>sum+Math.round(Number(r[3])*100),0),money)}}
  else{const xml=strFromU8(unzipSync(new Uint8Array(await response.body()))['xl/worksheets/sheet1.xml']),doc=new DOMParser().parseFromString(xml,'application/xml');assert.equal(doc.getElementsByTagName('row').length,scope==='summary'?2:27);assert.equal(doc.getElementsByTagName('f').length,0);assert.ok(!xml.includes('East')&&!xml.includes('salary'));if(scope==='underlying'){const dataRows=[...doc.getElementsByTagName('row')].slice(1);assert.equal(dataRows.reduce((sum,row)=>sum+Math.round(Number(row.getElementsByTagName('c')[3].getElementsByTagName('v')[0].textContent)*100),0),money);assert.ok(dataRows.every(row=>row.getElementsByTagName('c')[1].getAttribute('t')==='d'))}}
 }
 const page=await reader.newPage(),screen=async(label)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label);assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0);if(process.env.BIFOCAL_PROOF_DIR){const {mkdir}=await import('node:fs/promises');await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/'+label+'-'+width+'.png',fullPage:true})}}}
 try{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/questions');await page.getByRole('status').filter({hasText:'Ready to explore'}).waitFor()
   await page.getByRole('button',{name:'Run and save question'}).click();await page.getByRole('status').filter({hasText:'Question saved'}).waitFor();await screen('explore-manager-summary')
   await page.getByRole('button',{name:'View records for West',exact:true}).click();await page.getByRole('status').filter({hasText:'Filtered source rows loaded'}).waitFor();assert.match(await page.locator('#page-note').innerText(),/of 26 underlying rows/);assert.doesNotMatch(await page.locator('#results').innerText(),/East|salary/)
   const link=await page.getByRole('link',{name:'Reopen saved question'}).getAttribute('href');await page.goto(origin+link);await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor();await page.getByRole('button',{name:'Underlying rows',exact:true}).click();await page.getByRole('status').filter({hasText:'Question scope changed'}).waitFor();await screen('explore-manager-drill')
   await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page-note').textContent.includes('26–26'));await screen('explore-manager-last-page')
   await reader.route('https://example.test/invoices/**',route=>route.fulfill({contentType:'text/plain',body:'Synthetic invoice'}));const popup=page.waitForEvent('popup');await page.getByRole('link',{name:'Open source'}).first().click();const source=await popup;await source.waitForLoadState();assert.match(source.url(),/example.test\/invoices\/synthetic-bifocal-/);await source.close()
   await page.getByText('Export this question',{exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export XLSX',exact:true}).click();assert.match((await download).suggestedFilename(),/underlying.xlsx$/);await page.getByRole('status').filter({hasText:'Export complete: 26'}).waitFor();await screen('explore-manager-export')
   await page.getByLabel('Filter field').selectOption('');await page.getByLabel('Group by',{exact:true}).selectOption('region');await page.getByLabel('Pivot columns').selectOption('date');await page.getByLabel('Fiscal window').selectOption('year-to-date');await page.getByLabel('As of',{exact:true}).fill('2026-06-30');await page.getByRole('button',{name:'Run and save question'}).click();await page.getByRole('status').filter({hasText:'Question saved'}).waitFor();assert.match(await page.locator('#scope-note').innerText(),/5 matching/);assert.equal(await page.getByRole('region',{name:'Pivot of summarized rows',exact:true}).isVisible(),true);await screen('explore-manager-period-pivot')
   await page.getByLabel('Filter field').selectOption('region');await page.getByLabel('Filter equals').fill('East');await page.getByRole('button',{name:'Run and save question'}).click();await page.getByRole('status').filter({hasText:'Question saved'}).waitFor();assert.match(await page.locator('#scope-note').innerText(),/0 matching/);await screen('explore-manager-empty')
  }
  // A readable underlying table does not itself authorize its download.
  const noDownload=await issue({...body,underlyingExport:false}),readable=await call(reader,'/explore/run',{...parameters,grantId:noDownload.id})
  await call(reader,'/explore/'+readable.snapshotId+'/page',{scope:'underlying',offset:0},200)
  for(const format of ['csv','xlsx'])await call(reader,'/explore/'+readable.snapshotId+'/export',{scope:'underlying',format},403)
  const noSummary=await issue({...body,summaryExport:false}),underlyingOnly=await call(reader,'/explore/run',{...parameters,grantId:noSummary.id})
  for(const format of ['csv','xlsx']){await call(reader,'/explore/'+underlyingOnly.snapshotId+'/export',{scope:'summary',format},403);await call(reader,'/explore/'+underlyingOnly.snapshotId+'/export',{scope:'underlying',format},200)}
  const expiring=await issue({...body,expiresAt:new Date(Date.now()+1300).toISOString()}),expiringRun=await call(reader,'/explore/run',{...parameters,grantId:expiring.id});await new Promise(resolve=>setTimeout(resolve,1500));await call(reader,'/explore/'+expiringRun.snapshotId,undefined,403)
  await call(owner,'/explore/access/'+grant.id+'/revoke',{},200)
  assert.ok((await call(owner,'/explore/access')).audit.some(a=>a.grant_id===grant.id&&a.action==='revoked'));
  assert.equal(await discovered(run.snapshotId),false,'Revocation withdraws discovery metadata');
  await call(reader,'/explore/'+run.snapshotId,undefined,403);await call(reader,'/explore/'+run.snapshotId+'/export',{scope:'summary',format:'csv'},403)
  const summary=await issue({...body,underlying:false,underlyingExport:false}),summaryRun=await call(reader,'/explore/run',{...parameters,grantId:summary.id})
  for(const format of ['csv','xlsx']){await call(reader,'/explore/'+summaryRun.snapshotId+'/export',{scope:'summary',format},200);await call(reader,'/explore/'+summaryRun.snapshotId+'/export',{scope:'underlying',format},403)}
  await call(reader,'/explore/'+summaryRun.snapshotId+'/page',{scope:'underlying',offset:0},403);await call(reader,'/explore/run',{...parameters,grantId:summary.id,groupBy:['invoice']},403)
  await page.goto(origin+'/app/questions/'+summaryRun.snapshotId);await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor();assert.equal(await page.getByRole('button',{name:'Underlying rows',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'View records for West',exact:true}).count(),0);await screen('explore-summary-only')
  const oldReview=await call(owner,'/explore/access/review',body,200)
  const originalSource=await call(owner,'/datasets/'+dataset),undoSource=await upload(text.replace('$1.01','$2.01'),true)
  await call(owner,'/explore/access',{...body,reviewedDigest:oldReview.digest},409);await call(reader,'/explore/'+summaryRun.snapshotId,undefined,403)
  assert.deepEqual((await call(reader,'/explore')).questions,[],'Source changes withdraw every old label and history count')
  assert.ok((await call(owner,'/explore/access')).audit.some(a=>a.grant_id===summary.id&&a.action==='source-invalidated'&&a.actor_id==='system'))
  await page.reload();await page.getByRole('heading',{name:'Question access unavailable'}).waitFor();await screen('explore-source-access-changed')
  await undoSource();assert.equal((await call(owner,'/datasets/'+dataset)).revision,originalSource.revision,'Undo restores the exact original source revision')
  await call(reader,'/explore/'+summaryRun.snapshotId,undefined,403);await call(reader,'/explore/run',{...parameters,grantId:summary.id},403)
  assert.deepEqual((await call(reader,'/explore')).questions,[],'Source rollback never revives historical metadata')
  const beforePublication=await issue(body),beforeRun=await call(reader,'/explore/run',{...parameters,grantId:beforePublication.id})
  assert.equal(await discovered(beforeRun.snapshotId),true)
  await page.goto(origin+'/app/questions/'+beforeRun.snapshotId);await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor();await screen('explore-source-renewed')
  const next=await call(owner,'/models/'+model.modelId+'/branches',{definition:{views:[{id:'sales',kind:'chart',query,rowRules:[]}],quality:[]}}),nextBase='/models/'+model.modelId+'/branches/'+next.branchId,nextReview=await call(owner,nextBase+'/validate',{},200)
  await call(owner,nextBase+'/approve',{digest:nextReview.digest},200);await call(owner,nextBase+'/promote',{environment:'staging',digest:nextReview.digest},200);await call(owner,nextBase+'/promote',{environment:'production',digest:nextReview.digest},200)
  await call(reader,'/explore/'+beforeRun.snapshotId,undefined,403)
  assert.deepEqual((await call(reader,'/explore')).questions,[],'Model promotion withdraws old discovery metadata')
  assert.ok((await call(owner,'/explore/access')).audit.some(a=>a.grant_id===beforePublication.id&&a.action==='model-invalidated'&&a.actor_id==='system'))
  const rollback=await call(owner,'/models/'+model.modelId+'/rollback-preview',{revision:model.revision},200)
  await call(owner,'/models/'+model.modelId+'/rollback',{revision:model.revision,previousGeneration:rollback.generation,digest:rollback.digest,securityResolution:'Retain the reviewed sales scope'},200)
  await call(reader,'/explore/run',{...parameters,grantId:beforePublication.id},403);await call(reader,'/explore/'+beforeRun.snapshotId,undefined,403)
  assert.deepEqual((await call(reader,'/explore')).questions,[],'Model rollback never revives historical metadata')
  await page.goto(origin+'/app/questions/'+beforeRun.snapshotId);await page.getByRole('heading',{name:'Question access unavailable'}).waitFor();await screen('explore-model-rollback-refused')
  const renewed=await issue(body),renewedRun=await call(reader,'/explore/run',{...parameters,grantId:renewed.id})
  assert.equal(await discovered(renewedRun.snapshotId),true,'Fresh exact owner review permits a fresh question')
  assert.equal(await discovered(beforeRun.snapshotId),false,'New authority never revives a question made with an earlier grant')
  await page.goto(origin+'/app/questions/'+renewedRun.snapshotId);await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor();assert.equal(await page.locator('#questions a[href="/app/questions/'+beforeRun.snapshotId+'"]').count(),0);await screen('explore-model-rollback-renewed')
  assert.equal((await owner.request.post(origin+'/auth/operator/status',{headers,data:{operatorId:readerId,status:'inactive'}})).status(),200)
  assert.equal((await reader.request.get(origin+'/api/operator/explore')).status(),401)
  assert.equal((await owner.request.post(origin+'/auth/operator/status',{headers,data:{operatorId:readerId,status:'active'}})).status(),200)
  await reader.request.get(new URL((await person()).signInUrl,origin).href);await call(reader,'/explore/run',{...parameters,grantId:renewed.id},403)
  const finalGrant=await issue({...body,operatorVersion:(await person()).version}),finalRun=await call(reader,'/explore/run',{...parameters,grantId:finalGrant.id})
  const state=await call(owner,'/datasets/'+dataset);await call(owner,'/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:state.revision},200);await call(reader,'/explore/'+finalRun.snapshotId,undefined,404)
 }finally{await page.close()}
 console.log('Delegated exploration: native manager, exact West money and complete pages, fiscal pivot, saved question, source link, typed downloads, summary-only and distinct export grants, source revision, membership and erasure fences passed at 1440 and 390')
}
