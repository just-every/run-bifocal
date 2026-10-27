import assert from 'node:assert/strict'
import { proveCostControls } from './cost-controls.mjs'
import { proveCompanyBrowser } from './company-browser.mjs'
import { proveInputTemplates } from './input-templates.mjs'
import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

/** Regional analytical inputs through the actual reviewed import and input doors. */
export async function proveInputTables(origin,context,page,custody) {
 const dataset='synthetic-bifocal-inputs',root=origin+'/api/operator',headers={Origin:origin}
 const call=async(path,data,expected=200)=>{const r=await context.request.fetch(root+path,{method:data===undefined?'GET':'POST',headers,data});assert.equal(r.status(),expected,await r.text());return r.json()}
 const importSource=async(amount='100.00')=>{
  const envelope={version:1,datasetId:dataset,filename:'synthetic-bifocal-1.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:'id',formulaTreatment:'literal-text',data:`id,region,amount\n1,West,$${amount}\n2,East,$250.00\n`}
  const bytes=Buffer.from(JSON.stringify(envelope)),digest=createHash('sha256').update(bytes).digest('hex'),importHeaders={...headers,'X-Import-Dataset':dataset}
  const post=async(action,data)=>{const r=await context.request.post(root+'/import/'+action,{headers:importHeaders,data});assert.equal(r.status(),200,await r.text());return r.json()}
  const upload=await post('uploads',{name:'synthetic-bifocal-1.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')})
  const plan=await post('plan',{uploadId:upload.uploadId,...(amount!=='100.00'?{catchup:true}:{})})
  for(let n=0;n<20;n++){const applied=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(applied.job.state==='completed')return call('/datasets/'+dataset)}
  assert.fail('Input source import did not complete')
 }
 const source=await importSource(),owner=(await (await context.request.get(origin+'/auth/session')).json()).operator
 const definition={dataset,sourceRevision:source.revision,keyColumn:'id',regionColumn:'region',region:'West',observedColumn:'amount'}
 const base={rowKey:'1',previousVersion:0,adjustment:'25.50',note:'Reviewed regional forecast',effectiveOn:'2026-10-01',active:true}
 assert.equal((await fetch(root+'/inputs')).status,401)
 assert.equal((await context.request.post(root+'/inputs',{headers:{Origin:'https://foreign.example.test'},data:{id:'synthetic-bifocal-denied',name:'Denied',...definition}})).status(),401)
 if(process.env.BIFOCAL_PROOF_DIR)await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true})
 let tooltipChecked=false
 const shot=async(name,width)=>{
  for(const screenWidth of [1440,390]){
   await page.setViewportSize({width:screenWidth,height:1000})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Input ${name} overflows ${screenWidth}`)
   assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0)
   if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/inputs-${name}-${screenWidth}.png`,fullPage:true})
   if(screenWidth===390&&!tooltipChecked){
    const gear=page.locator('body[data-input-tables] .menu > summary')
    const tooltip=()=>gear.evaluate(element=>{const style=getComputedStyle(element,'::before');return {content:style.content,visibility:style.visibility,opacity:style.opacity}})
    await page.mouse.move(0,0);await gear.evaluate(element=>element.blur())
    let style=await tooltip();assert.equal(style.visibility,'hidden')
    assert.ok(!['none','normal','""',"''"].includes(style.content)&&style.content.length<80,'Settings tooltip provides a short accessible hint')
    await gear.hover();await page.waitForTimeout(350)
    style=await tooltip();assert.equal(style.visibility,'visible');assert.equal(style.opacity,'1')
    await page.mouse.move(0,0);await page.waitForTimeout(350);assert.equal((await tooltip()).visibility,'hidden')
    await page.keyboard.press('Tab');await gear.focus()
    assert.equal(await gear.evaluate(element=>element.matches(':focus-visible')),true)
    style=await tooltip();assert.equal(style.visibility,'visible');assert.equal(style.opacity,'1')
    if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/inputs-settings-tooltip-390.png`,fullPage:true})
    await gear.evaluate(element=>element.blur());await page.waitForTimeout(350)
    tooltipChecked=true
   }
  }
  await page.setViewportSize({width,height:1000})
 }
 for(const width of [1440]){
  const id='synthetic-bifocal-input-'+width,path='/inputs/'+id
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/inputs')
  await shot('create',width)
  for(const [label,value] of Object.entries({'Input table ID':id,'Table name':'West forecast '+width,'Dataset ID':dataset,'Reviewed source revision':source.revision,'Source key column':'id','Region column':'region','Allowed region':'West','Observed USD column':'amount'}))await page.getByLabel(label,{exact:true}).fill(value)
  await page.getByRole('button',{name:'Review input table',exact:true}).click()
  assert.deepEqual((await call('/inputs')).tables,[],'Reviewing a definition never creates a table')
  await shot('review',width)
  await page.getByRole('button',{name:'Create input table',exact:true}).click();await page.waitForURL(origin+'/app'+path)
  const initial=await call(path)
  base.schemaRevision=initial.schemaRevision
  assert.deepEqual(initial.rows,[{rowKey:'1',observed:'100.00',version:0,values:null,adjusted:'100.00'}])
  assert.deepEqual(initial.columns.map(c=>[c.name,c.type]),[['adjustment','money'],['note','text'],['effectiveOn','date'],['active','boolean']])
  await shot('empty',width)
  await page.getByLabel('Adjustment (USD)',{exact:true}).fill('25.50');await page.getByLabel('Reason',{exact:true}).fill(base.note);await page.getByLabel('Effective date',{exact:true}).fill(base.effectiveOn)
  await page.getByRole('button',{name:'Save adjustment',exact:true}).click();await page.waitForURL(origin+'/app'+path)
  let state=await call(path)
  assert.equal(state.rows.length,1);assert.equal(state.rows[0].observed,'100.00');assert.equal(state.rows[0].adjusted,'125.50');assert.equal(state.rows[0].version,1)
  assert.deepEqual(state.history.map(h=>({row:h.rowKey,version:h.version,actor:h.actorId,before:h.before,after:h.after})),[{row:'1',version:1,actor:owner.id,before:null,after:{adjustment:'25.50',note:base.note,effectiveOn:base.effectiveOn,active:true}}])
  assert.equal(state.history[0].actorName,owner.displayName)
  assert.equal(state.history[0].schemaVersion,state.schemaVersion)
  assert.match(state.history[0].recordedAt,/^\d{4}-\d{2}-\d{2}T/)
  await page.locator('summary').filter({hasText:'Before and after history'}).click();await shot('saved-audit',width)
  await call(path+'/rows',{...base,rowKey:'2',previousVersion:0},403)
  for(const invalid of [{adjustment:'1.001'},{adjustment:25.5},{effectiveOn:'2026-02-30'},{active:'yes'},{active:'true'},{note:''},{extra:true}])await call(path+'/rows',{...base,previousVersion:1,...invalid},400)
  await call(path+'/rows',base,409)
  assert.deepEqual(await call(path),state,'Refused edits leave row and audit unchanged')
  const requests=await Promise.all(['10.00','20.00'].map(adjustment=>context.request.post(root+path+'/rows',{headers,data:{...base,previousVersion:1,adjustment}})))
  assert.deepEqual(requests.map(r=>r.status()).sort(),[200,409])
  const winner=await requests.find(r=>r.status()===200).json();state=await call(path)
  assert.equal(state.rows[0].version,2);assert.equal(state.historyCount,2)
  assert.equal(state.history[0].before.adjustment,'25.50');assert.equal(state.history[0].after.adjustment,winner.values.adjustment)
  await call(path+'/rows',{...base,previousVersion:2,adjustment:'-10.25',active:false})
  state=await call(path);assert.equal(state.rows[0].adjusted,'100.00');assert.equal(state.rows[0].values.adjustment,'-10.25');assert.equal(state.historyCount,3)
  assert.deepEqual(await call('/datasets/'+dataset),source,'Analytical adjustments never overwrite observed actuals')
  await page.reload();await shot('inactive',width)
  const conflict=await page.request.post(root+path+'/rows',{headers,form:{...base,previousVersion:'1',active:'true'}})
  assert.equal(conflict.status(),409)
  await page.goto(origin+'/app'+path);await page.getByLabel('Adjustment (USD)',{exact:true}).fill('1.001');await page.getByRole('button',{name:'Save adjustment',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'USD_two_decimal_places_required'}).waitFor();await shot('validation-refusal',width)
 }
 const extra=await proveInputTemplates({origin,context,page,call,definition,source,owner,shot})
 // Native memberships and sessions are obtained through the real local doors.
 const {reader,persist,environment}=custody
 const id='synthetic-bifocal-input-1440',path='/inputs/'+id,beforeAuthority=await call(path)
 const deniedDefinition={id:'synthetic-bifocal-denied',name:'Denied',...definition}
 const schemaMutation={previousSchemaRevision:beforeAuthority.schemaRevision,schema:beforeAuthority.schema}
 const deniedMutations=[['/inputs',deniedDefinition],['/inputs/review',deniedDefinition],[path+'/rows',{...base,previousVersion:3}],[path+'/schema/review',schemaMutation],[path+'/schema',{...schemaMutation,reviewedDigest:'unreviewed'}]]
 const refuse=async(client)=>{
  for(const route of ['/inputs',path])assert.equal((await client.request.get(root+route)).status(),401)
  for(const [route,data] of deniedMutations)assert.equal((await client.request.post(root+route,{headers,data})).status(),401)
  assert.equal((await client.request.get(origin+'/app'+path)).status(),401)
 }
 const readerSession=(await(await reader.request.get(origin+'/auth/session')).json())
 assert.equal(readerSession.operator.role,'member')
 await refuse(reader)
 // A working analytical read grant and a working machine bearer still provide no input authority.
 const calendar='synthetic-bifocal-input-calendar'
 await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Input read boundary',kind:'fiscal',startMonth:1}},201)
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'amount',op:'sum',column:'amount',unit:'money',sourceCurrency:'USD',scale:2}],semantic:{grain:['id'],dimensions:[{column:'id',type:'number'},{column:'region',type:'text'}],hierarchies:[],slowlyChanging:'reject-duplicate-grain'},context:{modelVersion:'synthetic-bifocal-input-model',metricVersion:'draft',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const model=await call('/models',{definition:{views:[{id:'forecast',kind:'chart',query,rowRules:[]}],quality:[]}},201)
 const branch='/models/'+model.modelId+'/branches/'+model.branchId,review=await call(branch+'/validate',{})
 await call(branch+'/approve',{digest:review.digest})
 for(const environment of ['staging','production'])await call(branch+'/promote',{environment,digest:review.digest})
 const filters=[{column:'region',op:'eq',value:'West'}],parameters={modelId:model.modelId,revision:model.revision,viewId:'forecast',groupBy:['region'],filters:[]}
 const grantInput={operatorId:readerSession.operator.id,operatorVersion:readerSession.operator.version,modelId:model.modelId,revision:model.revision,viewId:'forecast',filters,dimensions:['region'],underlying:false,summaryExport:false,underlyingExport:false,expiresAt:new Date(Date.now()+300000).toISOString()}
 const grantReview=await call('/explore/access/review',grantInput),grant=await call('/explore/access',{...grantInput,reviewedDigest:grantReview.digest},201)
 const read=await reader.request.post(root+'/explore/run',{headers,data:{...parameters,grantId:grant.id}})
 assert.equal(read.status(),201,await read.text());assert.equal((await read.json()).answer.totals.amount.value,'100.00')
 await refuse(reader)
 const scope={purpose:'Input authority boundary',modelId:model.modelId,revision:model.revision,viewId:'forecast',filters,dimensions:['region'],measures:['amount'],tools:['query'],expiresAt:new Date(Date.now()+300000).toISOString(),maxOperations:10}
 const credentialReview=await call('/credentials/review',scope),credential=await call('/credentials',{...scope,reviewedDigest:credentialReview.digest},201)
 const machineHeaders={...headers,Authorization:'Bearer '+credential.token}
 const machine=await fetch(origin+'/api/v1/query',{method:'POST',headers:{...machineHeaders,'content-type':'application'+'/json'},body:JSON.stringify(parameters)})
 assert.equal(machine.status,200);assert.equal((await machine.json()).totals.amount.value,'100.00')
 for(const route of ['/inputs',path]){
  assert.equal((await fetch(root+route,{headers:machineHeaders})).status,401)
  assert.equal((await context.request.get(root+route,{headers:machineHeaders})).status(),401)
 }
 for(const [route,data] of deniedMutations){
  const copied={...data,operatorId:owner.id}
  assert.equal((await context.request.post(root+route,{headers:machineHeaders,data:copied})).status(),401)
  assert.equal((await reader.request.post(root+route,{headers,data:copied})).status(),401)
 }
 await call('/credentials/'+credential.id+'/revoke',{})
 await call('/explore/access/'+grant.id+'/revoke',{})
 const browser=page.context().browser(),admin=await browser.newContext()
 try{
  assert.equal((await admin.request.post(origin+'/__dev/key',{headers,data:{key:environment.RER_DEV_KEY}})).status(),204)
  assert.equal((await context.request.post(origin+'/auth/invite',{headers,data:{email:'synthetic-bifocal-input-admin@example.test',displayName:'Synthetic input admin',role:'admin'}})).status(),202)
  const people=await(await context.request.get(origin+'/auth/operators')).json(),person=people.find(p=>p.email==='synthetic-bifocal-input-admin@example.test')
  await admin.request.get(new URL(person.signInUrl,origin).href)
  assert.equal((await(await admin.request.get(origin+'/auth/session')).json()).operator.role,'admin')
  await refuse(admin)
 }finally{await admin.close()}
 for(const route of ['/inputs',path])assert.equal((await context.request.get(root+route,{headers:{Authorization:'Bearer synthetic-bifocal-credential'}})).status(),401)
 assert.equal((await context.request.post(root+path+'/rows',{headers:{...headers,Authorization:'Bearer synthetic-bifocal-credential'},data:{...base,previousVersion:3}})).status(),401)
 assert.deepEqual(await call(path),beforeAuthority,'Non-owner and machine requests never alter inputs or history')
 const cliHeaders={...headers,'x-rer-local-cli':createHmac('sha256','synthetic-bifocal-2'.repeat(3)).update('local-cli'+String.fromCharCode(0)+'sign-in').digest('hex')}
 const nativeSignIn=async()=>assert.equal((await context.request.post(origin+'/auth/local/cli-session',{headers:cliHeaders,data:{returnTo:'/app'},maxRedirects:0})).status(),303)
 await nativeSignIn()
 assert.equal((await context.request.post(origin+'/auth/invite',{headers,data:{email:'synthetic-bifocal-input-owner@example.test',displayName:'Synthetic second input owner',role:'owner'}})).status(),202)
 const second=await browser.newContext()
 try{
  assert.equal((await second.request.post(origin+'/__dev/key',{headers,data:{key:environment.RER_DEV_KEY}})).status(),204)
  const people=await(await context.request.get(origin+'/auth/operators')).json(),person=people.find(p=>p.email==='synthetic-bifocal-input-owner@example.test')
  await second.request.get(new URL(person.signInUrl,origin).href)
  const stale=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ')
  assert.equal((await context.request.post(origin+'/auth/operator/status',{headers,data:{operatorId:owner.id,status:'inactive'}})).status(),200)
  await refuse(context)
  await nativeSignIn()
  assert.equal((await context.request.post(origin+'/auth/operator/status',{headers,data:{operatorId:owner.id,status:'active'}})).status(),200)
  for(const route of ['/inputs',path])assert.equal((await fetch(root+route,{headers:{cookie:stale}})).status,401,'Reactivation never revives prior input authority')
  assert.equal((await context.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(owner.email),{maxRedirects:0})).status(),303)
  assert.deepEqual(await call(path),beforeAuthority,'Authority loss and reactivation leave values and attributed history intact')
 }finally{await second.close()}
 const retention=root+'/retention/'+dataset
 let previousRevision=null
 for(const protection of [{legalHold:true,minimumRetainUntil:null},{legalHold:false,minimumRetainUntil:'2099-01-01T00:00:00.000Z'}]){
  const protectedResponse=await context.request.put(retention,{headers,data:{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,...protection,releaseHold:true}})
  assert.equal(protectedResponse.status(),200,await protectedResponse.text());previousRevision=(await protectedResponse.json()).revision
  await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},423)
  assert.deepEqual(await call(path),beforeAuthority,'Held erasure preserves input notes and value-bearing history')
  for(const [extraPath,state] of extra.states)assert.deepEqual(await call(extraPath),state,'Held erasure preserves all typed values and schema revisions')
 }
 const release=await context.request.put(retention,{headers,data:{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,legalHold:false,minimumRetainUntil:null,releaseHold:true}})
 assert.equal(release.status(),200,await release.text())
 const changed=await importSource('101.00')
 for(const width of [1440]){
  const path='/inputs/synthetic-bifocal-input-'+width
  await call(path,undefined,409);await call(path+'/rows',{...base,previousVersion:3},409)
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app'+path);await page.getByRole('alert').filter({hasText:'source_changed_or_removed'}).waitFor();await shot('source-refusal',width)
 }
 for(const [extraPath,state] of extra.states){await call(extraPath,undefined,409);await call(extraPath+'/rows',{rowKey:'1',previousVersion:state.rows[0].version,schemaRevision:state.schemaRevision,...state.rows[0].values},409)}
 const erased=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:changed.revision})
 for(const [store,rows] of [['bf_input_tables',5],['bf_input_rows',5],['bf_input_history',12],['bf_input_schemas',6]])assert.equal(erased.stores.find(s=>s.store===store).rows,rows)
 assert.deepEqual((await call('/inputs')).tables,[])
 await call(path,undefined,404);await call(path+'/rows',{...base,previousVersion:3},404)
 for(const [extraPath,state] of extra.states){await call(extraPath,undefined,404);await call(extraPath+'/rows',{rowKey:'1',previousVersion:state.rows[0].version,schemaRevision:state.schemaRevision,...state.rows[0].values},404)}
 // Inspect the independent persisted store, including orphan rows the API could hide.
 const inspect=command=>JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','foundation','--local','--persist-to',persist,'--config','wrangler.jsonc','--command',command,'--json'],{encoding:'utf8',env:environment,stdio:['ignore','pipe','pipe']}))[0].results
 for(const store of ['bf_input_tables','bf_input_rows','bf_input_history','bf_input_schemas'])assert.deepEqual(inspect('SELECT count(*) AS n FROM '+store),[{n:0}],store+' retains no orphaned values, notes or history')
 const receipt=await call('/erasure-receipts/'+erased.auditId)
 for(const value of [dataset,base.note,owner.email,owner.displayName,'25.50','-10.25'])assert.equal(JSON.stringify(receipt).includes(value),false,'Minimal receipt must not retain erased values')
 for(const value of extra.erasedValues)assert.equal(JSON.stringify(receipt).includes(JSON.stringify(value)),false,'Minimal receipt must not retain added typed values or notes')
 console.log('Input tables: typed separate USD adjustments, conflicts and attributed history; native member and admin, working analytical grant and machine credential refusal; owner suspension and stale-session refusal; held erasure, independent persisted note and history withdrawal and minimal receipt passed. Assertions at 1440; screens at 1440 and 390.')
}
export async function proveConventions(origin, context, page) {
 await proveCostControls(origin,context,page)
 const call = async (path, data, method = data === undefined ? 'GET' : 'POST', expected = method === 'POST' && ['/calendars','/rates','/schedules'].includes(path) ? 201 : 200) => {
  const response = await context.request.fetch(origin + '/api/operator' + path, { method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }) })
  assert.equal(response.status(), expected, await response.text()); return response.json()
 }
 assert.equal((await fetch(origin + '/api/operator/company')).status, 401)
 const initial = await call('/company')
 assert.equal(initial.updatedAt, null, 'built-in defaults have no owner-authored update time')
 assert.equal(initial.settings.currency, 'USD'); assert.equal(initial.settings.dateFormat, 'MM/DD/YYYY'); assert.equal(initial.settings.timezone, 'America/New_York')
 const settings = { name: 'Synthetic Bifocal Supply', reportCutoff: '02:00' }
 const saved = await call('/company', { previousRevision: initial.revision, settings }, 'PUT')
 await call('/company', { previousRevision: initial.revision, settings: { name: 'Stale' } }, 'PUT', 409)
 assert.equal((await call('/company')).settings.name, settings.name)
 await call('/viewer-timezone', { previousRevision: null, timezone: 'America/Los_Angeles' }, 'PUT')
 assert.equal((await call('/viewer-timezone')).timezone, 'America/Los_Angeles')
 assert.equal((await call('/company')).settings.timezone, 'America/New_York')
 const july = { name: 'July fiscal', kind: 'fiscal', startMonth: 7 }
 await call('/calendars', { id: 'synthetic-bifocal-july', previousVersion: null, definition: july })
 const leap = await call('/calendars/synthetic-bifocal-july/1/year/2023')
 assert.deepEqual([leap.start, leap.end, leap.days], ['2023-07-01','2024-07-01',366])
 const classification = await call('/calendars/synthetic-bifocal-july/1/date/2024-02-29')
 assert.deepEqual([classification.fiscalYear,classification.period,classification.quarter], [2023,8,3])
 const retail = { name: 'Retail', kind: '445', startMonth: 2, startDay: 1, weekStartsOn: 0, anchor: 'nearest', extraWeekPeriod: 12 }
 await call('/calendars', { id: 'synthetic-bifocal-retail', previousVersion: null, definition: retail })
 const year = await call('/calendars/synthetic-bifocal-retail/1/year/2023')
 assert.deepEqual([year.start,year.end,year.weeks,year.periods[11].days], ['2023-01-29','2024-02-04',53,42])
 await call('/calendars', { id: 'synthetic-bifocal-retail', previousVersion: 1, definition: { ...retail, kind: '454' } })
 const newer = await call('/calendars/synthetic-bifocal-retail/2/year/2023')
 assert.deepEqual(newer.periods.slice(0,3).map(period => period.days), [28,35,28])
 assert.deepEqual((await call('/calendars/synthetic-bifocal-retail/1/year/2023')).periods, year.periods)
 for (const [start,end,expected] of [['2024-02-28','2024-03-02',3],['2026-07-02','2026-07-07',2],['2021-12-30','2022-01-04',2]]) {
  assert.equal((await call('/calendars/synthetic-bifocal-july/1/working-days', { start,end })).workingDays, expected)
 }
 const schedule = { name: 'DST check', localDate: '2026-03-08', time: '02:30', timezone: 'America/New_York', reportCutoff: '02:00', skipped: 'reject', repeated: 'earlier' }
 await call('/time/resolve', schedule, 'POST', 422)
 assert.equal((await call('/time/resolve', { ...schedule, skipped: 'skip' })).resolution.status, 'skipped')
 const shifted = await call('/time/resolve', { ...schedule, skipped: 'shift-forward' })
 assert.equal(shifted.resolution.instants[0].instant, '2026-03-08T07:30:00.000Z')
 const both = await call('/schedules', { id: 'synthetic-bifocal-dst', previousVersion: null, definition: { ...schedule, localDate: '2026-11-01', time: '01:30', repeated: 'both' } })
 const stored = await call('/schedules/synthetic-bifocal-dst/1')
 assert.deepEqual(stored.definition.resolution.instants.map(item => [item.instant,item.offset]), [['2026-11-01T05:30:00.000Z','-04:00'],['2026-11-01T06:30:00.000Z','-05:00']])
 const cutoff = await call('/time/context', { sourceInstant: '2026-07-01T01:30:00-04:00', timezone: 'America/New_York', reportCutoff: '02:00' })
 assert.equal(cutoff.sourceOffset, '-04:00'); assert.equal(cutoff.reportDate, '2026-06-30')
 const rates = { name: 'Owner treasury rates', kind: 'owner-imported', license: 'Owner supplied for authorized internal use', baseCurrency: 'USD', rates: [{ currency: 'EUR',date: '2026-06-19',rate: '0.8' }] }
 await call('/rates', { id: 'synthetic-bifocal-rates', previousVersion: null, definition: rates })
 const conversion = { sourceId: 'synthetic-bifocal-rates', sourceVersion: 1, targetCurrency: 'USD', timezone: 'America/New_York', reportCutoff: '02:00', policy: { date: 'transaction-date',lookup: 'exact' }, rounding: { scale: 2, mode: 'half-even',stage: 'per-line' }, transactions: [{ id:'synthetic-bifocal-1',amount:'100.00',currency:'EUR',date:'2026-06-19' }, { id:'synthetic-bifocal-2',amount:'100.00',currency:'USD',date:'2026-06-19' }] }
 assert.equal((await call('/currency/convert', conversion)).total.amount, '225.00')
 await call('/rates', { id: 'synthetic-bifocal-rates', previousVersion: 1, definition: { ...rates, rates: [{ ...rates.rates[0],rate: '0.9' }] } })
 assert.equal((await call('/currency/convert', conversion)).total.amount, '225.00')
 for (const [amount,mode,expected] of [['9007199254740993.01','half-even','9007199254740993.01'],['1.005','half-even','1.00'],['1.015','half-even','1.02'],['-1.005','half-away-from-zero','-1.01']]) {
  const value = await call('/currency/convert', { ...conversion, rounding: { ...conversion.rounding,mode }, transactions: [{ ...conversion.transactions[1],amount }] })
  assert.equal(value.total.amount, expected)
 }
 const lines = conversion.transactions.map((row,index) => ({ ...row,currency: 'USD',amount: '0.005' }))
 assert.equal((await call('/currency/convert', { ...conversion,transactions: lines })).total.amount, '0.00')
 assert.equal((await call('/currency/convert', { ...conversion,transactions: lines,rounding: { ...conversion.rounding,stage: 'total' } })).total.amount, '0.01')
 assert.ok((await call('/conventions/audit')).entries.some(entry => entry.kind === 'company' && entry.revision === saved.revision))
 await proveCompanyBrowser(origin,page)
 console.log('Native conventions: durable US defaults, fiscal leap/53-week calendars, holidays, DST resolution and exact versioned currency rounding passed')
}
