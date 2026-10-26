import assert from 'node:assert/strict'

/** Authored interactions use one real imported source, a real published model
 * and the native calculation library. Expected cents are written independently. */
export async function proveDashboardInteractions({origin,context,page,upload,proveScreen}){
 const api=async(path,data,expected=data===undefined?200:201)=>{const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin},...(data===undefined?{}:{data})});assert.equal(response.status(),expected,await response.text());return response.json()}
 page.on('pageerror',error=>console.error('Dashboard browser error: '+error.message))
 const dataset='synthetic-bifocal-dashboard-interactions',calendar='synthetic-bifocal-dashboard-july'
 await upload(dataset,'invoice,date,region,revenue\n1,06/30/2026,West,100.00\n2,07/01/2026,West,10.00\n3,08/01/2026,East,20.00\n4,09/01/2026,West,30.00\n5,10/01/2026,East,40.00\n')
 await api('/calendars',{id:calendar,previousVersion:null,definition:{name:'Dashboard July year',kind:'fiscal',startMonth:7}},201)
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region','date'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'number',scale:2},{id:'orders',op:'count',unit:'count',scale:0}],semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'number'},{column:'date',type:'date'},{column:'region',type:'text'},{column:'revenue',type:'number'}],hierarchies:[['region','date']],slowlyChanging:'reject-duplicate-grain'},fiscal:{column:'date',asOf:'2026-08-15',window:'quarter-to-date'},context:{modelVersion:'dashboard-source',metricVersion:'dashboard-source',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const model=await api('/models',{definition:{views:[{id:'sales',kind:'chart',query,rowRules:[]}],quality:[]}}),branch='/models/'+model.modelId+'/branches/'+model.branchId,review=await api(branch+'/validate',{},200)
 assert.equal(review.compatible,true,JSON.stringify(review));await api(branch+'/approve',{digest:review.digest},200);await api(branch+'/promote',{environment:'staging',digest:review.digest},200);await api(branch+'/promote',{environment:'production',digest:review.digest},200)
 const libraryInput={version:1,id:'synthetic-bifocal-dashboard-scenario',label:'Dashboard revenue scenario',modelId:model.modelId,modelRevision:model.revision,viewId:'sales',calculations:[{id:'scenario-revenue',language:'native',sourceExpression:'SUM(revenue) * factor',format:'0.00',expression:{kind:'binary',op:'*',left:{kind:'aggregate',op:'sum',expression:{kind:'field',field:'revenue'}},right:{kind:'parameter',name:'factor'}}}],groups:[],parameters:[{id:'factor',default:{kind:'literal',type:'number',value:'1'},min:'0',max:'2',step:'0.1'}],fieldParameters:[]}
 const calculationReview=await api('/calculations/review',{input:libraryInput},200);assert.equal(calculationReview.report.compatible,true,JSON.stringify(calculationReview));const library=await api('/calculations/save',{input:libraryInput,reviewedDigest:calculationReview.digest})
 const authoredQuery={...query,context:{...query.context,modelVersion:model.revision}},cards=[{key:'all-sales',definition:authoredQuery},{key:'west-sales',definition:{...authoredQuery,filters:[{column:'region',op:'eq',value:'West'}]}}],layout={desktop:[{key:'all-sales',x:0,y:0,w:6,h:4},{key:'west-sales',x:6,y:0,w:6,h:4}],phone:[{key:'all-sales',x:0,y:0,w:1,h:4},{key:'west-sales',x:0,y:4,w:1,h:4}]}
 const document={version:2,title:'Interactive operating review',cards,layout,interactions:{tabs:[{id:'overview',label:'Overview',cards:cards.map(c=>c.key),tiles:['explanation','logo']},{id:'detail',label:'Detail',cards:['all-sales'],tiles:[]}],tiles:[{key:'explanation',kind:'text',text:'Quarter actuals and a separate operating scenario.'},{key:'logo',kind:'image',alt:'Imported inert marker',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII='}],tileLayout:{desktop:[{key:'explanation',x:0,y:4,w:12,h:1},{key:'logo',x:0,y:5,w:12,h:1}],phone:[{key:'explanation',x:0,y:8,w:1,h:1},{key:'logo',x:0,y:9,w:1,h:1}]},dimensions:['region'],recordActions:[{id:'source-invoices',card:'all-sales',label:'Inspect source invoices',columns:['invoice','date','region','revenue'],keys:['invoice']}],fieldParameters:[{id:'breakdown',label:'Displayed breakdown',card:'all-sales',default:'region',choices:[{id:'region',label:'Revenue by region',groupBy:['region'],measures:['revenue']},{id:'date',label:'Orders by date',groupBy:['date'],measures:['orders']}]}],fiscalParameters:[{id:'period',label:'Fiscal period',cards:cards.map(c=>c.key),default:{asOf:'2026-08-15',window:'quarter-to-date'}}],whatIfParameters:[{id:'scenario',label:'Scenario factor',card:'all-sales',libraryId:library.id,revision:library.revision,parameter:'factor',default:'1'}],states:[{name:'All regions',revision:1,selection:{}},{name:'West review',revision:1,selection:{filters:[{column:'region',op:'eq',value:'West'}]}},{name:'East review',revision:1,selection:{filters:[{column:'region',op:'eq',value:'East'}]}}],stories:[{id:'regional-story',label:'Three-region review',steps:[{state:'All regions',revision:1},{state:'West review',revision:1},{state:'East review',revision:1}]}],actions:[],duplicateAllowed:true}}
 const save=async(doc,id,previousRevision)=>{const input={document:doc,...id?{id,previousRevision}:{}},review=await api('/dashboard-authoring/review',input,200);return api('/dashboard-authoring/apply',{...input,reviewedDigest:review.digest})}
 const publish=async(saved)=>{const review=await api('/dashboard-authoring/'+saved.id+'/publication/review',{revision:saved.revision,previousGeneration:saved.generation,action:'publish'},200);return api('/dashboard-authoring/'+saved.id+'/publish',{revision:saved.revision,previousGeneration:saved.generation,reviewedDigest:review.digest},200)}
 const targetDocument=structuredClone(document);targetDocument.title='Regional drill destination';targetDocument.interactions.whatIfParameters=[];targetDocument.interactions.fieldParameters=[];targetDocument.interactions.stories=[];targetDocument.interactions.states=[];targetDocument.interactions.duplicateAllowed=false
 const target=await publish(await save(targetDocument))
 document.interactions.actions=[{id:'regional-drill',label:'Open regional detail',card:'all-sales',kind:'dashboard',target:target.id,bindings:[{source:'region',target:'region'}],fiscalBindings:[{source:'period',target:'period'}]},{id:'regional-tooltip',label:'Show regional tooltip',card:'all-sales',kind:'tooltip',target:target.id,bindings:[{source:'region',target:'region'}],fiscalBindings:[{source:'period',target:'period'}]}]
 const saved=await publish(await save(document)),endpoint='/dashboard-authoring/'+saved.id,run=selection=>api(endpoint+'/run',{selection},200),base=await run({})
 assert.equal(base.cards[0].answer.totals.revenue.value,'30.00');assert.equal(base.cards[1].answer.totals.revenue.value,'10.00');assert.equal(base.cards[0].scenario.answer.formatted.totals['scenario-revenue'],'30.00')
 const west={filters:[{column:'region',op:'eq',value:'West'}]},east={filters:[{column:'region',op:'eq',value:'East'}]}
 assert.equal((await run(west)).cards[0].answer.totals.revenue.value,'10.00');assert.equal((await run(east)).cards[1].status,'empty')
 const annual={...west,fiscal:{period:{asOf:'2026-10-15',window:'year-to-date'}},whatIf:{scenario:'1.5'}},annualRun=await run(annual)
 assert.equal(annualRun.cards[0].answer.totals.revenue.value,'40.00');assert.equal(annualRun.cards[0].scenario.answer.formatted.totals['scenario-revenue'],'60.00');assert.equal((await run({})).cards[0].answer.totals.revenue.value,'30.00','Scenario and reader period never change source actuals or published defaults')
 // Reconcile exact source rows at the dashboard door, including fixed West
 // restrictions. Complete prior windows exclude the current interval boundary.
 const relativeCases=[
  ['period-to-date','2026-08-15',['3'],'20.00'],
  ['previous-period','2026-08-15',['2'],'10.00'],
  ['previous-quarter','2026-10-15',['2','3','4'],'60.00'],
  ['previous-year','2026-08-15',['1'],'100.00'],
 ]
 for(const [window,asOf,invoices,total] of relativeCases){
  const selection={fiscal:{period:{asOf,window}}},current=await run(selection)
  assert.equal(current.cards[0].answer.totals.revenue.value,total,window)
  const records=await api(endpoint+'/source-records',{selection,actionId:'source-invoices'},200)
  assert.deepEqual(records.rows.map(row=>row.invoice),invoices,window)
  assert.ok((await api(endpoint+'/source-records',{selection,actionId:'source-invoices',record:{invoice:'5'}},404)).error)
 }
 await api(endpoint+'/run',{selection:{fiscal:{period:{asOf:'2026-02-30',window:'previous-period'}}}},400)
 await api(endpoint+'/run',{selection:{fiscal:{period:{asOf:'2026-08-15',window:'previous-decade'}}}},400)
 // Independent dated corpus includes both sides of FY2020's 53rd retail week.
 // July-style calendar arithmetic must not substitute for 4-4-5 or 4-5-4.
 const retailDataset='synthetic-bifocal-relative-retail'
 await upload(retailDataset,'invoice,date,region,revenue\n1,01/27/2019,West,1.00\n2,01/25/2020,West,2.00\n3,01/26/2020,West,4.00\n4,10/24/2020,West,8.00\n5,10/25/2020,West,16.00\n6,12/19/2020,West,32.00\n7,12/20/2020,West,64.00\n8,12/26/2020,West,128.00\n9,12/27/2020,West,256.00\n10,01/30/2021,West,512.00\n11,01/31/2021,West,1024.00\n12,02/01/2021,West,2048.00\n13,02/02/2021,West,4096.00\n')
 for(const kind of ['445','454']){
  const id='synthetic-bifocal-relative-'+kind
  await api('/calendars',{id,previousVersion:null,definition:{name:'Retail boundary '+kind,kind,startMonth:2,startDay:1,weekStartsOn:0,anchor:'on-or-before'}})
  for(const [window,total,rows] of [['period-to-date','3072.00',2],['quarter-to-date','3072.00',2],['year-to-date','3072.00',2],['previous-period',kind==='445'?'960.00':'768.00',kind==='445'?4:2],['previous-quarter','1008.00',6],['previous-year','1020.00',8]]){
   const result=await api('/queries/run',{...query,dataset:retailDataset,groupBy:[],context:{...query.context,calendar:{id,version:1}},fiscal:{column:'date',asOf:'2021-02-01',window}})
   assert.equal(result.answer.totals.revenue.value,total,kind+' '+window)
   assert.equal(result.answer.filteredRows,rows,kind+' '+window+' boundaries')
   assert.equal((await api('/queries/'+result.queryId+'/rerun',{},200)).reproduced,true)
  }
 }
 // Civil date windows are independent of the fiscal period and include leap
 // day, a year crossing, and an explicit Monday week start.
 const civilDataset='synthetic-bifocal-relative-civil',civilCalendar='synthetic-bifocal-relative-monday'
 await upload(civilDataset,'invoice,date,region,revenue\n1,12/31/2023,West,1.00\n2,01/01/2024,West,2.00\n3,01/28/2024,West,4.00\n4,01/29/2024,West,8.00\n5,01/31/2024,West,16.00\n6,02/01/2024,West,32.00\n7,02/23/2024,West,64.00\n8,02/24/2024,West,128.00\n9,02/25/2024,West,256.00\n10,02/26/2024,West,512.00\n11,02/28/2024,West,1024.00\n12,02/29/2024,West,2048.00\n13,03/01/2024,West,4096.00\n')
 await api('/calendars',{id:civilCalendar,previousVersion:null,definition:{name:'July fiscal year with Monday weeks',kind:'fiscal',startMonth:7,weekStartsOn:1}})
 const civilQuery={...query,dataset:civilDataset,context:{...query.context,calendar:{id:civilCalendar,version:1}},fiscal:{column:'date',asOf:'2024-02-29',window:'month-to-date'}}
 const civilModel=await api('/models',{definition:{views:[{id:'sales',kind:'chart',query:civilQuery,rowRules:[]}],quality:[]}}),civilBranch='/models/'+civilModel.modelId+'/branches/'+civilModel.branchId,civilReview=await api(civilBranch+'/validate',{},200)
 assert.equal(civilReview.compatible,true);await api(civilBranch+'/approve',{digest:civilReview.digest},200);await api(civilBranch+'/promote',{environment:'staging',digest:civilReview.digest},200);await api(civilBranch+'/promote',{environment:'production',digest:civilReview.digest},200)
 const civilDocument=structuredClone(targetDocument);civilDocument.title='Civil relative dates';civilDocument.cards=civilDocument.cards.map(c=>({key:c.key,definition:{...civilQuery,context:{...civilQuery.context,modelVersion:civilModel.revision}}}));civilDocument.interactions.fiscalParameters[0].default={asOf:'2024-02-29',window:'month-to-date'}
 const civilSaved=await publish(await save(civilDocument)),civilEndpoint='/dashboard-authoring/'+civilSaved.id,civilCases=[
  ['as-of-day','2024-02-29',['12'],'2048.00'],
  ['previous-day','2024-03-01',['12'],'2048.00'],
  ['week-to-date','2024-02-29',['10','11','12'],'3584.00'],
  ['month-to-date','2024-02-29',['6','7','8','9','10','11','12'],'4064.00'],
  ['previous-week','2024-02-29',['7','8','9'],'448.00'],
  ['previous-month','2024-02-29',['2','3','4','5'],'30.00'],
  ['last-7-days','2024-02-29',['7','8','9','10','11','12'],'4032.00'],
  ['last-30-days','2024-02-29',['5','6','7','8','9','10','11','12'],'4080.00'],
  ['previous-month','2024-01-01',['1'],'1.00'],
  ['previous-day','2024-01-01',['1'],'1.00'],
 ]
 for(const [window,asOf,invoices,total] of civilCases){
  const selection={fiscal:{period:{asOf,window}}},result=await api(civilEndpoint+'/run',{selection},200),records=await api(civilEndpoint+'/source-records',{selection,actionId:'source-invoices'},200)
  assert.equal(result.cards[0].answer.totals.revenue.value,total,window+' '+asOf);assert.deepEqual(records.rows.map(row=>row.invoice),invoices,window+' exact bounds')
  const independent=await api('/queries/run',{...civilQuery,fiscal:{column:'date',asOf,window}});assert.equal(independent.answer.totals.revenue.value,total);assert.equal((await api('/queries/'+independent.queryId+'/rerun',{},200)).reproduced,true)
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/dashboard-authoring/'+civilSaved.id+'/view');await page.getByRole('table',{name:'Exact all-sales results',exact:true}).waitFor();await page.getByText('Filters and parameters',{exact:true}).click()
  for(const [window,asOf,,total] of civilCases.slice(0,8)){
   const cutoff=page.getByLabel('Fiscal period as of',{exact:true});await cutoff.fill(asOf);await Promise.all([page.waitForResponse(r=>r.url().endsWith(civilEndpoint+'/run')&&r.status()===200),cutoff.dispatchEvent('change')])
   await page.getByLabel('Fiscal period window',{exact:true}).selectOption(window);await page.waitForFunction(total=>document.querySelector('[data-card-key="all-sales"] .published-totals dd')?.textContent.replaceAll(',','').includes(total),total)
   await proveScreen('authored-dashboard-civil-'+window,{widths:[width],resize:false})
  }
 }
 const sourceRows=await api(endpoint+'/source-records',{selection:annual,actionId:'source-invoices'},200);assert.deepEqual(sourceRows.rows.map(row=>[row.invoice,row.region,row.revenue]),[['2','West','10.00'],['4','West','30.00']]);assert.equal(sourceRows.totalRows,2)
 const exactRecord=await api(endpoint+'/source-records',{selection:annual,actionId:'source-invoices',record:{invoice:'4'}},200);assert.equal(exactRecord.rows[0].date,'2026-09-01');await api(endpoint+'/source-records',{selection:annual,actionId:'source-invoices',record:{invoice:'3'}},404);await api(endpoint+'/source-records',{selection:annual,actionId:'source-invoices',record:{invoice:'1'}},404);await api(endpoint+'/source-records',{selection:annual,actionId:'source-invoices',record:{revenue:'30.00'}},400)
 const counts=await run({...annual,fields:{breakdown:'date'}});assert.equal(counts.cards[0].answer.totals.orders.value,'2');assert.equal(counts.cards[0].answer.totals.revenue,undefined)
 const invalid=await run({whatIf:{scenario:'1.25'}});assert.equal(invalid.cards[0].status,'failed');assert.equal(invalid.cards[0].answer,undefined)
 await api(endpoint+'/run',{selection:{fields:{breakdown:'forbidden'}}},403)
 const bookmark=await api(endpoint+'/reader-bookmarks',{name:'My West annual',previousRevision:null,selection:annual});assert.equal(bookmark.revision,1)
 await api(endpoint+'/reader-bookmarks',{name:'My West annual',previousRevision:null,selection:east},409)
 await api(endpoint+'/reader-bookmarks',{name:'My West annual',previousRevision:1,selection:east});assert.deepEqual((await api(endpoint+'/reader-bookmarks/My%20West%20annual/1')).selection,annualRun.selection)
 await api(endpoint+'/action',{selection:{},actionId:'regional-drill'},400)
 const drill=await api(endpoint+'/action',{selection:annual,actionId:'regional-drill'}),drilled=await api('/dashboard-authoring/'+target.id+'/run',{selection:{},contextId:drill.contextId},200)
 const inheritedRecords=await api('/dashboard-authoring/'+target.id+'/source-records',{selection:{},contextId:drill.contextId,actionId:'source-invoices'},200);assert.deepEqual(inheritedRecords.rows.map(row=>row.invoice),['2','4'])
 assert.equal(drilled.cards[0].answer.totals.revenue.value,'40.00');assert.equal(drilled.inherited.fiscal.period.asOf,'2026-10-15')
 const narrowed=await api('/dashboard-authoring/'+target.id+'/run',{selection:east,contextId:drill.contextId},200);assert.equal(narrowed.cards[0].status,'empty','Target reader filters intersect inherited West context')
 const tooltip=await api(endpoint+'/action',{selection:west,actionId:'regional-tooltip'},200);assert.equal(tooltip.cards[0].answer.totals.revenue.value,'10.00')
 const exact=await api(endpoint+'/current-export',{selection:annual,card:'all-sales',definitionHash:annualRun.cards[0].answer.definitionHash,watermarks:annualRun.cards[0].answer.sourceWatermarks});assert.equal(exact.answer.totals.revenue.value,'40.00')
 await api(endpoint+'/current-export',{selection:east,card:'all-sales',definitionHash:annualRun.cards[0].answer.definitionHash,watermarks:annualRun.cards[0].answer.sourceWatermarks},409)
 const duplicateReview=await api(endpoint+'/duplicate/review',{title:'Permitted operating copy'},200),copy=await api(endpoint+'/duplicate/apply',{title:'Permitted operating copy',reviewedDigest:duplicateReview.digest});assert.equal(copy.publishedRevision,null);assert.equal(copy.definition.title,'Permitted operating copy');await api('/dashboard-authoring/'+target.id+'/duplicate/review',{title:'Forbidden copy'},403)
 const before=(await api('/datasets/'+dataset)).revision
 await page.clock.install({time:new Date('2026-10-26T12:00:00Z')})
 for(const width of [1440,390]){
  const screen=label=>proveScreen(label,{widths:[width],resize:false})
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/dashboard-authoring/'+saved.id+'/view');await page.getByRole('table',{name:'Exact all-sales results',exact:true}).waitFor();await screen('authored-dashboard-interactions-default')
  assert.equal(await page.getByRole('img',{name:'Imported inert marker'}).count(),1)
  await page.getByRole('tab',{name:'Detail',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-card-key="west-sales"]')?.hidden===true);await screen('authored-dashboard-interactions-tab')
  await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-card-key="west-sales"]')?.hidden===false)
  await page.getByText('Filters and parameters',{exact:true}).click();await page.getByLabel('Filter dimension',{exact:true}).selectOption('region');await page.getByLabel('Filter value',{exact:true}).fill('East');await page.getByRole('button',{name:'Apply filter',exact:true}).click();await page.locator('[data-card-key="west-sales"][data-state="empty"]').waitFor();await screen('authored-dashboard-interactions-global-filter')
  await page.getByRole('button',{name:'Clear reader filters',exact:true}).click();await page.locator('[data-card-key="west-sales"][data-state="fresh"]').waitFor()
  const all=page.locator('[data-card-key="all-sales"]');await all.getByText('Cross-filter from this tile',{exact:true}).click();await all.getByRole('button',{name:'Filter Region to West',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#dashboard-reader-context')?.textContent.includes('West'));await screen('authored-dashboard-interactions-cross-filter')
  await page.getByLabel('Fiscal period as of',{exact:true}).fill('2026-10-15');await Promise.all([page.waitForResponse(r=>r.url().endsWith(endpoint+'/run')&&r.status()===200),page.getByLabel('Fiscal period as of',{exact:true}).dispatchEvent('change')])
  await page.getByLabel('Fiscal period window',{exact:true}).selectOption('year-to-date');await page.waitForFunction(()=>document.querySelector('[data-card-key="all-sales"] .published-totals dd')?.textContent.includes('40.00'))
  for(const [window,total] of [['period-to-date','0.00'],['previous-period','30.00'],['previous-quarter','40.00'],['previous-year','100.00']]){
   const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(endpoint+'/run')&&r.status()===200),page.getByLabel('Fiscal period window',{exact:true}).selectOption(window)])
   const result=await response.json()
   // With the fixed West reader filter, the empty current period has null sum.
   assert.equal(result.cards[0].answer.totals.revenue.value,window==='period-to-date'?null:total)
   await page.waitForFunction(window=>document.querySelector('#dashboard-reader-context')?.textContent.includes(window),window)
   await screen('authored-dashboard-relative-'+window)
  }
  await page.getByLabel('Fiscal period window',{exact:true}).selectOption('year-to-date');await page.waitForFunction(()=>document.querySelector('[data-card-key="all-sales"] .published-totals dd')?.textContent.includes('40.00'))
  await page.getByLabel('Scenario factor',{exact:true}).fill('1.5');await page.getByLabel('Scenario factor',{exact:true}).dispatchEvent('change');await page.waitForFunction(()=>document.querySelector('.dashboard-scenario')?.textContent.includes('60.00'));await screen('authored-dashboard-interactions-fiscal-what-if')
  await page.getByLabel('Displayed breakdown',{exact:true}).selectOption('date');await page.getByRole('table',{name:'Exact all-sales results',exact:true}).getByRole('columnheader',{name:'Orders',exact:true}).waitFor();await screen('authored-dashboard-interactions-field-parameter')
  await page.getByLabel('Displayed breakdown',{exact:true}).selectOption('region');await page.getByRole('table',{name:'Exact all-sales results',exact:true}).getByRole('columnheader',{name:'Revenue',exact:true}).waitFor()
  const [recordsResponse]=await Promise.all([page.waitForResponse(response=>response.url().endsWith(endpoint+'/source-records')),all.getByRole('button',{name:'Inspect source invoices',exact:true}).click()]);assert.equal(recordsResponse.status(),200,await recordsResponse.text());await page.getByRole('dialog').getByRole('table',{name:'Protected source records',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').getByRole('table',{name:'Protected source records',exact:true}).getByRole('row').count(),3);await page.getByRole('button',{name:'Open record 4',exact:true}).click();await page.getByRole('heading',{name:'Source record 4',exact:true}).waitFor();assert.match(await page.getByRole('dialog').innerText(),/2026-09-01/);await screen('authored-dashboard-interactions-source-record');await page.getByRole('button',{name:'Close source records',exact:true}).click()
  await all.getByRole('button',{name:'Show regional tooltip',exact:true}).click();await page.getByRole('dialog').getByRole('table',{name:'Tooltip all-sales',exact:true}).waitFor();await screen('authored-dashboard-interactions-tooltip');await page.getByRole('button',{name:'Close tooltip',exact:true}).click()
  await all.getByRole('button',{name:'Open regional detail',exact:true}).click();await page.waitForURL('**/'+target.id+'/view?context=*');await page.getByRole('table',{name:'Exact all-sales results',exact:true}).waitFor();assert.match(await page.locator('#dashboard-reader-context').innerText(),/Inherited region = West/);assert.match(await page.locator('#dashboard-reader-context').innerText(),/2026-10-15/);await screen('authored-dashboard-interactions-drillthrough')
  await page.goto(origin+'/app/dashboard-authoring/'+saved.id+'/view');await page.getByRole('table',{name:'Exact all-sales results',exact:true}).waitFor();await page.getByText('Bookmarks, stories and display',{exact:true}).click();await page.getByLabel('Personal bookmark',{exact:true}).selectOption('My West annual');await page.getByLabel('Personal bookmark revision',{exact:true}).fill('1');await page.getByRole('button',{name:'Open personal bookmark',exact:true}).click();await page.getByRole('status').filter({hasText:'Opened personal bookmark My West annual revision 1.'}).waitFor();await screen('authored-dashboard-interactions-personal-bookmark')
  await page.getByLabel('Shared state',{exact:true}).selectOption('All regions');await page.getByRole('button',{name:'Open shared state',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-card-key="all-sales"] .published-totals dd')?.textContent.includes('30.00'));await screen('authored-dashboard-interactions-shared-default')
  for(let step=1;step<=3;step++){await page.getByRole('button',{name:'Next story step',exact:true}).click();await page.getByRole('status').filter({hasText:'step '+(step%3+1)+' of 3'}).waitFor();await screen('authored-dashboard-interactions-story-'+step)}
  await page.getByRole('button',{name:'Play story',exact:true}).click();await page.getByRole('status').filter({hasText:'step 1 of 3 · All regions revision 1 · playing'}).waitFor();await page.clock.fastForward(10000);await page.getByRole('status').filter({hasText:'step 2 of 3 · West review revision 1 · playing'}).waitFor();await screen('authored-dashboard-interactions-story-playing');await page.getByRole('button',{name:'Pause story',exact:true}).click();await page.getByRole('status').filter({hasText:'step 2 of 3 · West review revision 1 · paused'}).waitFor();await page.clock.fastForward(20000);assert.equal(await page.getByRole('status').filter({hasText:'step 2 of 3 · West review revision 1 · paused'}).count(),1);await screen('authored-dashboard-interactions-story-paused')
 }
 assert.equal((await api('/datasets/'+dataset)).revision,before,'Reader interactions make no source writes')
 assert.equal((await fetch(origin+'/api/operator'+endpoint+'/run',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:'{}'})).status,401)
 const source=await api('/datasets/'+dataset);await api('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200);await api(endpoint+'/run',{selection:{}},404);await api(endpoint+'/reader-bookmarks',undefined,404)
 console.log('Authored dashboard interactions: tabs, inert tiles, narrowed global and cross filters, exact fiscal and field and scenario values, personal and shared states, three-state story, protected drillthrough, allowed tooltip, exact exports, duplication and source withdrawal passed')
}
