import assert from 'node:assert/strict'
import { analyticsEdge } from './analytics-edge.mjs'
const grant='synthetic-bifocal-60'
export async function proveAnalyticsBoundaries(original,context,page,persist) {
 const browserRequests=[]
 const recordRequest=request=>browserRequests.push(request.url())
 page.on('request',recordRequest)
 const edge=await analyticsEdge(persist),{origin,vaneOrigin,state}=edge
 const call=async(path,data,status=200,extra={})=>{
  const response=await context.request.fetch(origin+'/api/operator/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,...extra},...(data===undefined?{}:{data})})
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
  await proveBigQueryCatalog(context,page,edge,call,shot)
  const initialCalls=state.calls.length
  await call('analytics/vane/preview',{datasetId:'synthetic-bifocal-denied',siteId:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:false},400)
  await call('analytics/vane/preview',{datasetId:'synthetic-bifocal-denied',siteId:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:true},401,{Origin:'https://foreign.example.test'})
  assert.equal(state.calls.length,initialCalls)
  await call('calendars',{id:'synthetic-bifocal-market-calendar',previousVersion:null,definition:{name:'Business calendar',kind:'fiscal',startMonth:1}},201)
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

// This is part of the existing analytics runtime registration, not a new test.
async function proveBigQueryCatalog(context,page,edge,call,shot) {
 const {origin,state,inspect,nativeMember,nativeOwner}=edge,path='analytics/bigquery/catalog'
 const input={action:'datasets',project:'synthetic-bifocal-62',accessToken:grant,confirmBrowse:true}
 const beforePlans=inspect('SELECT id FROM ik_door_plans'),beforeTables=inspect("SELECT name FROM sqlite_master WHERE type='table'")
 const start=state.catalogCalls.length,allCalls=state.calls.length
 await call(path,{...input,confirmBrowse:false},400)
 await call(path,{...input,pageToken:'synthetic-bifocal-unsafe'},400)
 await call(path,input,401,{Origin:'https://foreign.example.test'})
 await call(path,input,401,{authorization:'Bearer synthetic-bifocal-machine'})
 assert.equal((await fetch(origin+'/api/operator/'+path,{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify(input)})).status,401)
 assert.equal(state.catalogCalls.length,start,'refused authority and consent never dispatch')
 const cookie=(await context.cookies(origin)).map(c=>c.name+'='+c.value).join('; ')
 const memberCookie=await nativeMember(cookie)
 const memberResponse=await fetch(origin+'/auth/session',{headers:{cookie:memberCookie}})
 assert.equal(memberResponse.status,200);assert.equal((await memberResponse.json()).operator.role,'member')
 const memberDenied=await fetch(origin+'/api/operator/'+path,{method:'POST',headers:{cookie:memberCookie,Origin:origin,'content-type':'application/json'},body:JSON.stringify(input)})
 assert.equal(memberDenied.status,401);assert.equal(state.catalogCalls.length,start)
 const datasets=await call(path,input)
 assert.deepEqual(datasets.pages.map(p=>p.map(row=>[row.id,row.location,row.selectable])),[[['business','US',true],['europe','EU',false]],[['archive','US',true]]])
 assert.equal(datasets.freshness,'unknown');assert.ok(!JSON.stringify(datasets).includes('synthetic-private-metadata'));assert.equal(datasets.pages.flat().find(row=>row.id==='europe').diagnostic,'Unsupported location; select a US dataset.')
 const calls=state.catalogCalls.length
 await call(path,{...input,action:'tables',dataset:'europe'},422)
 assert.ok(state.catalogCalls.slice(calls).every(c=>!c.path.endsWith('/tables')),'non-US dataset never lists tables')
 const tables=await call(path,{...input,action:'tables',dataset:'business'})
 assert.deepEqual(tables.pages.map(p=>p.map(row=>row.id)),[['usage'],['complex']])
 const schema=await call(path,{...input,action:'schema',dataset:'business',table:'complex'})
 assert.deepEqual(schema.fields.map(f=>[f.path,f.type,f.mode,f.readable]),[['campaign','STRING','NULLABLE',true],['amount','NUMERIC','REQUIRED',true],['events','RECORD','REPEATED',false],['events.day','DATE','NULLABLE',false],['events.detail','RECORD','NULLABLE',false],['events.detail.code','STRING','NULLABLE',false],['payload','JSON','NULLABLE',false],['future','FUTURE_TYPE','NULLABLE',false]])
 assert.ok(schema.fields.slice(2).every(f=>f.diagnostic));assert.ok(!JSON.stringify(schema).includes('synthetic-private-metadata'))
 for(const type of ['VIEW','EXTERNAL']) {
  state.catalogPhase=type;const start=state.calls.length
  const inspected=await call(path,{...input,action:'schema',dataset:'business',table:'complex'})
  assert.equal(inspected.type,type);assert.match(inspected.diagnostic,/Only ordinary TABLE objects/);assert.equal(inspected.freshness,'unknown')
  assert.deepEqual(inspected.fields,schema.fields);assert.ok(!JSON.stringify(inspected).includes('synthetic-private-metadata'))
  assert.deepEqual(state.calls.slice(start),[{host:'bigquery.googleapis.com',path:'/bigquery/v2/projects/synthetic-bifocal-62/datasets/business/tables/complex',method:'GET'}],'view SQL and external connections remain inert during schema inspection')
 }
 for(const [phase,action,status,error] of [['403','schema',403,'provider_grant_refused'],['404','schema',404,'bigquery_object_not_found'],['429','datasets',503,'provider_rate_limited'],['redirect','datasets',502,'provider_redirect_refused'],['repeat','tables',502,'bigquery_repeated_or_invalid_cursor'],['cursor-false','tables',502,'bigquery_repeated_or_invalid_cursor'],['cursor-zero','tables',502,'bigquery_repeated_or_invalid_cursor'],['cursor-null','tables',502,'bigquery_repeated_or_invalid_cursor'],['duplicate','tables',502,'bigquery_duplicate_object'],['overflow','tables',413,'bigquery_catalog_page_limit'],['wrong-project','tables',502,'bigquery_object_mismatch'],['malformed-catalog','tables',502,'bigquery_catalog_schema_mismatch'],['schema-overflow','schema',413,'bigquery_schema_limit'],['schema-unavailable','schema',422,'bigquery_schema_unavailable'],['schema-not-array','schema',502,'bigquery_schema_mismatch'],['malformed-schema','schema',502,'bigquery_schema_mismatch'],['non-us','schema',422,'bigquery_us_location_required'],['credential-response','schema',502,'provider_credential_in_response']]) {
  state.catalogPhase=phase;const before=state.catalogCalls.length
  const result=await call(path,{...input,action,...(action!=='datasets'?{dataset:'business'}:{}),...(action==='schema'?{table:'complex'}:{})},status)
  assert.equal(result.error,error);assert.equal(Object.keys(result).join(),'error');assert.ok(!JSON.stringify(result).includes('synthetic-private-metadata'))
  assert.ok(state.catalogCalls.length-before<=(action==='tables'?7:1),'bounded metadata calls without automatic retry')
 }
 state.catalogPhase='success'
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/import');await page.getByText('Browse BigQuery metadata',{exact:true}).click()
  const form=page.locator('#bigquery-catalog-form'),project=form.getByLabel('Catalog Google project'),dataset=form.getByLabel('Catalog dataset'),table=form.getByLabel('Catalog table'),token=form.getByLabel('Catalog access token'),consent=form.getByRole('checkbox')
  await project.fill('synthetic-bifocal-62')
  const submit=async(name)=>{await token.fill(grant);await consent.check();await form.getByRole('button',{name,exact:true}).click();await page.locator('#bigquery-catalog-status').filter({hasText:'Metadata inspected.'}).waitFor();assert.equal(await token.inputValue(),'');assert.equal(await consent.isChecked(),false)}
  await submit('Browse datasets');await shot('catalog-datasets',width)
  if(width===1440){assert.equal(await dataset.locator('option[value="europe"]').evaluate(option=>option.disabled),true,await dataset.evaluate(select=>select.outerHTML));assert.equal(await dataset.locator('option').count(),4);await page.getByRole('button',{name:'Next metadata page',exact:true}).click();assert.match(await page.locator('#bigquery-catalog-objects').innerText(),/archive/);await page.getByRole('button',{name:'Previous metadata page',exact:true}).click()}
  await dataset.selectOption('business');await submit('Browse tables');await shot('catalog-tables',width)
  if(width===1440){assert.equal(await table.locator('option').count(),3);await page.getByRole('button',{name:'Next metadata page',exact:true}).click();assert.match(await page.locator('#bigquery-catalog-objects').innerText(),/complex/)}
  await table.selectOption('complex');await submit('Inspect schema');await shot('catalog-schema',width)
  if(width===390){const region=page.getByRole('region',{name:'BigQuery metadata table',exact:true});await region.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('[aria-label="BigQuery metadata table"]').scrollLeft>0)}
  if(width===1440){const content=await page.locator('#bigquery-catalog-results').innerText();assert.match(content,/events.detail.code/);assert.match(content,/Repeated values/);assert.match(content,/Source freshness remains unknown/);assert.ok(!content.includes('synthetic-private-metadata'));assert.equal(await form.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0);assert.ok(await form.locator('input,select,button').evaluateAll(es=>es.every(e=>parseFloat(getComputedStyle(e).fontSize)>=13)))}
  await dataset.selectOption('archive');assert.equal(await table.isDisabled(),true);assert.equal(await page.locator('#bigquery-catalog-results').isVisible(),false)
  if(width===1440) {
   await dataset.selectOption('business');let entered,release;const started=new Promise(r=>entered=r)
   state.catalogGate=new Promise(r=>release=r);state.catalogEntered=entered
   await token.fill(grant);await consent.check();await form.getByRole('button',{name:'Browse tables',exact:true}).click();await started
   await dataset.selectOption('archive');state.catalogGate=null;release()
   assert.equal(await table.isDisabled(),true);assert.equal(await table.locator('option').count(),1);assert.equal(await page.locator('#bigquery-catalog-results').isVisible(),false)
   assert.equal(await token.inputValue(),'');assert.equal(await consent.isChecked(),false)
   // Finish a later operation so the old request cannot silently repopulate selection.
   await dataset.selectOption('business');await submit('Browse tables');assert.equal(await dataset.inputValue(),'business');assert.equal(await table.locator('option').count(),3)
   for(const [phase,action,message] of [['duplicate','Browse tables',/duplicate object/],['wrong-project','Browse tables',/different project, dataset or table/],['malformed-catalog','Browse tables',/malformed catalog metadata/],['schema-unavailable','Inspect schema',/did not supply a schema/],['malformed-schema','Inspect schema',/malformed field metadata/]]) {
    if(action==='Inspect schema'){state.catalogPhase='success';await submit('Browse tables');await table.selectOption('complex')}
    state.catalogPhase=phase;await token.fill(grant);await consent.check();await form.getByRole('button',{name:action,exact:true}).click()
    await page.locator('#bigquery-catalog-status').filter({hasText:message}).waitFor();assert.equal(await page.locator('#bigquery-catalog-results').isVisible(),false)
    assert.equal(await token.inputValue(),'');assert.equal(await consent.isChecked(),false)
   }
   state.catalogPhase='success'
  }
  await project.fill('synthetic-bifocal-63');assert.equal(await dataset.isDisabled(),true);assert.equal(await table.locator('option').count(),1)
  // A changing project also discards an operation already in flight.
  await project.fill('synthetic-bifocal-62');let entered;const started=new Promise(r=>entered=r);let release
  state.catalogGate=new Promise(r=>release=r);state.catalogEntered=entered
  await token.fill(grant);await consent.check();await form.getByRole('button',{name:'Browse datasets',exact:true}).click();await started
  await project.fill('synthetic-bifocal-63');state.catalogGate=null;release()
  assert.equal(await dataset.isDisabled(),true);assert.equal(await page.locator('#bigquery-catalog-results').isVisible(),false)
  await project.fill('synthetic-bifocal-62');state.catalogPhase='403';await token.fill(grant);await consent.check();await form.getByRole('button',{name:'Browse datasets',exact:true}).click();await page.locator('#bigquery-catalog-status').filter({hasText:'Google refused'}).waitFor();await shot('catalog-refused',width);state.catalogPhase='success'
  assert.ok(!(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]))).includes(grant))
 }
 // Revoke a separate native owner session while its first provider page is pending.
 const temporary=await nativeOwner(),session=await(await fetch(origin+'/auth/session',{headers:{cookie:temporary}})).json()
 let entered,release;const started=new Promise(r=>entered=r);state.catalogGate=new Promise(r=>release=r);state.catalogEntered=entered
 const count=state.catalogCalls.length,pending=fetch(origin+'/api/operator/'+path,{method:'POST',headers:{cookie:temporary,Origin:origin,'content-type':'application/json'},body:JSON.stringify(input)})
 await started
 const revoke=await context.request.post(origin+'/auth/session/revoke',{headers:{Origin:origin},data:{sessionId:session.id}})
 assert.equal(revoke.status(),204,await revoke.text());state.catalogGate=null;release()
 const withdrawn=await pending,text=await withdrawn.text();assert.equal(withdrawn.status,409,text);assert.ok(!text.includes('business')&&!text.includes(grant));assert.equal(state.catalogCalls.length,count+1,'withdrawn session cannot read a second page or receive metadata')
 for(const {name} of beforeTables.filter(row=>!row.name.startsWith('sqlite_'))){const retained=JSON.stringify(inspect('SELECT * FROM "'+name.replaceAll('"','""')+'"'));assert.ok(!retained.includes(grant)&&!retained.includes('synthetic-private-metadata'),'provider secrets and excluded metadata never enter '+name)}
 assert.deepEqual(inspect('SELECT id FROM ik_door_plans'),beforePlans,'catalog browsing never stages import custody')
 assert.deepEqual(inspect("SELECT name FROM sqlite_master WHERE type='table'"),beforeTables)
 const audit=inspect("SELECT dataset_id,fingerprint,event FROM bf_analytics_reads WHERE dataset_id='bigquery-catalog'")
 assert.ok(audit.some(row=>row.event==='consented'));assert.ok(audit.some(row=>row.event==='failed'));assert.ok(audit.every(row=>/^[a-f0-9]{64}$/.test(row.fingerprint)))
 assert.ok(!JSON.stringify(audit).includes(grant));assert.ok(state.catalogCalls.every(c=>!/(data|jobs|insertAll)$/.test(c.path)));assert.equal(state.calls.length-allCalls,state.catalogCalls.length,'browsing issues metadata GETs only')
 console.log('PROBE BIF-001 catalog: explicit current-owner POST through /app/import -> complete multipage US datasets and tables, nested and repeated types, actionable refusals; no data, job or write request; token-free custody and 1440/390 screens passed (official-schema edges only)')
}

// The same public-door journey can run alone while iterating. CI invokes it
// from runtime.mjs; this entry never substitutes for the push Verify wall.
if(process.argv[1]===new URL(import.meta.url).pathname){
 const {chromium}=await import('@playwright/test'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const persist=await mkdtemp(join(tmpdir(),'bifocal-analytics-')),browser=await chromium.launch({headless:true,...(process.env.BIFOCAL_CHROMIUM ? {executablePath:process.env.BIFOCAL_CHROMIUM} : {}),args:['--use-mock-keychain','--password-store=basic',...(process.env.BIFOCAL_CHROMIUM ? ['--no-sandbox'] : [])]})
 try{const context=await browser.newContext(),page=await context.newPage();await proveAnalyticsBoundaries(null,context,page,persist)}finally{await browser.close();await rm(persist,{recursive:true,force:true})}
}
