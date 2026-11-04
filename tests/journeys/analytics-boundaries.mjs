import assert from 'node:assert/strict'
import { analyticsEdge } from './analytics-edge.mjs'
const grant='synthetic-bifocal-60'
export async function proveAnalyticsBoundaries(original,context,page,persist) {
 const browserRequests=[]
 const recordRequest=request=>browserRequests.push(request.url())
 page.on('request',recordRequest)
 const edge=await analyticsEdge(persist),{origin,vaneOrigin,state}=edge
 const call=async(path,data,status=200,extra={},method=data===undefined?'GET':'POST',timeout=30000)=>{
  const response=await context.request.fetch(origin+'/api/operator/'+path,{method,timeout,headers:{Origin:origin,...extra},...(data===undefined?{}:{data})})
  const text=await response.text();assert.equal(response.status(),status,text);assert.ok(!text.includes(grant),'grants never appear in application responses');return JSON.parse(text)
 }
 const shot=async(name,width)=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' must reflow at '+width)
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/analytics-${name}-${width}.png`,fullPage:true})
 }
 async function apply() {
  await page.locator('#review:not([hidden])').waitFor();await page.getByLabel('I reviewed this exact plan and its fingerprint').check();await page.getByRole('button',{name:'Apply import',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('reconciled'))
 }
 async function importFile(id,data,kind,description,link) {
  await page.getByLabel('Dataset id',{exact:true}).fill(id)
  await page.getByLabel('CSV or XLSX file').setInputFiles({name:'synthetic-bifocal-66.csv',mimeType:'text/csv',buffer:Buffer.from(data)})
  await page.getByText('Source links for this file',{exact:true}).click()
  await page.getByLabel('Source kind',{exact:true}).selectOption(kind)
  await page.getByLabel('Source record or report URL').fill(link)
  await page.getByLabel('Source description',{exact:true}).fill(description)
  await page.getByLabel('Window start',{exact:true}).fill('2026-06-01');await page.getByLabel('Window end (exclusive)',{exact:true}).fill('2026-07-01')
  await page.getByRole('button',{name:'Preview import',exact:true}).click();await apply()
 }
 try {
  assert.equal((await fetch(origin+'/api/operator/analytics/config')).status,401)
  const bootstrap=await context.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:'synthetic-bifocal-1'.repeat(3),displayName:'Analytics owner',returnTo:'/app'},maxRedirects:0});assert.equal(bootstrap.status(),303,await bootstrap.text())
  await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup',exact:true}).click()])
  const initialCalls=state.calls.length
  await call('analytics/vane/preview',{datasetId:'synthetic-bifocal-denied',siteId:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:false},400)
  await call('analytics/vane/preview',{datasetId:'synthetic-bifocal-denied',siteId:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:true},401,{Origin:'https://foreign.example.test'})
  assert.equal(state.calls.length,initialCalls)
  await call('calendars',{id:'synthetic-bifocal-market-calendar',previousVersion:null,definition:{name:'Business calendar',kind:'fiscal',startMonth:1}},201)
  await proveSquare(edge,context,page,call,shot,apply)
  if(process.argv.includes('--square'))return
  let lastBoard,apiDataset
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/import')
   assert.equal((await page.request.get(origin+'/api/operator/analytics/config')).status(),200)
   const ids={api:`market-vane-api-${width}`,csv:`market-vane-export-${width}`,usage:`market-product-${width}`,revenue:`market-revenue-${width}`};apiDataset=ids.api
   await page.getByLabel('Dataset id',{exact:true}).fill(ids.api);await page.getByText('Read Vane campaign conversions',{exact:true}).click()
   const vane=page.locator('#vane-form');await vane.getByLabel('Vane site id').fill('synthetic-bifocal-61');await vane.getByLabel('Vane start date').fill('2026-06-01');await vane.getByLabel('Vane end date (exclusive)').fill('2026-07-01');await vane.getByLabel('Vane read-only Stats key').fill(grant);await vane.getByRole('checkbox').check()
   await shot('source-setup',width)
   await vane.getByRole('button',{name:'Preview Vane conversions'}).click();await apply()
   const api=await call('datasets/'+ids.api);assert.equal(api.table.source.lineage.kind,'vane-api');assert.deepEqual(api.table.rows.map(row=>row[3]),['128','72']);assert.equal(await vane.getByLabel('Vane read-only Stats key').inputValue(),'')
   await page.goto(origin+'/app/import')
   await importFile(ids.csv,'label,visitors,visits,bounceRate,medianDuration,averageDuration,conversions,conversionRate,revenue,previous,currency,revenuePerVisitor\r\nSpring launch,1800,2400,31.2,40,52,128,5.3,32000.15,1650,USD,17.78\r\nPartner referral,600,900,25,50,62,72,8,12500,520,USD,20.83\r\n','vane-export','Vane UTM campaign conversions: visits with a goal, not ledger revenue.',vaneOrigin+'/app/sites/synthetic-bifocal-61?section=report&from=2026-06-01&to=2026-07-01#sources')
   const exported=await call('datasets/'+ids.csv);assert.equal(exported.table.source.lineage.kind,'vane-export');assert.deepEqual(exported.table.rows.map(row=>row[6]),['128','72'])
   await page.goto(origin+'/app/import')
   await importFile(ids.revenue,'campaign,amount\r\nSpring launch,$42350.15\r\nPartner referral,$18925.50\r\n','revenue-table','June accrual ledger revenue, net of refunds.','https://ledger.synthetic-bifocal.example/reports/june-revenue')
   await page.getByLabel('Dataset id',{exact:true}).fill(ids.usage);await page.getByText('Read a permitted product usage table',{exact:true}).click()
   const product=page.locator('#product-form')
   for(const [name,value] of [['project','synthetic-bifocal-62'],['dataset','business'],['table','usage'],['fields','campaign,active_accounts,day'],['from','2026-06-01'],['to','2026-07-01'],['accessToken',grant]])await product.locator(`[name="${name}"]`).fill(value)
   await product.getByRole('checkbox').check();await product.getByRole('button',{name:'Preview product usage'}).click();await apply()
   const usage=await call('datasets/'+ids.usage);assert.deepEqual(usage.table.columns.map(col=>col.name),['campaign','active_accounts','day']);assert.deepEqual(usage.table.rows.map(row=>row[1]),['184','96']);assert.equal(usage.table.rows[0][2],'2026-06-30');assert.ok(!JSON.stringify(usage).includes('restricted_salary'))
   const snapshots=[]
   for(const [dataset,group,column,metric,unit,scale] of [[ids.revenue,'campaign','amount','ledger-revenue','money',2],[ids.api,'campaign','conversions','conversion-visits','count',0],[ids.csv,'label','conversions','export-conversion-visits','count',0],[ids.usage,'campaign','active_accounts','active-accounts','count',0]]) {
    await page.goto(origin+'/app/queries');await page.getByText('New exact answer',{exact:true}).click()
    const query={version:1,dataset,joins:[],filters:[],groupBy:[group],measures:[{id:metric,op:'sum',column,unit,scale,...(unit==='money'?{sourceCurrency:'USD'}:{})}],context:{modelVersion:'native-business-v1',metricVersion:'owner-defined-v1',accountingBasis:unit==='money'?'accrual':'not-applicable',calendar:{id:'synthetic-bifocal-market-calendar',version:1},rounding:'half-even'}}
    await page.getByLabel('Query definition (JSON)').fill(JSON.stringify(query))
    const response=page.waitForResponse(r=>r.url()===origin+'/api/operator/queries/run'&&r.request().method()==='POST');await page.getByRole('button',{name:'Run exact query',exact:true}).click();const result=await (await response).json();assert.ok(result.snapshotId,JSON.stringify(result));snapshots.push(result)
    // A run folds New exact answer away to show its result; the new answer is still offered to combine.
    await page.locator('#compose-form input[value="'+result.snapshotId+'"]').waitFor({state:'attached'})
   }
   assert.deepEqual(snapshots.map(snapshot=>Object.values(snapshot.answer.totals)[0].value),['61275.65','200','200','280'])
   await page.getByText('New exact answer',{exact:true}).click()
   const compose=page.locator('#compose-form');await compose.getByLabel('Cross-system dashboard title').fill('Revenue, conversions and product adoption')
   for(const snapshot of snapshots)await compose.locator(`input[value="${snapshot.snapshotId}"]`).check()
   await shot('answer-selection',width)
   await compose.getByRole('button',{name:'Save cross-system dashboard'}).click();await page.getByRole('link',{name:'Open cross-system dashboard',exact:true}).click()
   await page.locator('#business-board:not([hidden])').waitFor();lastBoard=await call('dashboards/'+new URL(page.url()).pathname.split('/').at(-1));assert.equal(lastBoard.cards.length,4)
   assert.equal(await page.locator('#board-cards svg[role=img]').count(),4)
   for(const source of await page.locator('#board-cards details').all())if((await source.locator('summary').innerText()).startsWith('Source:'))await source.locator('summary').click()
   assert.equal(await page.getByRole('link',{name:'Open source report or table',exact:true}).count(),4)
   assert.ok((await page.locator('#board-cards').innerText()).includes('$42,350.15'))
   for(const name of ['Vane','Porthole','BigQuery','Snowflake','Databricks','Fivetran','Airbyte','Segment','Amplitude','Mixpanel'])assert.equal(await page.locator('#business-board').getByRole('link',{name,exact:true}).count(),1)
   await shot('dashboard',width)
   await page.getByRole('button',{name:'Save cross-system report',exact:true}).click();const reportLink=page.getByRole('link',{name:'Open cross-system report',exact:true});await reportLink.waitFor();const reportPath=await reportLink.getAttribute('href');await reportLink.click();await page.locator('#business-board:not([hidden])').waitFor();await shot('report',width)
   assert.equal((await call('reports/'+reportPath.split('/').at(-1))).cards.length,4)
   const warehouse=page.locator('#warehouse-form');for(const [name,value] of [['project','synthetic-bifocal-62'],['dataset','business'],['table','reporting']])await warehouse.locator(`[name="${name}"]`).fill(value)
   const beforePreview=state.calls.length;await warehouse.getByRole('button',{name:'Preview warehouse export'}).click();await page.locator('#warehouse-review:not([hidden])').waitFor();assert.equal(state.calls.length,beforePreview,'preview is local, without destination contact')
   const payload=page.locator('#warehouse-rows details');await payload.locator('summary').click();const reviewedRows=JSON.parse(await payload.locator('pre').innerText());assert.equal(reviewedRows.length,8);await payload.locator('summary').click()
   await page.getByLabel('Buyer warehouse write access token').fill(grant);await page.getByLabel('I approve these exact rows, retained versions and destination for one export attempt').check();await shot('warehouse-review',width)
   await page.getByRole('button',{name:'Send approved warehouse export'}).click();await page.waitForFunction(()=>document.querySelector('#warehouse-outcome').textContent.startsWith('acknowledged:'))
   assert.deepEqual(state.inserted.at(-1).map(row=>row.json),reviewedRows,'the complete payload reviewed in the browser is exactly what the buyer warehouse receives');assert.equal(state.inserted.at(-1).length,8);assert.ok(state.inserted.at(-1).some(row=>row.json.value==='42350.15'&&row.json.numerator==='847003'&&row.json.denominator==='20'))
   await shot('warehouse-acknowledged',width)
   const history=await call('warehouse/history'),receipt=history.exports.find(item=>item.state==='acknowledged');const calls=state.calls.length;await call('warehouse/send',{id:receipt.id,fingerprint:receipt.fingerprint,accessToken:grant,confirmExport:true},409);assert.equal(state.calls.length,calls)
  }
  const vaneInput={datasetId:apiDataset,siteId:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:true,catchup:true},before=await call('datasets/'+apiDataset)
  for(const [phase,status] of [['revoked',403],['redirect',502]]){state.phase=phase;const count=state.calls.length;await call('analytics/vane/preview',vaneInput,status);assert.equal(state.calls.length,count+1);assert.deepEqual(await call('datasets/'+apiDataset),before)}
  state.phase='incomplete';await call('analytics/product-table/preview',{datasetId:'market-refused',project:'synthetic-bifocal-62',dataset:'business',table:'usage',fields:['campaign','active_accounts','day'],from:'2026-06-01',to:'2026-07-01',timezone:'America/New_York',accessToken:grant,confirmRead:true},413);await call('datasets/market-refused',undefined,404)
  for(const phase of ['uncertain','partial']) {
   state.phase=phase;const preview=await call('warehouse/preview',{artifactId:lastBoard.id,project:'synthetic-bifocal-62',dataset:'business',table:'reporting'}),receipt=await call('warehouse/send',{id:preview.id,fingerprint:preview.fingerprint,accessToken:grant,confirmExport:true});assert.equal(receipt.state,phase==='uncertain'?'unknown':'partial');const count=state.calls.length;await call('warehouse/send',{id:preview.id,fingerprint:preview.fingerprint,accessToken:grant,confirmExport:true},409);assert.equal(state.calls.length,count)
  }
  for(const path of ['/api/operator/analytics/telemetry','/api/track','/api/collect','/api/telemetry'])assert.equal((await context.request.post(origin+path,{data:{event:'synthetic-bifocal-67'}})).status(),404)
  const pending=await call('warehouse/preview',{artifactId:lastBoard.id,project:'synthetic-bifocal-62',dataset:'business',table:'reporting'})
  const erased=await call('datasets/'+apiDataset+'/erase',{confirmDataset:apiDataset,reviewedRevision:before.revision});assert.ok(erased.stores.some(store=>store.store==='bf_analytics_boards'&&store.rows===2))
  await call('dashboards/'+lastBoard.id,undefined,404);await call('warehouse/send',{id:pending.id,fingerprint:pending.fingerprint,accessToken:grant,confirmExport:true},409)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/dashboards/'+lastBoard.id);await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true');await shot('withdrawn',width);assert.ok(!await page.locator('#business-board').isVisible(),'withdrawn cross-system source values are not rendered')}
  assert.ok(browserRequests.every(url=>new URL(url).origin === origin),'the built analytics workflow loads no external tracker or telemetry script')
  console.log('Analytics boundaries: Vane Stats/export and permitted product table beside exact ledger revenue, source links, chart/report and warehouse acknowledgement at 1440/390; separate setup links, no tracker/telemetry, revoked/partial source preservation, uncertain/partial non-replay and erasure withdrawal passed (official-schema network edges, not live-provider proof)')
 } finally {page.off('request',recordRequest);if(original)await page.goto(original+'/app');await edge.close()}
}

// The same public-door journey can run alone while iterating. CI invokes it
// from runtime.mjs; this entry never substitutes for the push Verify wall.
if(process.argv[1]===new URL(import.meta.url).pathname){
 const {chromium}=await import('@playwright/test'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const persist=await mkdtemp(join(tmpdir(),'bifocal-analytics-')),browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--use-mock-keychain','--password-store=basic','--no-sandbox']})
 try{const context=await browser.newContext(),page=await context.newPage();await proveAnalyticsBoundaries(null,context,page,persist)}finally{await browser.close();await rm(persist,{recursive:true,force:true})}
}

/** Square order summaries through the real installed file door and exact query.
 * Assertions run at 1440; the same changed screens have a separate 390 proof. */
async function proveSquare({origin,state,database,signInAs},context,page,call,shot,apply) {
 const id='square-orders',input={datasetId:id,locationId:'synthetic-bifocal-location',environment:'sandbox',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:true}
 const post=(action,data,status=200)=>call('import/'+action,data,status,{'X-Import-Dataset':id})
 const read=(extra={},status=200)=>call('analytics/square/preview',{...input,...extra},status,{},'POST',60000)
 const calls=state.calls.length
 await read({confirmRead:false},400);await read({environment:'other'},400);await read({locationId:'../orders'},400);await read({from:'2026-02-30'},400)
 for(const extra of [{url:'https://foreign.example.test'},{method:'PUT'},{operation:'pay'},{query:{return_entries:true}},{location_ids:['synthetic-bifocal-other']}])await read(extra,400)
 await call('analytics/square/preview',input,401,{Authorization:'Bearer synthetic-bifocal-machine'})
 await call('analytics/square/preview',input,401,{Origin:'https://foreign.example.test'})
 assert.equal(state.calls.length,calls)
 const member=await context.browser().newContext()
 try {
  const email=['synthetic-bifocal-square-member','example.test'].join('@')
  const memberSession=await signInAs(member,email,context);assert.equal(memberSession.operator.role,'member')
  const response=await member.request.post(origin+'/api/operator/analytics/square/preview',{headers:{Origin:origin},data:input})
  assert.equal(response.status(),401);assert.equal((await member.request.get(origin+'/api/operator/datasets/'+id)).status(),401);assert.equal((await member.request.post(origin+'/api/operator/datasets/'+id+'/erase',{headers:{Origin:origin},data:{confirmDataset:id,reviewedRevision:null}})).status(),401);assert.equal(state.calls.length,calls,'members cause no provider read')
 } finally {await member.close()}
 assert.equal((await fetch(origin+'/api/operator/analytics/square/preview',{method:'POST',headers:{Origin:origin,'content-type':'application'+'/'+'json'},body:JSON.stringify(input)})).status,401)
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import')
 await page.getByLabel('Dataset id',{exact:true}).fill(id);await page.getByText('Read Square order summaries',{exact:true}).click()
 const form=page.locator('#square-form')
 const fill=async()=>{
  for(const [name,value]of Object.entries(input))if(['locationId','from','to','accessToken'].includes(name))await form.locator(`[name="${name}"]`).fill(String(value))
  await form.getByLabel('Square environment').selectOption('sandbox');await form.getByRole('checkbox').check()
 }
 await fill();await shot('square-setup',1440)
 await form.getByRole('button',{name:'Preview Square orders'}).click();await page.locator('#review:not([hidden])').waitFor()
 assert.equal(await form.getByRole('checkbox').isChecked(),false);assert.equal(await form.getByLabel('Square orders read access token').inputValue(),'')
 assert.equal((await call('datasets/'+id,undefined,404)).error,'dataset_not_found')
 await shot('square-review',1440);await apply();await shot('square-applied',1440)
 const current=await call('datasets/'+id),names=current.table.columns.map(c=>c.name),records=current.table.rows.map(row=>Object.fromEntries(names.map((name,i)=>[name,row[i]])))
 assert.deepEqual(records.map(row=>row.order_id),['synthetic-bifocal-sale','synthetic-bifocal-void','synthetic-bifocal-return','synthetic-bifocal-nonapi'])
 assert.deepEqual(records.map(row=>[row.state,row.version,row.order_total,row.return_total,row.net_total]),[['COMPLETED','3','117.85','25.00','92.85'],['CANCELED','1','0.00',null,null],['COMPLETED',null,'0.00','12.50','-12.50'],['OPEN',null,'22.00',null,null]])
 assert.deepEqual([records[0].order_tax,records[0].order_discount,records[0].order_tip,records[0].order_service_charge,records[0].return_tax,records[0].net_tax],['8.00','5.00','12.00','2.85','1.50','6.50'])
 assert.equal(records[3].order_tax,null);assert.equal(records[3].updated_at,null);assert.equal(records[0].closed_at,'2026-06-10T10:10:00Z');assert.equal(current.table.key,'order_id')
 const history=await post('history'),initialPlan=history.history[0]
 const originals=await post('original/'+initialPlan.planId),held=originals.originals.filter(entry=>entry.original.status==='retained')
 assert.ok(held.length>0)
 const original=held.map(entry=>Buffer.from(entry.original.base64,'base64').toString('utf8')).join('\n')
 assert.ok(original.includes('synthetic-bifocal-sale'));assert.ok(original.includes('117.85'))
 for(const value of [grant,'synthetic-bifocal-private-customer','Unnecessary customer data','line_items','fulfillments'])assert.ok(!original.includes(value),'unnecessary fields and credential never enter retained originals')
 const audit=await database.prepare('SELECT event,fingerprint FROM bf_analytics_reads WHERE dataset_id=?').bind(id).all();assert.ok(audit.results.some(row=>row.event==='consented'));assert.ok(audit.results.some(row=>row.event==='staged'))
 const query={version:1,dataset:id,joins:[],filters:[],groupBy:['location_id'],measures:['order_total','return_total','net_total','order_tax','order_discount','order_tip','order_service_charge'].map(column=>({id:column.replaceAll('_','-'),op:'sum',column,unit:'money',scale:2,sourceCurrency:'USD'})),context:{modelVersion:'native-business-v1',metricVersion:'owner-defined-v1',accountingBasis:'not-applicable',calendar:{id:'synthetic-bifocal-market-calendar',version:1},rounding:'half-even'}}
 await page.goto(origin+'/app/queries');await page.getByText('New exact answer',{exact:true}).click();await page.getByLabel('Query definition (JSON)').fill(JSON.stringify(query))
 const running=page.waitForResponse(r=>r.url()===origin+'/api/operator/queries/run'&&r.request().method()==='POST');await page.getByRole('button',{name:'Run exact query',exact:true}).click();const response=await running,answer=await response.json();assert.equal(response.status(),201,JSON.stringify(answer))
 assert.deepEqual(Object.fromEntries(Object.entries(answer.answer.totals).map(([k,v])=>[k,v.value])),{'order-total':'139.85','return-total':'37.50','net-total':'80.35','order-tax':'8.00','order-discount':'5.00','order-tip':'12.00','order-service-charge':'2.85'})
 assert.equal(answer.answer.totals['net-total'].nulls,2);assert.equal(answer.answer.totals['order-tax'].nulls,2)
 await page.locator('#answer:not([hidden])').waitFor();await shot('square-answer',1440)
 // Every later-page failure must leave last-good rows AND retained import plans intact.
 const plansBefore=await database.prepare('SELECT count(*) AS n FROM ik_door_plans').first()
 for(const [phase,status]of [['401',403],['403',403],['429',503],['redirect',502],['errors',502],['foreign',502],['duplicate',502],['conflict',502],['loop',502],['unsafe',502],['currency',502],['credential',502],['incomplete',502],['missing',502],['rows',413],['pages',413],['bytes',413],['deadline',502],['empty',422]]){
  state.squarePhase=phase;const count=state.calls.length;const refused=await read({catchup:true},status);assert.ok(!JSON.stringify(refused).includes('synthetic-bifocal-private-diagnostic'));assert.ok(state.calls.slice(count).every(c=>c.host==='connect.squareupsandbox.com'&&c.path==='/v2/orders/search'&&c.method==='POST'),'refusals never follow redirects or perform writes');assert.deepEqual(await call('datasets/'+id),current,phase+' preserves the exact last-good source');assert.deepEqual(await database.prepare('SELECT count(*) AS n FROM ik_door_plans').first(),plansBefore,phase+' stages nothing')
 }
 state.squarePhase='success'
 // An in-flight bounded read loses native authority before it may stage.
 const withdrawing=await context.browser().newContext()
 let release
 try {
  const session=await signInAs(withdrawing,['synthetic-bifocal-1','example.test'].join('@'));assert.equal(session.operator.role,'owner')
  let reached
  const paused=new Promise(resolve=>{reached=resolve})
  state.squarePause=async()=>{reached();await new Promise(resolve=>{release=resolve})}
  const reading=withdrawing.request.post(origin+'/api/operator/analytics/square/preview',{headers:{Origin:origin},data:{...input,catchup:true}})
  const early=await Promise.race([paused.then(()=>null),reading]);assert.ok(early===null,early===null?'Read reached pause':'Read ended before pause: '+early.status()+' '+await early.text())
  assert.equal((await context.request.post(origin+'/auth/session/revoke',{headers:{Origin:origin},data:{sessionId:session.id}})).status(),204)
  release();const refused=await reading;assert.equal(refused.status(),409,await refused.text())
  assert.deepEqual(await call('datasets/'+id),current);assert.deepEqual(await database.prepare('SELECT count(*) AS n FROM ik_door_plans').first(),plansBefore)
 } finally {release?.();state.squarePause=null;await withdrawing.close()}
 const stale=await read({catchup:true})
 await post('apply',{planId:stale.planId,reviewedFingerprint:'0'.repeat(64)},403)
 await post('undo',{planId:stale.planId})
 const next=await read({catchup:true})
 const applyPlan=async plan=>{for(let n=0;n<20;n++)if((await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})).job.state==='completed')return;assert.fail('Square Apply completes')}
 await applyPlan(next);await post('apply',{planId:stale.planId,reviewedFingerprint:stale.fingerprint},404)
 await post('undo',{planId:next.planId});assert.deepEqual((await call('datasets/'+id)).table,current.table)
 // The phone proof uses the same source, review, Apply, query and Undo doors.
 await page.setViewportSize({width:390,height:1000});await page.goto(origin+'/app/import');await page.getByLabel('Dataset id',{exact:true}).fill(id);await page.getByText('Read Square order summaries',{exact:true}).click();await fill();await shot('square-setup',390)
 state.squarePhase='changed';await form.getByRole('button',{name:'Preview Square orders'}).click();await page.locator('#review:not([hidden])').waitFor();await shot('square-review',390);await apply();await shot('square-applied',390)
 await page.goto(origin+'/app/queries/'+answer.queryId);await page.locator('#answer:not([hidden])').waitFor();await shot('square-answer',390)
 await page.goto(origin+'/app/import?dataset='+id);await page.getByRole('button',{name:'Undo import',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import undone'));await shot('square-undone',390)
 await page.setViewportSize({width:1440,height:1000});assert.deepEqual((await call('datasets/'+id)).table,current.table);state.squarePhase='success'
 const revision=(await call('datasets/'+id)).revision
 let retention=await call('retention/'+id,{confirmDataset:id,reviewedDatasetRevision:revision,previousRevision:null,legalHold:true,minimumRetainUntil:null},200,{},'PUT')
 await call('datasets/'+id+'/erase',{confirmDataset:id,reviewedRevision:revision},423)
 retention=await call('retention/'+id,{confirmDataset:id,reviewedDatasetRevision:revision,previousRevision:retention.revision,legalHold:false,minimumRetainUntil:'9999-01-01T00:00:00.000Z',releaseHold:true},200,{},'PUT')
 await call('datasets/'+id+'/erase',{confirmDataset:id,reviewedRevision:revision},423)
 await call('retention/'+id,{confirmDataset:id,reviewedDatasetRevision:revision,previousRevision:retention.revision,legalHold:false,minimumRetainUntil:null,releaseHold:true},200,{},'PUT')
 const erased=await call('datasets/'+id+'/erase',{confirmDataset:id,reviewedRevision:revision});assert.ok(erased.stores.some(store=>store.store==='bf_query_snapshots'&&store.rows>0))
 await call('datasets/'+id,undefined,404);await call('queries/'+answer.queryId,undefined,404)
 const erasedOriginal=await post('original/'+initialPlan.planId);assert.ok(erasedOriginal.originals.length>0);assert.ok(erasedOriginal.originals.every(entry=>entry.original.status!=='retained'&&!entry.original.base64),'Erasure withdraws original bytes')
 await post('apply',{planId:stale.planId,reviewedFingerprint:stale.fingerprint},404)
 const replay=await read({catchup:true},409);assert.ok(JSON.stringify(replay).includes('source_erased'))
 await call('datasets/'+id,undefined,404)
 const retained=await database.prepare('SELECT * FROM bf_analytics_reads WHERE dataset_id=?').bind(id).all();assert.ok(!JSON.stringify(retained).includes(grant));assert.ok(!JSON.stringify(retained).includes('synthetic-bifocal-private-customer'))
 assert.ok(state.squareCalls.every(c=>['connect.squareupsandbox.com'].includes(c.host)),'explicit sandbox environment stays bound')
 // A production read uses only the separately selected official production host.
 await read({datasetId:'square-production',environment:'production'});assert.equal(state.squareCalls.at(-1).host,'connect.squareup.com')
 console.log('PROBE BIF-041 bounded read: /app/import Square sandbox -> four stable order summaries over two pages; separate exact review, Apply and reconciliation')
 console.log('PROBE BIF-041 money: /api/operator/queries/run -> order 139.85 USD, return 37.50 USD, reported net 80.35 USD; missing amounts and non-API versions remain null')
 console.log('PROBE BIF-041 refusal: later-page HTTP and schema failures, duplicate records, paging, byte and deadline bounds -> no staged plan and unchanged last-good table')
 console.log('PROBE BIF-041 custody: stale approval and retained capture replay refused; Undo restored prior revision; holds blocked erasure, eligible erasure withdrew originals and saved answer')
}
