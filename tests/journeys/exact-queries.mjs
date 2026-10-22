import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { proveExactBrowser } from './exact-browser.mjs'

export async function proveExactQueries(origin, context, files, page) {
 const headers = { Origin: origin }
 const call = async (path, data, expected = data === undefined ? 200 : 201) => {
  const response = await context.request.fetch(origin + '/api/operator' + path, { method: data === undefined ? 'GET' : 'POST', headers, ...(data === undefined ? {} : { data }) })
  assert.equal(response.status(), expected, await response.text()); return response.json()
 }
 const dataset = 'synthetic-bifocal-query', dimension = 'synthetic-bifocal-customers'
 const data = 'id,date,region,customer,revenue,profit,score,weight\n1,01/15/2026,West,c1,$100.10,$30.03,10,1\n2,01/16/2026,West,c1,-$20.02,-$6.01,20,3\n3,01/17/2026,West,c3,,,,2\n4,01/18/2026,West,c4,-$0.01,-$0.01,0,1\n5,01/16/2026,East,c2,$0.00,$0.00,99,1\n6,01/16/2026,East,c1,$0.00,$0.00,1,1\n7,12/31/2025,West,c9,$9000.00,$1000.00,99,1\n8,02/01/2026,West,c9,$8888.00,$500.00,99,1\n'
 const file = { version:1,datasetId:dataset,filename:'synthetic-bifocal-20.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:'id',formulaTreatment:'literal-text',data }
 const preview = await files.plan(file, false, dataset); await files.apply(preview, dataset)
 const customers = { ...file,datasetId:dimension,key:null,data:'customer,tier\nc1,Gold\nc1,Gold\nc2,Silver\nc3,Silver\nc4,Gold\n' }
 const dimensionPlan = await files.plan(customers, false, dimension); await files.apply(dimensionPlan, dimension)
 const query = { version:1,dataset,joins:[],filters:[{column:'region',op:'eq',value:'West'},{column:'date',op:'gte',value:'2026-01-01'},{column:'date',op:'lte',value:'2026-01-31'}],groupBy:['customer'],measures:[
  {id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'},
  {id:'customers',op:'count-distinct',column:'customer',unit:'count',scale:0},
  {id:'margin',op:'ratio',numerator:'profit',denominator:'revenue',unit:'percent',scale:4,sourceCurrency:'USD'},
  {id:'weighted',op:'weighted-average',column:'score',weight:'weight',unit:'number',scale:4},
 ],context:{modelVersion:'synthetic-bifocal-v1',metricVersion:'synthetic-bifocal-v1',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-july',version:1},rounding:'half-even'} }
 assert.equal((await context.request.get(origin + '/api/operator/queries',{headers:{Cookie:''}})).status(), 401)
 const conventions = await call('/company'), calendar = await call('/calendars/synthetic-bifocal-july/1')
 const snapshot = await call('/queries/run', query)
 assert.deepEqual(snapshot.definition,query)
 assert.deepEqual(snapshot.context.company,{revision:conventions.revision,settings:conventions.settings})
 assert.deepEqual(snapshot.context.calendar,{...query.context.calendar,definition:calendar.definition})
 assert.equal(snapshot.context.timezone,conventions.settings.timezone);assert.equal(snapshot.context.currency,conventions.settings.currency)
 assert.equal(snapshot.context.securityScope.ownerId,(await(await context.request.get(origin+'/auth/session')).json()).operator.id)
 assert.equal(snapshot.context.definitionVersions.model.label,query.context.modelVersion)
 assert.equal(snapshot.context.definitionVersions.metrics.label,query.context.metricVersion)
 const wrongType = await call('/queries/run',{...query,filters:[{column:'region',op:'eq',value:true}]},422)
 assert.equal(wrongType.error,'filter_value_type_mismatch')
 // Independently expressed integer-cents SQL, through real SQLite, not the
 // product rational engine or a copied expected-answer implementation.
 const reference = new DatabaseSync(':memory:')
 reference.exec('CREATE TABLE sales(date TEXT,region TEXT, customer TEXT, revenue_cents INTEGER, profit_cents INTEGER, score INTEGER, weight INTEGER)')
 const insert = reference.prepare('INSERT INTO sales VALUES(?,?,?,?,?,?,?)')
 for (const row of [['2026-01-15','West','c1',10010,3003,10,1],['2026-01-16','West','c1',-2002,-601,20,3],['2026-01-17','West','c3',null,null,null,2],['2026-01-18','West','c4',-1,-1,0,1],['2026-01-16','East','c2',0,0,99,1],['2025-12-31','West','c9',900000,100000,99,1],['2026-02-01','West','c9',888800,50000,99,1]]) insert.run(...row)
 const gold = reference.prepare("SELECT sum(revenue_cents) AS cents,sum(profit_cents) AS profit,count(DISTINCT customer) AS customers,sum(score*weight) AS weighted,sum(CASE WHEN score IS NOT NULL THEN weight END) AS weights FROM sales WHERE region='West' AND date>='2026-01-01' AND date<='2026-01-31'").get()
 assert.equal(snapshot.answer.totals.revenue.value, `${Math.trunc(gold.cents / 100)}.${String(gold.cents % 100).padStart(2,'0')}`)
 assert.equal(snapshot.answer.totals.customers.value, String(gold.customers))
 assert.equal(snapshot.answer.totals.weighted.value, (gold.weighted / gold.weights).toFixed(4))
 assert.equal(snapshot.answer.totals.margin.value, '29.9863')
 assert.deepEqual(snapshot.answer.totals.margin.exact, {numerator:'240100',denominator:'8007'})
 assert.equal(snapshot.answer.rows.find(row => row.dimensions[0] === 'c3').values.revenue.state, 'null')
 reference.close()
 const subtotals=await call('/queries/run',{...query,filters:query.filters.slice(1),groupBy:['region']})
 assert.equal(subtotals.answer.totals.customers.value,'4')
 assert.equal(subtotals.answer.rows.reduce((sum,row)=>sum+Number(row.values.customers.value),0),5)
 const zero=await call('/queries/run',{...query,filters:[{column:'region',op:'eq',value:'East'}]})
 assert.equal(zero.answer.totals.margin.state,'unknown');assert.equal(zero.answer.totals.revenue.value,'0.00')
 const fanout = { ...query,joins:[{dataset:dimension,as:'customers',left:'customer',right:'customer',duplicates:'reject'}] }
 const refused = await call('/queries/run', fanout, 409); assert.equal(refused.error,'join_fanout_refused')
 const joinedQuery={...fanout,joins:[{...fanout.joins[0],duplicates:'identical'}]}
 const joined = await call('/queries/run', joinedQuery)
 assert.deepEqual(joined.answer.totals,snapshot.answer.totals)
 assert.equal(joined.answer.commonSnapshot,'unavailable'); assert.equal(joined.answer.certification,'unavailable')
 assert.equal(joined.answer.joinDiagnostics[0].duplicateRowsRemoved,1)
 const dashboard = await call('/dashboards',{queryId:joined.queryId,title:'West margin'})
 const report = await call('/reports',{queryId:joined.queryId,title:'West margin report'})
 assert.deepEqual(dashboard.answer,joined.answer); assert.deepEqual(report.answer,joined.answer)
 for(const path of [`/queries/${snapshot.queryId}`,`/dashboards/${dashboard.id}`,`/reports/${report.id}`])assert.equal((await context.request.get(origin+'/api/operator'+path,{headers:{Cookie:''}})).status(),401)
 const foreign=await context.request.post(origin+'/api/operator/queries/'+snapshot.queryId+'/rerun',{headers:{Origin:'https://foreign.example.test'},data:{}});assert.equal(foreign.status(),401)
 await proveExactBrowser(origin,page,joinedQuery,'create')
 const replacement = await files.plan({...file,data:'id,date,region,customer,revenue,profit,score,weight\n6,01/20/2026,West,c9,$999.99,$0.00,3,1\n'},true,dataset)
 await files.apply(replacement,dataset)
 const changedConventions=await context.request.put(origin+'/api/operator/company',{headers,data:{previousRevision:conventions.revision,settings:{...conventions.settings,timezone:'America/Chicago',reportCutoff:'03:00'}}})
 assert.equal(changedConventions.status(),200,await changedConventions.text())
 const rerun = await call(`/queries/${snapshot.queryId}/rerun`,{},200)
 assert.equal(rerun.reproduced,true); assert.deepEqual(rerun.answer,snapshot.answer)
 assert.deepEqual(rerun.context,snapshot.context)
 assert.deepEqual((await call(`/queries/${joined.queryId}/rerun`,{},200)).answer,joined.answer)
 await proveExactBrowser(origin,page,query,'changed',report.id)
 for (const [kind,id] of [['dashboards',dashboard.id],['reports',report.id]]) assert.deepEqual((await call(`/${kind}/${id}`)).answer,joined.answer)
 const broader = await call(`/queries/${snapshot.queryId}/rerun`,{securityScope:'all',filters:[{column:'date',op:'gte',value:'2025-01-01'}]},403)
 assert.equal(broader.error,'snapshot_scope_immutable')
 const changed = await call('/queries/run',query)
 assert.equal(changed.answer.totals.revenue.value,'999.99')
 const comparison = await call('/reconciliations',{leftQueryId:snapshot.queryId,rightQueryId:changed.queryId},200)
 assert.equal(comparison.status,'unresolved_difference'); assert.equal(comparison.officialCertificationAllowed,false)
 // Explicit quality states cannot collapse to zero or a partial total.
 const flagged = {...file,datasetId:'synthetic-bifocal-flags',key:null,data:'value,quality\n$0.00,value\n,unknown\n$12.00,suppressed\n$5.00,incomplete\n'}
 const flagPlan = await files.plan(flagged,false,flagged.datasetId); await files.apply(flagPlan,flagged.datasetId)
 const flaggedResult = await call('/queries/run',{...query,dataset:flagged.datasetId,filters:[],groupBy:['quality'],measures:[{id:'amount',op:'sum',column:'value',stateColumn:'quality',unit:'money',sourceCurrency:'USD',scale:2}]})
 assert.equal(flaggedResult.answer.totals.amount.state,'suppressed'); assert.equal(flaggedResult.answer.totals.amount.value,null)
 for(const flag of ['unknown','incomplete','suppressed'])assert.equal(flaggedResult.answer.rows.find(row=>row.dimensions[0]===flag).values.amount.state,flag)
 assert.equal(flaggedResult.answer.rows.find(row=>row.dimensions[0]==='value').values.amount.value,'0.00')
 const fx={...file,columns:{id:'number',amount:'money',currency:'text',date:'date'},datasetId:'synthetic-bifocal-fx',data:'id,amount,currency,date\n1,100.00,EUR,06/19/2026\n2,100.00,USD,06/19/2026\n3,-20.00,EUR,06/19/2026\n'}
 const fxPlan=await files.plan(fx,false,fx.datasetId);await files.apply(fxPlan,fx.datasetId)
 const fxQuery={...query,dataset:fx.datasetId,filters:[],groupBy:['currency'],measures:[{id:'usd',op:'sum',column:'amount',currencyColumn:'currency',rateDateColumn:'date',unit:'money',scale:2}],context:{...query.context,rateSource:{id:'synthetic-bifocal-rates',version:1}}}
 const converted=await call('/queries/run',fxQuery)
 assert.equal(converted.answer.totals.usd.value,'200.00')
 assert.equal(converted.context.rateSource.definition.rates[0].rate,'0.8')
 assert.deepEqual(converted.context.rateSource.definition,(await call('/rates/synthetic-bifocal-rates/1')).definition)
 const fxReport=await call('/reports',{queryId:converted.queryId,title:'USD report including EUR transactions'})
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/reports/'+fxReport.id);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();assert.match(await page.locator('#totals').innerText(),/200\.00/);assert.match(await page.locator('#totals').innerText(),/USD/);assert.match(await page.locator('#groups').innerText(),/EUR/);if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/answers-currency-report-${width}.png`,fullPage:true})}

 await call('/queries/run',{...fxQuery,context:query.context},422)
 // Undo unpublishes data, while immutable answers remain owner-held custody.
 const emptyId='synthetic-bifocal-empty-query'
 const emptyPlan=await files.plan({...file,datasetId:emptyId},false,emptyId);await files.apply(emptyPlan,emptyId)
 const retained=await call('/queries/run',{...query,dataset:emptyId})
 await files.undo(emptyPlan,emptyId)
 assert.equal((await context.request.get(`${origin}/api/operator/datasets/${emptyId}`)).status(),404)
 assert.deepEqual((await call(`/queries/${retained.queryId}/rerun`,{},200)).answer,retained.answer)
 const emptyErasure=await context.request.post(`${origin}/api/operator/datasets/${emptyId}/erase`,{headers,data:{confirmDataset:emptyId,reviewedRevision:null}})
 assert.equal(emptyErasure.status(),200,await emptyErasure.text())
 const emptyReceipt=await emptyErasure.json();assert.ok(emptyReceipt.stores.some(store=>store.store==='bf_query_snapshots'&&store.rows===1))
 await call(`/queries/${retained.queryId}`,undefined,404)
 context.exactAnswerAuth={query:converted.queryId,report:fxReport.id}
 // Source erasure removes every retained answer and artifact in its own batch.
 const revision = (await files.read(dataset)).revision
 const erasure = await context.request.post(`${origin}/api/operator/datasets/${dataset}/erase`,{headers,data:{confirmDataset:dataset,reviewedRevision:revision}})
 assert.equal(erasure.status(),200,await erasure.text())
 await call(`/queries/${snapshot.queryId}`,undefined,404)
 await call(`/queries/${snapshot.queryId}/rerun`,{},404)
 await call(`/dashboards/${dashboard.id}`,undefined,404); await call(`/reports/${report.id}`,undefined,404)
 await proveExactBrowser(origin,page,query,'erased',report.id)
 console.log('Exact answers: integer-cents SQL parity, distinct/weighted/subtotals, fanout refusal, immutable cross-door replay, scope denial and source erasure passed')
}
