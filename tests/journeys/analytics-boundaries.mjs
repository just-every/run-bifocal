import assert from 'node:assert/strict'
import { analyticsEdge } from './analytics-edge.mjs'
const grant='synthetic-bifocal-60'
export async function proveAnalyticsBoundaries(original,context,page,persist) {
 const browserRequests=[]
 const recordRequest=request=>browserRequests.push(request.url())
 page.on('request',recordRequest)
 const edge=await analyticsEdge(persist),{origin,vaneOrigin,state}=edge
 const call=async(path,data,status=200,extra={})=>{
  const response=await context.request.fetch(origin+'/api/operator/'+path.replace(/^\//,''),{method:data===undefined?'GET':'POST',headers:{Origin:origin,...extra},...(data===undefined?{}:{data})})
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
  await proveStripeMovements({origin,context,page,edge,call,apply,shot})
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
 const persist=await mkdtemp(join(tmpdir(),'bifocal-analytics-')),browser=await chromium.launch({headless:true,...(process.env.BIFOCAL_CHROMIUM_PATH?{executablePath:process.env.BIFOCAL_CHROMIUM_PATH}:{}),args:['--use-mock-keychain','--password-store=basic','--no-sandbox']})
 try{const context=await browser.newContext(),page=await context.newPage();await proveAnalyticsBoundaries(null,context,page,persist)}finally{await browser.close();await rm(persist,{recursive:true,force:true})}
}

// One finance sanity flow inside the existing runtime registration: real
// browser, native auth, migrated D1, query and import doors; only HTTPS is faked.
async function proveStripeMovements({origin,context,page,edge,call,apply,shot}) {
 const dataset='synthetic-bifocal-stripe',input={datasetId:dataset,from:'2026-06-01',to:'2026-07-01',accountContext:'Operating account',accessToken:grant,confirmRead:true}
 const route='/analytics/stripe/preview',history=()=>call('/import/history',undefined,200,{'X-Import-Dataset':dataset})
 const importCall=(action,data,status=200)=>call('/import/'+action,data,status,{'X-Import-Dataset':dataset})
 const screen=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await shot('stripe-'+name,width)}await page.setViewportSize({width:1440,height:1000})}
 const initial=edge.state.calls.length
 for(const refused of [{...input,confirmRead:false},{...input,from:'2026-02-30'},{...input,to:'2026-06-01'},{...input,accountContext:'untrusted'+String.fromCharCode(64)+'context'},{...input,datasetId:'../other'}])await call(route,refused,400)
 await call(route,input,401,{Origin:'https://foreign.example.test'})
 await call(route,input,401,{Authorization:'Bearer synthetic-bifocal-999'})
 assert.equal((await fetch(origin+'/api/operator'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401)
 assert.equal(edge.state.calls.length,initial,'denied consent, inputs and authority make no provider request')
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import')
 await page.getByLabel('Dataset id',{exact:true}).fill(dataset);await page.getByText('Read Stripe balance movements',{exact:true}).click()
 const form=page.locator('#stripe-form')
 await form.getByLabel('Stripe account context').fill(input.accountContext);await form.getByLabel('Stripe creation start (UTC)').fill(input.from);await form.getByLabel('Stripe creation end (exclusive, UTC)').fill(input.to);await form.getByLabel('Stripe read-only access token').fill(grant);await form.getByRole('checkbox').check()
 assert.equal(await form.locator('button').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()).length),0)
 assert.ok(await form.locator('input,button').evaluateAll(nodes=>nodes.every(node=>parseFloat(getComputedStyle(node).fontSize)>=13)))
 await page.locator('.menu>summary').focus();assert.equal(await page.getByRole('tooltip',{name:'Open settings',exact:true}).isVisible(),true)
 await form.getByLabel('Stripe account context').focus()
 await page.locator('.menu>summary').hover();await page.getByRole('tooltip',{name:'Open settings',exact:true}).waitFor({state:'visible'})
 await form.hover()
 await screen('setup')
 await form.getByRole('button',{name:'Preview Stripe movements',exact:true}).click()
 await page.locator('#review:not([hidden])').waitFor()
 assert.equal(await form.getByLabel('Stripe read-only access token').inputValue(),'');assert.equal(await form.getByRole('checkbox').isChecked(),false)
 const planId=await page.locator('#review').getAttribute('data-plan-id')
 const reviewText=await page.locator('#source').innerText()
 assert.match(reviewText,/Stripe balance movements/);assert.match(reviewText,/identity unverified/);assert.match(reviewText,/not a transactional source snapshot/);assert.match(reviewText,/2,000 movements/)
 assert.equal((await context.request.get(origin+'/api/operator/datasets/'+dataset)).status(),404,'reading and review do not publish')
 await importCall('apply',{planId,reviewedFingerprint:'0'.repeat(64)},403)
 await screen('review');await apply()
 const published=await call('datasets/'+dataset),rows=published.table.rows,columns=published.table.columns.map(column=>column.name)
 assert.deepEqual(columns,['transaction_id','account_context','created_at','available_at','created_on','available_on','currency','type','status','source','amount','fee','net'])
 assert.deepEqual(rows,[
  ['synthetic-bifocal-301','Operating account','2026-06-30T12:34:56.000Z','2026-07-02T00:00:00.000Z','2026-06-30','2026-07-02','USD','charge','available','synthetic-bifocal-401','123.45','3.45','120.00'],
  ['synthetic-bifocal-302','Operating account','2026-06-29T00:00:00.000Z','2026-07-02T00:00:00.000Z','2026-06-29','2026-07-02','USD','refund','pending','synthetic-bifocal-402','-23.45','0.00','-23.45'],
  ['synthetic-bifocal-303','Operating account','2026-06-28T00:00:00.000Z','2026-07-02T00:00:00.000Z','2026-06-28','2026-07-02','USD','stripe_fee','available',null,'-1.25','0.00','-1.25'],
  ['synthetic-bifocal-304','Operating account','2026-06-27T00:00:00.000Z','2026-07-02T00:00:00.000Z','2026-06-27','2026-07-02','USD','adjustment','available',null,'0.00','0.00','0.00']
 ])
 assert.deepEqual(published.table.columns.filter(column=>['amount','fee','net'].includes(column.name)).map(column=>column.type),['money','money','money'])
 assert.equal(published.table.key,'transaction_id');assert.equal(published.table.source.lineage.kind,'stripe-balance');assert.equal(published.table.source.lineage.timezone,'UTC');assert.equal(published.table.source.lineage.stripe.pages,2);assert.equal(published.table.source.lineage.stripe.rows,4)
 await screen('current')
 const original=await importCall('original/'+planId),envelope=JSON.parse(Buffer.from(original.originals[0].original.base64,'base64'))
 assert.ok(!JSON.stringify(envelope).includes(grant));assert.match(envelope.data,/-23.45/);assert.equal(envelope.lineage.stripe.accountContext,'Operating account')
 const query={version:1,dataset,joins:[],filters:[],groupBy:[],measures:['amount','fee','net'].map(column=>({id:column,op:'sum',column,unit:'money',scale:2,sourceCurrency:'USD'})),context:{modelVersion:'stripe-balance-v1',metricVersion:'balance-movements-v1',accountingBasis:'not-applicable',calendar:{id:'synthetic-bifocal-market-calendar',version:1},rounding:'half-even'}}
 await page.goto(origin+'/app/queries');await page.getByText('New exact answer',{exact:true}).click();await page.getByLabel('Query definition (JSON)').fill(JSON.stringify(query))
 const queried=page.waitForResponse(response=>response.url()===origin+'/api/operator/queries/run'&&response.request().method()==='POST');await page.getByRole('button',{name:'Run exact query',exact:true}).click()
 const answer=await(await queried).json();assert.ok(answer.snapshotId,JSON.stringify(answer));assert.deepEqual(['amount','fee','net'].map(key=>answer.answer.totals[key].value),['98.75','3.45','95.30'])
 await page.locator('#compose-form input[value="'+answer.snapshotId+'"]').waitFor({state:'attached'})
 assert.match(await page.locator('main').innerText(),/95\.30/)
 await screen('query')
 const beforeHistory=await history()
 const failures=[['first-401',403],['first-403',403],['first-429',503],['first-redirect',502],['later-401',403],['later-403',403],['later-429',503],['later-redirect',502],['duplicate',502],['empty-page',502],['currency',502],['net',502],['missing-net',502],['missing-source',502],['expanded-source',502],['unsafe',502],['precision',502],['outside',502],['out-of-order',502],['incomplete',502],['status',502],['credential',502],['escaped-credential',502],['malformed',502],['pages',413],['bytes',413],['deadline',502]]
 for(const [phase,status] of failures) {
  edge.state.stripePhase=phase
  const result=await call(route,{...input,catchup:true},status)
  assert.ok(result.error,'specific redacted diagnostic for '+phase)
  assert.deepEqual(await call('datasets/'+dataset),published,'no partial publication for '+phase)
  assert.deepEqual(await history(),beforeHistory,'no partial plan or retained source for '+phase)
 }
 edge.state.stripePhase='success'
 // Real seeded member, admitted by the native credential verifier. No auth
 // handler, session lookup, authority result or SQL response is replaced.
 const {createOperatorAuth}=await import('../../src/modules/operator-auth/index.mjs')
 const memberId='synthetic-bifocal-305',memberAddress=memberId+String.fromCharCode(64)+'example.test'
 await edge.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) SELECT ?,?,'Finance member','member','active',1,created_at FROM oa_operators WHERE role='owner' LIMIT 1").bind(memberId,memberAddress).run()
 const auth=createOperatorAuth({db:edge.db,clientIp:()=> '127.0.0.1',config:{origin,local:true,OWNER_EMAIL:'synthetic-bifocal-1'+String.fromCharCode(64)+'example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3)}})
 const admitted=await auth.admitVerifiedPassword(new Request(origin+'/auth/password',{method:'POST',headers:{Origin:origin,Host:new URL(origin).host}}),memberId)
 const memberCookie=admitted.cookie.split(';')[0],calls=edge.state.calls.length
 for(const [method,path,data] of [['POST','/api/operator'+route,input],['GET','/api/operator/datasets/'+dataset],['GET','/api/operator/import/original/'+planId],['POST','/api/operator/import/apply',{planId,reviewedFingerprint:beforeHistory.history[0].fingerprint}]]) {
  const response=await fetch(origin+path,{method,headers:{Origin:origin,Cookie:memberCookie,'X-Import-Dataset':dataset,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})})
  assert.equal(response.status,401,await response.text())
 }
 for(const path of ['/api/operator'+route,'/api/operator/datasets/'+dataset,'/api/operator/import/original/'+planId]) {
  const read=path.endsWith('/preview'),response=await fetch(origin+path,{method:read?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-999','X-Import-Dataset':dataset,...(read?{'Content-Type':'application/json'}:{})},...(read?{body:JSON.stringify(input)}:{})})
  assert.equal(response.status,401,await response.text())
 }
 assert.equal(edge.state.calls.length,calls)
 await page.goto(origin+'/app/import');await page.getByLabel('Dataset id',{exact:true}).fill(dataset);await page.getByRole('button',{name:'Load dataset',exact:true}).click();await page.getByRole('button',{name:'Undo import',exact:true}).waitFor()
 await page.getByRole('button',{name:'Undo import',exact:true}).click();await page.getByRole('status').filter({hasText:'Import undone'}).waitFor();await screen('undo')
 await call('datasets/'+dataset,undefined,404)
 await page.getByText('Read Stripe balance movements',{exact:true}).click()
 await form.getByLabel('Stripe account context').fill(input.accountContext);await form.getByLabel('Stripe creation start (UTC)').fill(input.from);await form.getByLabel('Stripe creation end (exclusive, UTC)').fill(input.to);await form.getByLabel('Stripe read-only access token').fill(grant);await form.getByRole('checkbox').check()
 const previewed=page.waitForResponse(response=>response.url()===origin+'/api/operator/analytics/stripe/preview')
 await form.getByRole('button',{name:'Preview Stripe movements',exact:true}).click()
 const next=await(await previewed).json();assert.ok(next.planId,JSON.stringify(next));await apply()
 assert.equal((await importCall('reconcile',{planId:next.planId})).ok,true)
 const current=await call('datasets/'+dataset)
 const protection=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin},data:{confirmDataset:dataset,reviewedDatasetRevision:current.revision,previousRevision:null,legalHold:false,minimumRetainUntil:null}});assert.equal(protection.status(),200,await protection.text())
 const {proveRetentionHold}=await import('./erasure-receipts.mjs');await proveRetentionHold(origin,context,dataset,current.revision)
 const erased=await call('datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision})
 assert.ok(erased.stores.some(store=>store.store==='ik_door_plan_chunks'&&store.rows>0));assert.ok(erased.stores.some(store=>store.store==='bf_query_snapshots'&&store.rows>0))
 await call('datasets/'+dataset,undefined,404);await call('/queries/'+answer.snapshotId,undefined,404);assert.ok((await importCall('original/'+planId)).originals.every(item=>item.original.status==='unavailable'))
 const replay=await context.request.post(origin+'/api/operator/import/apply',{headers:{Origin:origin,'X-Import-Dataset':dataset},data:{planId:next.planId,reviewedFingerprint:next.fingerprint}});assert.equal(replay.status(),410,await replay.text())
 const returned=await call(route,{...input,catchup:true},409);assert.equal(returned.error,'source_erased')
 const audit=await edge.db.prepare('SELECT * FROM bf_analytics_reads WHERE dataset_id=?').bind(dataset).all()
 assert.ok(audit.results.some(row=>row.event==='consented')&&audit.results.some(row=>row.event==='staged')&&audit.results.some(row=>row.event==='failed'));assert.ok(!JSON.stringify(audit.results).includes(grant));assert.ok(audit.results.every(row=>!Object.keys(row).some(key=>/token|response|payload/.test(key))))
 assert.equal((await edge.db.prepare('SELECT count(*) AS count FROM bf_query_sources WHERE dataset_id=?').bind(dataset).first()).count,0)
 assert.equal((await edge.db.prepare('SELECT count(*) AS count FROM bf_file_tables WHERE id=?').bind(dataset).first()).count,0)
 console.log('PROBE BIF-039 bounded Stripe read: 2 pages, 4 exact movements; USD amount 98.75, fee 3.45, net 95.30; native review, Apply, reconciliation, query, Undo, retention hold, erasure and retired replay passed; owner, member and machine isolation, consent, 401, 403, 429 and redirect, later-page, precision, net, duplicate, schema, byte and page and deadline refusals changed no data. Screens at 1440 and 390. Official-schema edge only; live grants and account identity unproved.')
}
