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
  const initialCalls=state.calls.length
  await call('analytics/vane/preview',{datasetId:'synthetic-bifocal-denied',siteId:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:false},400)
  await call('analytics/vane/preview',{datasetId:'synthetic-bifocal-denied',siteId:'synthetic-bifocal-61',from:'2026-06-01',to:'2026-07-01',accessToken:grant,confirmRead:true},401,{Origin:'https://foreign.example.test'})
  assert.equal(state.calls.length,initialCalls)
  await call('calendars',{id:'synthetic-bifocal-market-calendar',previousVersion:null,definition:{name:'Business calendar',kind:'fiscal',startMonth:1}},201)
  await proveJiraFlow(edge,context,page,call,apply,shot)
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


async function proveJiraFlow(edge,context,page,call,apply,shot) {
 const {origin,state,cloudId,siteUrl}=edge,dataset='synthetic-bifocal-jira',headers={Origin:origin,'X-Import-Dataset':dataset}
 const selection={cloudId,siteUrl,projectId:'10000',projectKey:'BIF',datasetId:dataset,accessToken:grant,confirmRead:true}
 const post=async(action,data,status=200)=>{const response=await context.request.fetch(origin+'/api/operator/import/'+action,{method:data===undefined?'GET':'POST',headers,...(data===undefined?{}:{data})});const text=await response.text();assert.equal(response.status(),status,text);return JSON.parse(text)}
 const read=()=>call('datasets/'+dataset)
 const screen=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await shot('jira-'+name,width)}await page.setViewportSize({width:1440,height:1000})}
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import')
 await page.getByLabel('Dataset id',{exact:true}).fill(dataset);await page.getByText('Read Jira work outcomes',{exact:true}).click()
 const discovery=page.locator('#jira-resources-form'),form=page.locator('#jira-form')
 await discovery.getByLabel('Jira discovery bearer').fill(grant);await discovery.getByRole('checkbox').check();await discovery.getByRole('button',{name:'Find permitted Jira sites'}).click()
 await form.getByLabel('Permitted Jira site').selectOption('0')
 assert.deepEqual(await form.getByLabel('Permitted Jira site').locator('option').allTextContents(),['Choose a permitted site',siteUrl+' · read:jira-work'])
 await form.getByLabel('Jira project id').fill('10000');await form.getByLabel('Jira project key').fill('BIF')
 await form.getByLabel('Jira read bearer').fill(grant);await form.getByRole('checkbox').check();await screen('selected')
 await form.getByRole('button',{name:'Preview Jira work outcomes'}).click();await page.locator('#review:not([hidden])').waitFor()
 assert.equal(await discovery.getByLabel('Jira discovery bearer').inputValue(),'');assert.equal(await form.getByLabel('Jira read bearer').inputValue(),'')
 assert.equal((await context.request.get(origin+'/api/operator/datasets/'+dataset)).status(),404,'read never applies a plan')
 const firstPlan=page.locator('#review'),firstId=await firstPlan.getAttribute('data-plan-id')
 await screen('review');await apply()
 const first=await read(),expected=[
  ['10101','BIF-11','10000','BIF','1','Task','3','Done','2026-06-01T09:00:00.000+0000','2026-06-30T18:00:00.000+0000','2026-06-30T17:00:00.000+0000','1'],
  ['10102','BIF-12','10000','BIF','2','Bug','1','Open','2026-06-01T09:00:00.000+0000','2026-06-30T18:00:00.000+0000',null,'1'],
  ['10103','BIF-13','10000','BIF','1','Task','2','In progress','2026-06-01T09:00:00.000+0000','2026-06-30T18:00:00.000+0000',null,'1'],
  ['10104','BIF-14','10000','BIF','2','Bug','3','Done','2026-06-01T09:00:00.000+0000','2026-06-30T18:00:00.000+0000','2026-06-29T17:00:00.000+0000','1']]
 assert.deepEqual(first.table.rows,expected,'independently enumerated issue identities, exact timestamps and nulls across pages')
 assert.equal(first.table.key,'issue_id');assert.equal(first.table.source.lineage.kind,'jira-work');assert.deepEqual(first.table.source.lineage.jira,{cloudId,projectId:'10000',projectKey:'BIF',pages:2,issues:4});assert.equal(first.table.source.lineage.link,siteUrl+'/plugins/servlet/project-config/BIF')
 await screen('applied')
 const history=await post('history',undefined),firstFingerprint=history.history.find(item=>item.planId===firstId).fingerprint
 const retained=await post('original/'+firstId,undefined),envelope=JSON.parse(Buffer.from(retained.originals[0].original.base64,'base64'))
 assert.deepEqual(Object.keys(envelope.columns),['issue_id','issue_key','project_id','project_key','type_id','issue_type','status_id','status','created_at','updated_at','resolved_at','issue_count'])
 for(const prohibited of [grant,'synthetic-bifocal-private-description','synthetic-bifocal-private-person','synthetic-bifocal-private-custom','Discarded site name'])assert.ok(!JSON.stringify(envelope).includes(prohibited),'excluded data never reaches original custody: '+prohibited)
 const query={version:1,dataset,joins:[],filters:[],groupBy:['issue_type','status'],measures:[{id:'issues',op:'sum',column:'issue_count',unit:'count',scale:0}],context:{modelVersion:'native-work-v1',metricVersion:'owner-work-v1',accountingBasis:'not-applicable',calendar:{id:'synthetic-bifocal-market-calendar',version:1},rounding:'half-even'}}
 await page.goto(origin+'/app/queries');await page.getByText('New exact answer',{exact:true}).click();await page.getByLabel('Query definition (JSON)').fill(JSON.stringify(query))
 const response=page.waitForResponse(r=>r.url()===origin+'/api/operator/queries/run'&&r.request().method()==='POST');await page.getByRole('button',{name:'Run exact query',exact:true}).click();const answer=await(await response).json()
 assert.equal(answer.answer.totals.issues.value,'4');assert.deepEqual(answer.answer.rows.map(row=>[...row.dimensions,row.values.issues.value]).sort(),[['Bug','Done','1'],['Bug','Open','1'],['Task','Done','1'],['Task','In progress','1']].sort())
 await page.locator('#compose-form input[value="'+answer.snapshotId+'"]').waitFor({state:'attached'});await screen('work-counts')
 console.log('PROBE BIF-042 work totals: browser selected site and multipage project read, exact review and Apply, native query -> four issue identities and four exact type and status groups; unresolved timestamps stay null')
 const beforeCalls=state.calls.length
 for(const overrides of [{confirmRead:false},{siteUrl:'https://foreign-synthetic-bifocal.atlassian.net'},{cloudId:'31223344-a1b2-3b33-c444-def123456789'},{projectId:'10000 OR 1=1'},{fields:['description']}])await call('work/jira/preview',{...selection,catchup:true,...overrides},overrides.siteUrl||overrides.cloudId?403:400)
 await call('work/jira/preview',{...selection,catchup:true},401,{Origin:'https://foreign.example.test'})
 await call('work/jira/preview',{...selection,catchup:true},401,{Authorization:'Bearer synthetic-bifocal-machine'})
 assert.equal(state.calls.slice(beforeCalls).filter(item=>item.path.includes('/search/jql')).length,0)
 const anonymous=await fetch(origin+'/api/operator/work/jira/resources',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({accessToken:grant,confirmRead:true})});assert.equal(anonymous.status,401)
 // Real native session proof: invite with the native auth transport and a
 // local mail sink, then consume its link through the emitted HTTP handler.
 const {createOperatorAuth,createAuthHandler}=await import('../../src/modules/operator-auth/index.mjs'),mail=[]
 const owner=(await(await context.request.get(origin+'/auth/session')).json()).operator
 const cookie=(await context.cookies(origin)).map(cookie=>cookie.name+'='+cookie.value).join('; ')
 const auth=createOperatorAuth({db:await edge.database(),clientIp:()=>'127.0.0.1',config:{dependencies:true,origin,local:true,OWNER_EMAIL:owner.email,SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:owner.email},mailSender:{async send(message){mail.push(message);return {status:'accepted',provider:'resend',providerMessageId:'synthetic-bifocal-mail'}}}})
 const invited=await createAuthHandler(auth)(new Request(origin+'/auth/invite',{method:'POST',headers:{Origin:origin,Host:new URL(origin).host,cookie,'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic-bifocal-jira-member'+owner.email.slice(owner.email.indexOf('@')),displayName:'Synthetic Jira member',role:'member'})}));assert.equal(invited.status,202,await invited.text())
 const member=await context.browser().newContext()
 try {
  const token=new URL(mail[0].text.match(/https?:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
  const signedIn=await member.request.post(origin+'/auth/confirm',{headers:{Origin:origin},data:{token},maxRedirects:0});assert.equal(signedIn.status(),303,await signedIn.text())
  const count=state.calls.length
  for(const path of ['resources','preview'])assert.equal((await member.request.post(origin+'/api/operator/work/jira/'+path,{headers:{Origin:origin},data:selection})).status(),401)
  assert.equal(state.calls.length,count,'member refusal happens before egress')
  assert.equal((await member.request.get(origin+'/api/operator/datasets/'+dataset)).status(),401)
 } finally {await member.close()}
 for(const [phase,status] of [['revoked',403],['expired',403],['expired-page',403],['rate',503],['redirect',502],['scope',403],['foreign-project',502],['foreign-key',502],['foreign-self',502],['sensitive',502],['people',502],['custom',502],['echo',502],['duplicate',502],['missing-field',502],['warnings',502],['truncated',502],['cursor',502],['last-cursor',502],['overflow',413]]){
  state.jira=phase;const calls=state.calls.length
  await call('work/jira/preview',{...selection,catchup:true},status)
  assert.deepEqual(await read(),first,'refused Jira read preserves last good snapshot: '+phase)
  if(['revoked','expired','rate','redirect'].includes(phase))assert.equal(state.calls.length,calls+1,'no retry or redirect following: '+phase)
 }
 console.log('PROBE BIF-042 refusals: public Jira preview with foreign site and project, incomplete and warning pages, duplicate and cyclic cursors, overflow, expired and revoked bearers, 429 and redirect -> refused with unchanged last-good data; members and machine-plus-owner cookies make no provider read')
 state.jira='changed'
 const next=await call('work/jira/preview',{...selection,catchup:true})
 assert.equal((await post('apply',{planId:next.planId,reviewedFingerprint:firstFingerprint},403)).error,'review_fingerprint_mismatch')
 assert.deepEqual(await read(),first,'stale reviewed fingerprint cannot apply changed work outcomes')
 const applied=await Promise.all([1,2].map(()=>context.request.post(origin+'/api/operator/import/apply',{headers,data:{planId:next.planId,reviewedFingerprint:next.fingerprint}})))
 assert.ok(applied.some(response=>response.ok()));const reconciliation=await post('reconcile',{planId:next.planId});assert.equal(reconciliation.ok,true)
 assert.equal((await read()).table.rows[0][7],'Open');assert.equal((await post('history',undefined)).history.filter(item=>item.planId===next.planId).length,1,'concurrent Apply produces one retained import')
 await page.goto(origin+'/app/import');await page.getByLabel('Dataset id',{exact:true}).fill(dataset);await page.getByRole('button',{name:'Load dataset',exact:true}).click();await page.locator('#history-list button').first().waitFor()
 await page.locator('#history-list .history-item').filter({hasText:next.planId}).getByRole('button',{name:'Undo import',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import undone.'))
 assert.deepEqual((await read()).table.rows,expected,'actual browser Undo restores the exact prior snapshot');await screen('undone')
 state.jira='empty';const empty=await call('work/jira/preview',{...selection,catchup:true});assert.equal(empty.preview.rowCount,0);await post('apply',{planId:empty.planId,reviewedFingerprint:empty.fingerprint});assert.equal((await post('reconcile',{planId:empty.planId})).ok,true);assert.deepEqual((await read()).table.rows,[]);await post('undo',{planId:empty.planId});assert.deepEqual((await read()).table.rows,expected)
 state.jira='marker';const marker=await call('work/jira/preview',{...selection,catchup:true});assert.equal(marker.preview.sample[0][7],'__BIFOCAL_NULL__','a literal status never becomes a null timestamp');assert.equal(marker.preview.sample[1][10],null);await post('undo',{planId:marker.planId})
 // Null timestamps include created and updated as well as resolution date.
 state.jira='nulls';const nulls=await call('work/jira/preview',{...selection,catchup:true});assert.deepEqual(nulls.preview.sample[0].slice(8,11),[null,null,null]);await post('undo',{planId:nulls.planId})
 state.jira='success'
 let retentionRevision=null
 const source=await read()
 for(const protection of [{legalHold:true,minimumRetainUntil:null},{legalHold:false,minimumRetainUntil:'2099-01-01T00:00:00.000Z'}]){
  const response=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers,data:{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision:retentionRevision,...protection,releaseHold:true}});assert.equal(response.status(),200,await response.text());retentionRevision=(await response.json()).revision
  await call('datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},423);assert.deepEqual((await read()).table.rows,expected)
 }
 assert.equal((await context.request.put(origin+'/api/operator/retention/'+dataset,{headers,data:{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision:retentionRevision,legalHold:false,minimumRetainUntil:null,releaseHold:true}})).status(),200)
 const erased=await call('datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision});assert.equal(erased.phase,'complete');assert.ok(erased.stores.some(store=>store.store==='bf_query_snapshots'&&store.rows===1))
 await call('datasets/'+dataset,undefined,404);await call('queries/'+answer.snapshotId,undefined,404)
 for(const planId of [firstId,next.planId,empty.planId])assert.ok((await post('original/'+planId,undefined)).originals.every(item=>item.original.status==='unavailable'))
 await post('original/'+nulls.planId,undefined,404)
 await post('apply',{planId:next.planId,reviewedFingerprint:next.fingerprint},410)
 assert.equal((await call('work/jira/preview',{...selection,catchup:true},409)).error,'source_erased')
 await call('datasets/'+dataset,undefined,404)
 // Revoke an already-started native read after its first provider page. A
 // freshly confirmed owner session is required to continue; no second page or
 // plan may be staged under the revoked session.
 const session=await(await context.request.get(origin+'/auth/session')).json(),count=state.calls.length
 state.onJiraPage=async()=>{assert.equal((await context.request.post(origin+'/auth/session/revoke',{headers:{Origin:origin},data:{sessionId:session.id}})).status(),204)}
 await call('work/jira/preview',{...selection,datasetId:'synthetic-bifocal-jira-revoked'},409)
 assert.equal(state.calls.length,count+2,'discovery and first page only; native revocation stops further reads')
 assert.equal((await context.request.get(origin+'/api/operator/datasets/'+dataset)).status(),401)
 const magic=await createAuthHandler(auth)(new Request(origin+'/auth/magic-link',{method:'POST',headers:{Origin:origin,Host:new URL(origin).host,'Content-Type':'application/json'},body:JSON.stringify({email:owner.email})}));assert.equal(magic.status,202,await magic.text())
 const freshToken=new URL(mail.at(-1).text.match(/https?:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
 assert.equal((await context.request.post(origin+'/auth/confirm',{headers:{Origin:origin},data:{token:freshToken},maxRedirects:0})).status(),303)
 await call('datasets/synthetic-bifocal-jira-revoked',undefined,404)
 console.log('PROBE BIF-042 current authority: native session revoked during first issue page -> no second page or staged data; fresh owner confirmation required')
 const db=await edge.database(),tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results
 for(const {name} of tables){const data=JSON.stringify((await db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()).results);for(const value of [grant,'synthetic-bifocal-private-description','synthetic-bifocal-private-person','synthetic-bifocal-private-custom','synthetic-bifocal-private-warning'])assert.equal(data.includes(value),false,'sensitive provider data excluded from every retained store: '+name)}
 await page.goto(origin+'/app/import');await page.getByLabel('Dataset id',{exact:true}).fill(dataset);await page.getByRole('button',{name:'Load dataset',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Dataset state and history loaded for review.');await screen('erased')
 console.log('PROBE BIF-042 custody: changed work read with stale approval -> 403; exact Apply and browser Undo restore prior rows; complete empty snapshot remains empty; legal hold and minimum retention refuse erasure; eligible erasure withdraws originals and answers, replay stays retired, and stored data excludes tokens and sensitive fields')
}

// The same public-door journey can run alone while iterating. CI invokes it
// from runtime.mjs; this entry never substitutes for the push Verify wall.
if(process.argv[1]===new URL(import.meta.url).pathname){
 const {chromium}=await import('@playwright/test'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const persist=await mkdtemp(join(tmpdir(),'bifocal-analytics-')),browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try{const context=await browser.newContext(),page=await context.newPage();await proveAnalyticsBoundaries(null,context,page,persist)}finally{await browser.close();await rm(persist,{recursive:true,force:true})}
}
