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
  await proveHubspot(edge,context,page,call,shot,apply)
  assert.ok(!browserRequests.some(url=>new URL(url).hostname==='api.hubapi.com'),'the browser sends no credential or request to HubSpot')
  if(process.argv.includes('--hubspot'))return
  await proveSquare(edge,context,page,call,shot,apply)
  if(process.argv.includes('--square'))return
  await proveSmartsheet({origin,context,page,state,call,apply,shot})
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

/** Bounded Smartsheet read, native publication and source custody through the
 * same real browser and HTTP doors as other analytical inputs. */
async function proveSmartsheet({origin,context,page,state,call,apply,shot}) {
 const datasetId='synthetic-bifocal-smartsheet',sheetId='4583173393803140'
 const columns=[{id:'1001',name:'label',type:'text'},{id:'1002',name:'amount',type:'money'},{id:'1003',name:'units',type:'number'},{id:'1004',name:'day',type:'date'},{id:'1005',name:'active',type:'boolean'}]
 const input={datasetId,sheetId,columns,accessToken:grant,confirmRead:true}
 const read=(changes={},status=200,extra={})=>call('smartsheet'+'/'+'preview',{...input,...changes},status,extra)
 const proof=async(name)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await shot('smartsheet-'+name,width)}await page.setViewportSize({width:1440,height:1000})}
 const noRead=state.calls.length
 assert.equal((await fetch(origin+'/api/operator/smartsheet/preview',{method:'POST',headers:{Origin:origin,'content-type':'application'+'/'+'json'},body:JSON.stringify(input)})).status,401)
 await read({confirmRead:false},400);await read({sheetId:'9007199254740993'},400)
 await read({},401,{Origin:'https://synthetic-bifocal.invalid'})
 await read({},401,{Authorization:'Bearer synthetic-bifocal-machine'})
 const memberName=['synthetic-bifocal-smartsheet-member','example.test'].join('@')
 assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin,'X-Bifocal-Test-Mail':'synthetic-bifocal-mail'},data:{email:memberName,displayName:'Smartsheet member',role:'member'}})).status(),202)
 const member=await context.browser().newContext()
 try {
  const messages=await(await context.request.get(origin+'/__analytics-mail')).json(),link=messages.at(-1).text.match(/https?:[^\s]+/)[0],token=new URL(link).searchParams.get('token')
  assert.equal((await member.request.post(origin+'/auth/confirm',{headers:{Origin:origin,'X-Bifocal-Test-Mail':'synthetic-bifocal-mail'},data:{token},maxRedirects:0})).status(),303)
  assert.equal((await(await member.request.get(origin+'/auth/session')).json()).operator.role,'member')
  assert.equal((await member.request.post(origin+'/api/operator/smartsheet/preview',{headers:{Origin:origin},data:input})).status(),401)
  assert.equal((await member.request.get(origin+'/app/import')).status(),403)
 } finally {await member.close()}
 assert.equal(state.calls.length,noRead,'refused principals and missing consent never contact Smartsheet')
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import')
 await page.getByLabel('Dataset id',{exact:true}).fill(datasetId);await page.getByText('Read a Smartsheet snapshot',{exact:true}).click()
 const form=page.locator('#smartsheet-form')
 await form.getByLabel('Smartsheet sheet id').fill(sheetId);await form.getByLabel('Smartsheet column selection (JSON)').fill(JSON.stringify(columns));await form.getByLabel('Smartsheet access token').fill(grant);await form.getByRole('checkbox').check()
 await proof('selected')
 const previewResponse=page.waitForResponse(response=>response.url()===origin+'/api/operator/smartsheet/preview')
 await form.getByRole('button',{name:'Preview Smartsheet snapshot'}).click()
 const previewHttp=await previewResponse;assert.equal(previewHttp.status(),200,await previewHttp.text());const preview=await previewHttp.json()
 assert.equal(preview.counts.rejected,0,JSON.stringify(preview))
 await page.locator('#review:not([hidden])').waitFor()
 assert.equal(await form.getByLabel('Smartsheet access token').inputValue(),'');assert.equal(await form.getByRole('checkbox').isChecked(),false)
 await proof('review')
 assert.equal((await call('datasets/'+datasetId,undefined,404)).error,'dataset_not_found','reading and review alone never publish')
 await call('import'+'/'+'apply',{planId:preview.planId,reviewedFingerprint:'0'.repeat(64)},403,{'X-Import-Dataset':datasetId})
 await apply()
 const current=await call('datasets/'+datasetId),snapshot=current.table.source.smartsheet
 assert.deepEqual(current.table.columns.map(column=>[column.name,column.type]),[['smartsheet_row_id','text'],['label','text'],['amount','money'],['units','number'],['day','date'],['active','boolean']])
 const expectedIds='7000000000000001 7000000000000003 7000000000000005 7000000000000007 7000000000000009 7000000000000011 7000000000000013 7000000000000015 7000000000000017 7000000000000019 7000000000000021 7000000000000023 7000000000000025 7000000000000027 7000000000000029 7000000000000031 7000000000000033 7000000000000035 7000000000000037 7000000000000039 7000000000000041 7000000000000043 7000000000000045 7000000000000047 7000000000000049 7000000000000051 7000000000000053 7000000000000055 7000000000000057 7000000000000059 7000000000000061 7000000000000063 7000000000000065 7000000000000067 7000000000000069 7000000000000071 7000000000000073 7000000000000075 7000000000000077 7000000000000079 7000000000000081 7000000000000083 7000000000000085 7000000000000087 7000000000000089 7000000000000091 7000000000000093 7000000000000095 7000000000000097 7000000000000099 7000000000000101 7000000000000103 7000000000000105 7000000000000107 7000000000000109 7000000000000111 7000000000000113 7000000000000115 7000000000000117 7000000000000119 7000000000000121 7000000000000123 7000000000000125 7000000000000127 7000000000000129 7000000000000131 7000000000000133 7000000000000135 7000000000000137 7000000000000139 7000000000000141 7000000000000143 7000000000000145 7000000000000147 7000000000000149 7000000000000151 7000000000000153 7000000000000155 7000000000000157 7000000000000159 7000000000000161 7000000000000163 7000000000000165 7000000000000167 7000000000000169 7000000000000171 7000000000000173 7000000000000175 7000000000000177 7000000000000179 7000000000000181 7000000000000183 7000000000000185 7000000000000187 7000000000000189 7000000000000191 7000000000000193 7000000000000195 7000000000000197 7000000000000199 7000000000000201'.split(' ')
 assert.deepEqual(current.table.rows.map(row=>row[0]),expectedIds);assert.deepEqual(snapshot.rowIds,expectedIds)
 assert.equal(snapshot.sheetId,sheetId);assert.equal(snapshot.version,17);assert.deepEqual(snapshot.columns.map(column=>column.id),['1001','1002','1003','1004','1005'])
 assert.deepEqual(current.table.rows.slice(0,3),[['7000000000000001','','123.45','2','2026-06-30',true],['7000000000000003',null,'-23.40','3',null,false],['7000000000000005','=HYPERLINK("https://synthetic-bifocal.invalid")','0.00','0',null,null]])
 assert.deepEqual(snapshot.formulas,[{rowId:'7000000000000001',columnId:'1002',formula:'=SUM([Amount]2:[Amount]3)',cached:'123.45'}])
 const reads=state.calls.slice(noRead).filter(request=>request.host==='api.smartsheet.com')
 assert.deepEqual(reads.map(request=>request.path.endsWith('/version')?'version':new URLSearchParams(request.search).get('page')),['1','2','version'])
 const original=async(planId=preview.planId)=>{
  const response=await context.request.get(origin+'/api/operator/import/original/'+planId,{headers:{'X-Import-Dataset':datasetId}})
  assert.equal(response.status(),200);return response.json()
 }
 const retained=await original(),envelope=JSON.parse(Buffer.from(retained.originals[0].original.base64,'base64'))
 assert.deepEqual(envelope.smartsheet,snapshot);assert.ok(!JSON.stringify(envelope).includes(grant))
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download original',exact:true}).click()
 const download=await downloadEvent;assert.equal(download.suggestedFilename(),'smartsheet-snapshot.json')
 const stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part)
 assert.deepEqual(JSON.parse(Buffer.concat(parts)),envelope,'The protected browser original retains formulas, identities and typed mapping')
 assert.ok(!(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).includes(grant))
 const database=await state.database(),tables=await database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND (name LIKE 'bf_%' OR name LIKE 'ik_%')").all()
 for(const {name} of tables.results){assert.match(name,/^[a-z0-9_]+$/);const records=await database.prepare('SELECT * FROM '+name).all();assert.ok(!JSON.stringify(records.results).includes(grant),name+' never retains a provider token');for(const record of records.results)for(const value of Object.values(record)){const bytes=Array.isArray(value)?Buffer.from(value):typeof value==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(value)?Buffer.from(value,'base64'):null;if(bytes)assert.ok(!bytes.includes(Buffer.from(grant)),name+' retains no encoded provider token')}}
 await proof('applied')
 await page.goto(origin+'/app/queries');await page.getByText('New exact answer',{exact:true}).click()
 const query={version:1,dataset:datasetId,joins:[],filters:[],groupBy:[],measures:[{id:'revenue',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD'}],context:{modelVersion:'smartsheet-native-v1',metricVersion:'owner-defined-v1',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-market-calendar',version:1},rounding:'half-even'}}
 await page.getByLabel('Query definition (JSON)').fill(JSON.stringify(query))
 const queryResponse=page.waitForResponse(response=>response.url()===origin+'/api/operator/queries/run'&&response.request().method()==='POST')
 await page.getByRole('button',{name:'Run exact query',exact:true}).click();const answer=await(await queryResponse).json()
 assert.equal(answer.answer.totals.revenue.value,'100.05',JSON.stringify(answer))
 const board=await call('dashboards',{queryId:answer.queryId,title:'Smartsheet exact USD'},201)
 await page.locator('#compose-form input[value="'+answer.snapshotId+'"]').waitFor({state:'attached'});await proof('query')
 for(const [phase,status,error] of [['schema-drift',409,'smartsheet_version_drift'],['column-missing',502,'smartsheet_selected_columns_missing'],['response-overflow',413,'provider_response_limit'],['snapshot-overflow',413,'smartsheet_snapshot_limit'],['page-drift',409,'smartsheet_version_drift'],['final-drift',409,'smartsheet_version_drift'],['missing-row',502,'smartsheet_incomplete_rows'],['duplicate-row',502,'smartsheet_incomplete_rows'],['row-overflow',413,'smartsheet_row_limit'],['unsafe-id',502,'smartsheet_unsafe_numeric_precision'],['unsafe-decimal',502,'smartsheet_unsafe_numeric_precision'],['complex-column',502,'smartsheet_unsupported_column_type'],['complex-cell',502,'smartsheet_unsupported_cell_value'],['cell-overflow',502,'smartsheet_text_required'],['money-precision',502,'smartsheet_usd_precision_required'],['empty',422,'smartsheet_empty_sheet'],['denied',502,'provider_request_failed'],['revoked',403,'provider_grant_refused'],['final-revoked',403,'provider_grant_refused'],['rate',503,'provider_rate_limited'],['redirect',502,'provider_redirect_refused'],['token-echo',502,'provider_credential_in_response']]) {
  state.smartsheet=phase;const refused=await read({catchup:true},status);assert.equal(refused.error,error,phase)
  if(phase==='complex-column')assert.deepEqual(refused.details,{columnId:'1001',sourceType:'MULTI_PICKLIST'})
  assert.deepEqual(await call('datasets/'+datasetId),current,'refused '+phase+' preserves the complete last-good table')
 }
 state.smartsheet='revoked'
 await page.goto(origin+'/app/import?dataset='+datasetId);await page.getByText('Read a Smartsheet snapshot',{exact:true}).click()
 await form.getByLabel('Smartsheet sheet id').fill(sheetId);await form.getByLabel('Smartsheet column selection (JSON)').fill(JSON.stringify(columns));await form.getByLabel('Smartsheet access token').fill(grant);await form.getByRole('checkbox').check()
 const refusedResponse=page.waitForResponse(response=>response.url()===origin+'/api/operator/smartsheet/preview')
 await form.getByRole('button',{name:'Preview Smartsheet snapshot'}).click();assert.equal((await refusedResponse).status(),403)
 await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true')
 assert.match(await page.locator('#status').innerText(),/provider_grant_refused/);assert.equal(await form.getByLabel('Smartsheet access token').inputValue(),'')
 await proof('refused');assert.deepEqual(await call('datasets/'+datasetId),current)
 state.smartsheet='success'
 // A new exact read has its own consent and cannot revive an old approval.
 const changedReview=await read({catchup:true});await call('import'+'/'+'apply',{planId:changedReview.planId,reviewedFingerprint:preview.fingerprint},403,{'X-Import-Dataset':datasetId})
 await call('import'+'/'+'undo',{planId:changedReview.planId},200,{'X-Import-Dataset':datasetId})
 await page.goto(origin+'/app/import?dataset='+datasetId);await page.getByRole('button',{name:'Undo import',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import undone'))
 await call('datasets/'+datasetId,undefined,404);assert.deepEqual((await call('queries/'+answer.queryId)).answer,answer.answer,'Undo preserves the immutable owner-held historical answer')
 await proof('undone')
 await page.getByText('Read a Smartsheet snapshot',{exact:true}).click()
 await form.getByLabel('Smartsheet sheet id').fill(sheetId);await form.getByLabel('Smartsheet column selection (JSON)').fill(JSON.stringify(columns));await form.getByLabel('Smartsheet access token').fill(grant);await form.getByRole('checkbox').check()
 const reapplyResponse=page.waitForResponse(response=>response.url()===origin+'/api/operator/smartsheet/preview')
 await form.getByRole('button',{name:'Preview Smartsheet snapshot'}).click()
 const reapplyHttp=await reapplyResponse;assert.equal(reapplyHttp.status(),200,await reapplyHttp.text());const reapplied=await reapplyHttp.json();await apply()
 const fresh=await call('datasets/'+datasetId),erase=()=>call('datasets/'+datasetId+'/erase',{confirmDataset:datasetId,reviewedRevision:fresh.revision})
 let previousRevision=null
 for(const protection of [{legalHold:true,minimumRetainUntil:null},{legalHold:false,minimumRetainUntil:'2099-01-01T00:00:00.000Z'}]) {
  const response=await context.request.put(origin+'/api/operator/retention/'+datasetId,{headers:{Origin:origin},data:{confirmDataset:datasetId,reviewedDatasetRevision:fresh.revision,previousRevision,...protection,releaseHold:true}})
  assert.equal(response.status(),200,await response.text());previousRevision=(await response.json()).revision
  await call('datasets/'+datasetId+'/erase',{confirmDataset:datasetId,reviewedRevision:fresh.revision},423)
  assert.deepEqual(await call('datasets/'+datasetId),fresh);assert.deepEqual(await original(),retained)
 }
 const release=await context.request.put(origin+'/api/operator/retention/'+datasetId,{headers:{Origin:origin},data:{confirmDataset:datasetId,reviewedDatasetRevision:fresh.revision,previousRevision,legalHold:false,minimumRetainUntil:null,releaseHold:true}});assert.equal(release.status(),200)
 const receipt=await erase();assert.equal(receipt.phase,'complete')
 for(const capture of [preview,reapplied])assert.ok((await original(capture.planId)).originals.every(item=>item.original.status==='unavailable'))
 for(const {name} of tables.results){const records=await database.prepare('SELECT * FROM '+name).all();const text=JSON.stringify(records.results);assert.ok(!text.includes('7000000000000001')&&!text.includes('=SUM([Amount]2:[Amount]3)'),name+' removes controlled Smartsheet values')}
 assert.equal((await context.request.get(origin+'/api/operator/import/original/'+changedReview.planId,{headers:{'X-Import-Dataset':datasetId}})).status(),404,'A cancelled unapproved capture exposes no original')
 await call('datasets/'+datasetId,undefined,404);await call('queries/'+answer.queryId,undefined,404);await call('dashboards/'+board.id,undefined,404)
 await call('import'+'/'+'apply',{planId:reapplied.planId,reviewedFingerprint:reapplied.fingerprint},410,{'X-Import-Dataset':datasetId})
 const retired=await read({catchup:true},409);assert.equal(retired.error,'source_erased')
 console.log('Smartsheet: exact browser selection, same-version paging, full stable identities, null and empty text, inert formulas, USD 100.05, review and approval, reconciliation, Undo, scope and provider refusals, last-good preservation, protected retention and eligible erasure passed; 1440 and 390 screens, official-schema HTTPS edges only')
}

// The same public-door journey can run alone while iterating. CI invokes it
// from runtime.mjs; this entry never substitutes for the push Verify wall.
if(process.argv[1]===new URL(import.meta.url).pathname){
 const {chromium}=await import('@playwright/test'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const persist=await mkdtemp(join(tmpdir(),'bifocal-analytics-')),browser=await chromium.launch({headless:true,...((process.env.CHROMIUM_EXECUTABLE_PATH??process.env.BIFOCAL_CHROMIUM)?{executablePath:(process.env.CHROMIUM_EXECUTABLE_PATH??process.env.BIFOCAL_CHROMIUM)}:{}),args:['--use-mock-keychain','--password-store=basic','--no-sandbox']})
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

/** Actual HubSpot browser read, shared publication, exact queries and custody.
 * Assertions run at 1440; changed screens also have one phone proof. */
async function proveHubspot({origin,state,database,signInAs},context,page,call,shot,apply){
 const id='hubspot-deals',input={datasetId:id,accountContext:'Synthetic sales account',accessToken:grant,confirmRead:true}
 const post=(action,data,status=200)=>call('import/'+action,data,status,{'X-Import-Dataset':id})
 const read=(extra={},status=200)=>call('analytics/hubspot/preview',{...input,...extra},status,{},'POST',60000)
 const noRead=state.calls.length
 await read({confirmRead:false},400);await read({accountContext:''},400)
 for(const extra of [{url:'https://foreign.example.test'},{method:'POST'},{properties:['private_note']},{after:'2'},{archived:true}])await read(extra,400)
 await call('analytics/hubspot/preview',input,401,{Authorization:'Bearer synthetic-bifocal-machine'});await call('analytics/hubspot/preview',input,401,{Origin:'https://foreign.example.test'})
 assert.equal((await fetch(origin+'/api/operator/analytics/hubspot/preview',{method:'POST',headers:{Origin:origin,'content-type':'application'+'/'+'json'},body:JSON.stringify(input)})).status,401)
 const member=await context.browser().newContext()
 try{
  const session=await signInAs(member,['synthetic-bifocal-hubspot-member','example.test'].join('@'),context);assert.equal(session.operator.role,'member')
  assert.equal((await member.request.post(origin+'/api/operator/analytics/hubspot/preview',{headers:{Origin:origin},data:input})).status(),401)
  assert.equal((await member.request.get(origin+'/api/operator/datasets/'+id)).status(),401)
  assert.equal((await member.request.post(origin+'/api/operator/datasets/'+id+'/erase',{headers:{Origin:origin},data:{confirmDataset:id,reviewedRevision:null}})).status(),401)
 }finally{await member.close()}
 assert.equal(state.calls.length,noRead,'foreign, anonymous, member and machine requests never contact HubSpot')
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.getByLabel('Dataset id',{exact:true}).fill(id);await page.getByText('Read HubSpot deal pipeline',{exact:true}).click()
 const form=page.locator('#hubspot-form'),fill=async()=>{await form.getByLabel('HubSpot account context (unverified)').fill(input.accountContext);await form.getByLabel('HubSpot deals read access token').fill(grant);await form.getByRole('checkbox').check()}
 state.hubspotPhase='empty-paging'
 await fill();await shot('hubspot-setup',1440);await form.getByRole('button',{name:'Preview HubSpot deals'}).click();await page.locator('#review:not([hidden])').waitFor()
 assert.equal(await form.getByLabel('HubSpot deals read access token').inputValue(),'');assert.equal(await form.getByRole('checkbox').isChecked(),false)
 await call('datasets/'+id,undefined,404);await shot('hubspot-review',1440);await apply();await shot('hubspot-applied',1440)
 const current=await call('datasets/'+id),names=current.table.columns.map(c=>c.name),records=current.table.rows.map(row=>Object.fromEntries(names.map((name,i)=>[name,row[i]])))
 assert.equal(current.table.key,'deal_id');assert.equal(current.table.source.lineage.kind,'hubspot-deals');assert.equal(current.table.source.lineage.pages,2);assert.equal(current.table.source.lineage.accountContext,'Synthetic sales account');assert.equal(current.table.source.lineage.from,'')
 assert.deepEqual(records.map(r=>r.deal_id),['9007199254740993','9007199254740995','9007199254740997','9007199254740999','9007199254741001'])
 assert.deepEqual(records.map(r=>[r.pipeline_id,r.stage_id]),[['default','qualifiedtobuy'],['default','closedlost'],['default','qualifiedtobuy'],['default','closedlost'],['synthetic-bifocal-second','presentationscheduled']])
 assert.deepEqual(records.map(r=>[r.amount_observed,r.currency_observed,r.observed_pipeline_value]),[['123.45','USD','123.45'],['-23.4','USD','-23.40'],['0','USD','0.00'],[null,null,null],['','USD',null]])
 assert.equal(records[1].deal_name,'');assert.equal(records[3].deal_name,null);assert.equal(records[0].close_date,'2026-07-31T00:00:00.000Z');assert.equal(records[1].close_date,null);assert.equal(records[2].created_at,'2026-06-03T12:00:00.000Z');assert.equal(records[2].updated_at,'2026-06-13T12:00:00.000Z');assert.equal(records[0].created_date,'2026-06-01T12:00:00.000Z');assert.equal(records[0].modified_date,'2026-06-11T12:00:00.000Z')
 for(const [path,data]of [['datasets/'+id,undefined],['import'+'/'+'history',undefined],['datasets/'+id+'/erase',{confirmDataset:id,reviewedRevision:current.revision}]])await call(path,data,401,{Authorization:'Bearer synthetic-bifocal-machine','X-Import-Dataset':id})
 const initial=(await post('history')).history[0],originals=await post('original/'+initial.planId),original=originals.originals.filter(e=>e.original.status==='retained').map(e=>Buffer.from(e.original.base64,'base64').toString('utf8')).join('\n')
 assert.ok(original.includes('9007199254740993'));assert.ok(original.includes('-23.4'))
 for(const excluded of [grant,'private_note','synthetic-bifocal-private-contact','must-never-follow'])assert.ok(!original.includes(excluded),'credential, unrelated properties and provider next links never enter retained originals')
 const query={version:1,dataset:id,joins:[],filters:[],groupBy:['stage_id'],measures:[{id:'pipeline-value',op:'sum',column:'observed_pipeline_value',unit:'money',sourceCurrency:'USD',scale:2},{id:'deals',op:'count',unit:'count',scale:0}],context:{modelVersion:'native-business-v1',metricVersion:'observed-pipeline-v1',accountingBasis:'not-applicable',calendar:{id:'synthetic-bifocal-market-calendar',version:1},rounding:'half-even'}}
 await page.goto(origin+'/app/queries');await page.getByText('New exact answer',{exact:true}).click();await page.getByLabel('Query definition (JSON)').fill(JSON.stringify(query))
 const running=page.waitForResponse(r=>r.url()===origin+'/api/operator/queries/run'&&r.request().method()==='POST');await page.getByRole('button',{name:'Run exact query',exact:true}).click();const response=await running,answer=await response.json();assert.equal(response.status(),201,JSON.stringify(answer))
 assert.equal(answer.answer.totals['pipeline-value'].value,'100.05');assert.equal(answer.answer.totals['pipeline-value'].nulls,2);assert.equal(answer.answer.totals.deals.value,'5')
 assert.deepEqual(Object.fromEntries(answer.answer.rows.map(r=>[r.dimensions[0],[r.values['pipeline-value'].value,r.values.deals.value]])),{qualifiedtobuy:['123.45','2'],closedlost:['-23.40','2'],presentationscheduled:[null,'1']})
 await page.locator('#answer:not([hidden])').waitFor();await shot('hubspot-answer',1440)
 const plansBefore=await database.prepare('SELECT count(*) AS n FROM ik_door_plans').first()
 for(const [phase,status]of [['401',403],['403',403],['429',503],['redirect',502],['warnings',502],['deal-warnings',502],['errors',502],['duplicate',502],['conflict',502],['loop',502],['bad-cursor',502],['archived',502],['precision',502],['number',502],['unsafe',502],['currency',502],['ambiguous',502],['date',502],['credential',502],['incomplete',502],['missing',502],['rows',413],['pages',413],['bytes',413],['deadline',502],['empty',422]]){
  state.hubspotPhase=phase;const start=state.calls.length,refused=await read({catchup:true},status)
  assert.ok(!JSON.stringify(refused).includes('synthetic-bifocal-private-diagnostic'));assert.ok(state.calls.slice(start).every(c=>c.host==='api.hubapi.com'&&c.path==='/crm/v3/objects/0-3'&&c.method==='GET'))
  assert.deepEqual(await call('datasets/'+id),current,phase+' preserves last-good values');assert.deepEqual(await database.prepare('SELECT count(*) AS n FROM ik_door_plans').first(),plansBefore,phase+' stages no partial capture')
 }
 state.hubspotPhase='success'
 const withdrawing=await context.browser().newContext();let release
 try{
  const session=await signInAs(withdrawing,['synthetic-bifocal-1','example.test'].join('@'));let reached
  const paused=new Promise(resolve=>{reached=resolve});state.hubspotPause=async()=>{reached();await new Promise(resolve=>{release=resolve})}
  const reading=withdrawing.request.post(origin+'/api/operator/analytics/hubspot/preview',{headers:{Origin:origin},data:{...input,catchup:true}})
  const early=await Promise.race([paused.then(()=>null),reading]);assert.equal(early,null,'the read reaches its second page')
  assert.equal((await context.request.post(origin+'/auth/session/revoke',{headers:{Origin:origin},data:{sessionId:session.id}})).status(),204)
  release();const refused=await reading;assert.equal(refused.status(),409,await refused.text());assert.deepEqual(await call('datasets/'+id),current);assert.deepEqual(await database.prepare('SELECT count(*) AS n FROM ik_door_plans').first(),plansBefore)
 }finally{release?.();state.hubspotPause=null;await withdrawing.close()}
 await call('queries/'+answer.queryId,undefined,403,{Authorization:'Bearer synthetic-bifocal-machine'});await call('queries/run',query,403,{Authorization:'Bearer synthetic-bifocal-machine'})
 const stale=await read({catchup:true});await call('import'+'/'+'apply',{planId:stale.planId,reviewedFingerprint:stale.fingerprint},401,{Authorization:'Bearer synthetic-bifocal-machine','X-Import-Dataset':id});await call('import'+'/'+'undo',{planId:stale.planId},401,{Authorization:'Bearer synthetic-bifocal-machine','X-Import-Dataset':id});await post('apply',{planId:stale.planId,reviewedFingerprint:'0'.repeat(64)},403)
 await read({catchup:true},409);assert.deepEqual(await call('datasets/'+id),current,'a second pending read cannot replace the source');await post('undo',{planId:stale.planId})
 const next=await read({catchup:true}),applyPlan=async plan=>{for(let n=0;n<20;n++)if((await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})).job.state==='completed')return;assert.fail('HubSpot Apply completes')}
 await applyPlan(next);await post('apply',{planId:stale.planId,reviewedFingerprint:stale.fingerprint},404)
 await post('undo',{planId:next.planId});assert.deepEqual((await call('datasets/'+id)).table,current.table)
 await page.setViewportSize({width:390,height:1000});await page.goto(origin+'/app/import');await page.getByLabel('Dataset id',{exact:true}).fill(id);await page.getByText('Read HubSpot deal pipeline',{exact:true}).click();await fill();await shot('hubspot-setup',390)
 state.hubspotPhase='changed';await form.getByRole('button',{name:'Preview HubSpot deals'}).click();await page.locator('#review:not([hidden])').waitFor();await shot('hubspot-review',390);await apply();await shot('hubspot-applied',390)
 const changed=await call('queries/run',query,201);assert.equal(changed.answer.totals['pipeline-value'].value,'150.10');assert.equal((await call('queries/'+answer.queryId)).answer.totals['pipeline-value'].value,'100.05','historical answer is immutable')
 await page.goto(origin+'/app/queries/'+changed.queryId);await page.locator('#answer:not([hidden])').waitFor();await shot('hubspot-answer',390)
 await page.goto(origin+'/app/import?dataset='+id);await page.getByRole('button',{name:'Undo import',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import undone'));await shot('hubspot-undone',390)
 await page.setViewportSize({width:1440,height:1000});assert.deepEqual((await call('datasets/'+id)).table,current.table);state.hubspotPhase='success'
 const custodyTables=await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'bf_%' OR name LIKE 'ik_%')").all()
 for(const {name}of custodyTables.results){const rows=await database.prepare('SELECT * FROM '+name).all();assert.ok(!JSON.stringify(rows.results).includes(grant),name+' retains no HubSpot credential before erasure')}
 const revision=(await call('datasets/'+id)).revision
 let retention=await call('retention/'+id,{confirmDataset:id,reviewedDatasetRevision:revision,previousRevision:null,legalHold:true,minimumRetainUntil:null},200,{},'PUT')
 await call('datasets/'+id+'/erase',{confirmDataset:id,reviewedRevision:revision},423)
 retention=await call('retention/'+id,{confirmDataset:id,reviewedDatasetRevision:revision,previousRevision:retention.revision,legalHold:false,minimumRetainUntil:'9999-01-01T00:00:00.000Z',releaseHold:true},200,{},'PUT')
 await call('datasets/'+id+'/erase',{confirmDataset:id,reviewedRevision:revision},423)
 await call('retention/'+id,{confirmDataset:id,reviewedDatasetRevision:revision,previousRevision:retention.revision,legalHold:false,minimumRetainUntil:null,releaseHold:true},200,{},'PUT')
 const erased=await call('datasets/'+id+'/erase',{confirmDataset:id,reviewedRevision:revision});assert.ok(erased.stores.some(s=>s.store==='bf_query_snapshots'&&s.rows>0))
 await call('datasets/'+id,undefined,404);await call('queries/'+answer.queryId,undefined,404);await call('queries/'+changed.queryId,undefined,404)
 const erasedOriginal=await post('original/'+initial.planId);assert.ok(erasedOriginal.originals.every(e=>e.original.status!=='retained'&&!e.original.base64))
 await post('apply',{planId:stale.planId,reviewedFingerprint:stale.fingerprint},404);assert.equal((await read({catchup:true},409)).error,'source_erased')
 const tables=await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'bf_%' OR name LIKE 'ik_%')").all()
 for(const {name}of tables.results){const rows=await database.prepare('SELECT * FROM '+name).all(),text=JSON.stringify(rows.results);assert.ok(!text.includes(grant),name+' retains no HubSpot credential');assert.ok(!text.includes('9007199254740993'),name+' erases controlled deal identity')}
 const audit=await database.prepare('SELECT event FROM bf_analytics_reads WHERE dataset_id=?').bind(id).all();assert.ok(audit.results.some(r=>r.event==='consented'));assert.ok(audit.results.some(r=>r.event==='staged'));assert.ok(audit.results.some(r=>r.event==='failed'))
 console.log('PROBE BIF-040 acquisition: /app/import HubSpot -> five independently enumerated stable deal IDs over two pages; separate exact review, approval, Apply and reconciliation at 1440 and 390')
 console.log('PROBE BIF-040 money and dates: /api/operator/queries/run -> observed USD 100.05; stage counts 2, 2, 1; two unknown amounts, empty versus null text and exact raw evidence preserved')
 console.log('PROBE BIF-040 changed observations: explicit new read -> USD 150.10, historical answer stays 100.05; Undo restores all prior rows')
 console.log('PROBE BIF-040 refusals: later-page HTTP, redirect, warnings, IDs, cursors, unsafe money and aggregate bounds -> no plan, unchanged last-good source')
 console.log('PROBE BIF-040 authority: member, anonymous, foreign, machine plus owner cookie and mid-read revoked session -> no unauthorized read or staged capture')
 console.log('PROBE BIF-040 custody: stale approval and replay refused; credential-free originals and audit; legal hold and minimum retention block erasure, eligible erasure removes originals, controlled IDs and saved answers')
}
