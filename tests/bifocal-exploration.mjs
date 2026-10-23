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
