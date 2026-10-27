import assert from 'node:assert/strict'
import { proveCostControls } from './cost-controls.mjs'
import { proveCompanyBrowser } from './company-browser.mjs'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

/** Regional analytical inputs through the actual reviewed import and input doors. */
export async function proveInputTables(origin,context,page) {
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
 const shot=async(name,width)=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Input ${name} overflows ${width}`);assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0);if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/inputs-${name}-${width}.png`,fullPage:true})}
 for(const width of [1440,390]){
  const id='synthetic-bifocal-input-'+width,path='/inputs/'+id
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/inputs')
  await shot('create',width)
  for(const [label,value] of Object.entries({'Input table ID':id,'Table name':'West forecast '+width,'Dataset ID':dataset,'Reviewed source revision':source.revision,'Source key column':'id','Region column':'region','Allowed region':'West','Observed USD column':'amount'}))await page.getByLabel(label,{exact:true}).fill(value)
  await page.getByRole('button',{name:'Create input table',exact:true}).click();await page.waitForURL(origin+'/app'+path)
  const initial=await call(path)
  assert.deepEqual(initial.rows,[{rowKey:'1',observed:'100.00',version:0,values:null,adjusted:'100.00'}])
  assert.deepEqual(initial.columns.map(c=>[c.name,c.type]),[['adjustment','money'],['note','text'],['effectiveOn','date'],['active','boolean']])
  await shot('empty',width)
  await page.getByLabel('Adjustment (USD)',{exact:true}).fill('25.50');await page.getByLabel('Reason',{exact:true}).fill(base.note);await page.getByLabel('Effective date',{exact:true}).fill(base.effectiveOn)
  await page.getByRole('button',{name:'Save adjustment',exact:true}).click();await page.waitForURL(origin+'/app'+path)
  let state=await call(path)
  assert.equal(state.rows.length,1);assert.equal(state.rows[0].observed,'100.00');assert.equal(state.rows[0].adjusted,'125.50');assert.equal(state.rows[0].version,1)
  assert.deepEqual(state.history.map(h=>({row:h.rowKey,version:h.version,actor:h.actorId,before:h.before,after:h.after})),[{row:'1',version:1,actor:owner.id,before:null,after:{adjustment:'25.50',note:base.note,effectiveOn:base.effectiveOn,active:true}}])
  assert.equal(state.history[0].actorName,owner.displayName)
  assert.match(state.history[0].recordedAt,/^\d{4}-\d{2}-\d{2}T/)
  await page.locator('summary').filter({hasText:'Before and after history'}).click();await shot('saved-audit',width)
  await call(path+'/rows',{...base,rowKey:'2',previousVersion:0},403)
  for(const invalid of [{adjustment:'1.001'},{adjustment:25.5},{effectiveOn:'2026-02-30'},{active:'yes'},{note:''},{extra:true}])await call(path+'/rows',{...base,previousVersion:1,...invalid},400)
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
 const changed=await importSource('101.00')
 for(const width of [1440,390]){
  const path='/inputs/synthetic-bifocal-input-'+width
  await call(path,undefined,409);await call(path+'/rows',{...base,previousVersion:3},409)
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app'+path);await page.getByRole('alert').filter({hasText:'source_changed_or_removed'}).waitFor();await shot('source-refusal',width)
 }
 const erased=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:changed.revision})
 for(const [store,rows] of [['bf_input_tables',2],['bf_input_rows',2],['bf_input_history',6]])assert.equal(erased.stores.find(s=>s.store===store).rows,rows)
 assert.deepEqual((await call('/inputs')).tables,[])
 console.log('Input tables: native typed USD inputs, exact separate actuals, regional row refusal, validation, competing edits, actor and before and after audit, inactive effect, source drift and erasure passed at 1440 and 390')
}
export async function proveConventions(origin, context, page) {
 await proveInputTables(origin,context,page)
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
