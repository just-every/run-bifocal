import assert from 'node:assert/strict'
import {unzipSync,strFromU8} from 'fflate'
import {DOMParser} from '@xmldom/xmldom'

/** Actual published subjects, exact native joins and appends and the visual door. */
export async function proveCompositionTooling({origin,context,page,upload,proveScreen}) {
 const headers={Origin:origin},api=async(path,data,status)=>{
  const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers,...data===undefined?{}:{data}})
  if(status!==undefined)assert.equal(response.status(),status,await response.text());else assert.ok(response.ok(),await response.text())
  return response.json()
 }
 const leftDataset='synthetic-bifocal-composition-left',rightDataset='synthetic-bifocal-composition-right',calendar='synthetic-bifocal-composition-calendar'
 const header='invoice,customer,region,revenue,cost,source_url,salary\n'
 const leftCSV=header+'a,X,North,$10.00,$2.00,https://example.test/a,9000\nb,Y,North,$20.00,$10.00,https://example.test/b,9000\nc,X,South,$30.00,$10.00,https://example.test/c,9000\nd,Z,West,$40.00,$20.00,https://example.test/d,9000\nhidden,Secret,Hidden,$999.00,$1.00,https://example.test/hidden,9900\n'+Array.from({length:26},(_,i)=>`zero-${i},X,North,$0.00,$0.00,https://example.test/zero-${i},9000\n`).join('')
 const rightCSV=header+'r1,X,North,$7.00,$7.00,https://example.test/r1,9000\nr2,W,South,$9.00,$3.00,https://example.test/r2,9000\nr3,Q,East,$11.00,$1.00,https://example.test/r3,9000\n'
 await Promise.all([upload(leftDataset,leftCSV),upload(rightDataset,rightCSV)])
 await api('/calendars',{id:calendar,previousVersion:null,definition:{name:'Composition fiscal year',kind:'fiscal',startMonth:1}})
 const definition=dataset=>({views:[{id:'sales',kind:'chart',query:{version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'},{id:'customers',op:'count-distinct',column:'customer',unit:'count',scale:0},{id:'ratio',op:'ratio',numerator:'revenue',denominator:'cost',unit:'number',scale:4,sourceCurrency:'USD'}],context:{modelVersion:'composition-model',metricVersion:'composition-measures',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'},semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'text'},{column:'customer',type:'text'},{column:'region',type:'text'},{column:'revenue',type:'money'},{column:'cost',type:'money'},{column:'source_url',type:'text'}],hierarchies:[['region','invoice']],slowlyChanging:'reject-duplicate-grain'}},rowRules:[{column:'region',op:'ne',value:'Hidden'}]}],quality:[]})
 const publish=async(path)=>{const review=await api(path+'/validate',{});assert.equal(review.compatible,true);await api(path+'/approve',{digest:review.digest});await api(path+'/promote',{environment:'staging',digest:review.digest});await api(path+'/promote',{environment:'production',digest:review.digest})}
 const create=async(doc)=>{const model=await api('/models',{definition:doc});await publish('/models/'+model.modelId+'/branches/'+model.branchId);return model}
 const left=await create(definition(leftDataset)),right=await create(definition(rightDataset))
 const params=model=>({modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['region'],filters:[]})
 const input={left:params(left),right:params(right),operation:'join',join:'inner'}
 assert.equal((await fetch(origin+'/api/operator/explore/compositions/run',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401)
 const foreign=await context.request.post(origin+'/api/operator/explore/compositions/run',{headers:{Origin:'https://foreign.example.test'},data:input});assert.equal(foreign.status(),401)
 const inner=await api('/explore/compositions/run',input,201),path='/explore/compositions/'+inner.id
 assert.equal(inner.rows.length,2);assert.equal(inner.diagnostics.matchedKeys,2);assert.equal(inner.diagnostics.left.unmatchedKeys,1);assert.equal(inner.diagnostics.left.excludedRows,1)
 // Independent cents, distinct keys and ratio of source sums. Summing the
 // grouped distinct counts would incorrectly return three customers here.
 assert.equal(inner.totals.left.revenue.value,'60.00');assert.equal(inner.totals.left.customers.value,'2');assert.equal(inner.totals.left.ratio.value,'2.7273')
 assert.equal(inner.totals.right.revenue.value,'16.00');assert.equal(inner.totals.right.ratio.value,'1.6000')
 assert.deepEqual(await api(path),inner)
 const pageRows=await api(path+'/page',{scope:'underlying',offset:0});assert.equal(pageRows.totalRows,31);assert.equal(pageRows.nextOffset,25)
 const lastPage=await api(path+'/page',{scope:'underlying',offset:pageRows.nextOffset});assert.equal(lastPage.nextOffset,null)
 const underlyingRows=[...pageRows.rows,...lastPage.rows];assert.equal(underlyingRows.length,31);assert.equal(underlyingRows.filter(row=>row[0]==='left').length,29)
 const leftInvoice=pageRows.columns.findIndex(column=>column.name==='left-invoice'),rightInvoice=pageRows.columns.findIndex(column=>column.name==='right-invoice')
 assert.equal(new Set(underlyingRows.map(row=>row[0]+':'+row[row[0]==='left'?leftInvoice:rightInvoice])).size,31)
 const summaryRows=await api(path+'/page',{scope:'summary',offset:0});assert.deepEqual(summaryRows.rows,inner.rows)
 const outer=await api('/explore/compositions/run',{...input,join:'full'},201)
 assert.equal(outer.rows.length,4);assert.equal(outer.totals.left.revenue.value,'100.00');assert.equal(outer.totals.right.revenue.value,'27.00')
 const leftJoin=await api('/explore/compositions/run',{...input,join:'left'},201);assert.equal(leftJoin.rows.length,3);assert.equal(leftJoin.totals.right.revenue.value,'16.00')
 const appended=await api('/explore/compositions/run',{...input,operation:'append'},201)
 assert.equal(appended.rows.length,6);assert.equal(appended.totals.left.customers.value,'3');assert.equal(appended.totals.right.customers.value,'3');assert.equal((await api('/explore/compositions/'+appended.id+'/page',{scope:'underlying',offset:0})).totalRows,33)
 await api('/explore/compositions/run',{...input,left:{...input.left,groupBy:['salary']}},403)
 await api('/explore/compositions/run',{...input,left:{...input.left,groupBy:['customer.region']}},403)
 await api('/explore/compositions/run',{...input,right:{...input.right,groupBy:['revenue']}},409)
 const incompatible=definition(rightDataset);incompatible.views[0].query.context.accountingBasis='cash';const cash=await create(incompatible)
 await api('/explore/compositions/run',{...input,right:params(cash)},409)
 const changedSchema=definition(rightDataset);changedSchema.views[0].query.measures[0].id='gross';const different=await create(changedSchema)
 await api('/explore/compositions/run',{...input,operation:'append',right:params(different)},409)
 for(const scope of ['summary','underlying'])for(const format of ['csv','xlsx']) {
  const response=await context.request.post(origin+'/api/operator'+path+'/export',{headers,data:{scope,format}});assert.equal(response.status(),200,await response.text());assert.equal(Number(response.headers()['x-bifocal-row-count']),scope==='summary'?2:31)
  if(format==='csv'){const text=await response.text();assert.ok(!text.includes('salary')&&!text.includes('Hidden'));if(scope==='underlying'){const rows=text.trimEnd().split('\r\n').slice(1).map(row=>row.split(',').map(cell=>cell.slice(1,-1)));assert.equal(rows.length,31);assert.equal(rows.filter(row=>row[0]==='left').length,29);const money=pageRows.columns.findIndex(c=>c.name==='left-revenue');assert.equal(rows.filter(row=>row[0]==='left').reduce((sum,row)=>sum+Math.round(Number(row[money])*100),0),6000)}}
  else{const xml=strFromU8(unzipSync(new Uint8Array(await response.body()))['xl/worksheets/sheet1.xml']);assert.equal((xml.match(/<row /g)??[]).length,scope==='summary'?3:32);assert.ok(!xml.includes('<f>')&&!xml.includes('Hidden'));assert.ok(xml.includes('t="n"'))}
 }
 const policyPath=origin+'/api/operator/explore/export-policy',policy=await(await context.request.get(policyPath)).json()
 const setCaps=async(csv,xlsx)=>{const current=await(await context.request.get(policyPath)).json(),response=await context.request.put(policyPath,{headers,data:{previousRevision:current.revision,csv,xlsx}});assert.equal(response.status(),200,await response.text());return response.json()}
 try {
  await setCaps(10,10)
  for(const format of ['csv','xlsx']) {
   const offered=await api(path+'/export',{scope:'underlying',format},413),plan=offered.fullExport
   assert.equal(offered.error,'interactive_export_cap_exceeded');assert.equal(plan.totalRows,31)
   const all=[];let offset=0,parts=0
   do {
    const response=await context.request.post(origin+'/api/operator'+path+'/full-export',{headers,data:{scope:'underlying',format,offset,planDigest:plan.planDigest}})
    assert.equal(response.status(),200,await response.text());parts++
    assert.match(response.headers()['content-disposition'],new RegExp('part-'+parts+'\\.'+format));assert.equal(response.headers()['x-bifocal-plan-digest'],plan.planDigest)
    const start=all.length
    if(format==='csv')all.push(...(await response.text()).trimEnd().split('\r\n').slice(1).map(row=>row.split(',').map(cell=>cell.slice(1,-1))))
    else {
     const xml=strFromU8(unzipSync(new Uint8Array(await response.body()))['xl/worksheets/sheet1.xml']),doc=new DOMParser().parseFromString(xml,'application/xml')
     all.push(...Array.from(doc.getElementsByTagName('row')).slice(1).map(row=>Array.from(row.getElementsByTagName('c')).map(cell=>cell.getElementsByTagName('t')[0]?.textContent??cell.getElementsByTagName('v')[0]?.textContent??'')))
    }
    assert.equal(Number(response.headers()['x-bifocal-row-count']),all.length-start)
    const next=response.headers()['x-bifocal-next-offset'];offset=next===''?null:Number(next)
   }while(offset!==null)
   assert.equal(parts,plan.parts);assert.equal(all.length,31)
   const identities=all.map(row=>row[0]+':'+row[row[0]==='left'?leftInvoice:rightInvoice])
   assert.equal(new Set(identities).size,31);assert.deepEqual(identities.sort(),underlyingRows.map(row=>row[0]+':'+row[row[0]==='left'?leftInvoice:rightInvoice]).sort())
   const money=pageRows.columns.findIndex(column=>column.name==='left-revenue');assert.equal(all.filter(row=>row[0]==='left').reduce((sum,row)=>sum+Math.round(Number(row[money])*100),0),6000)
  }
  const stale=await api(path+'/export-plan',{scope:'underlying',format:'csv'})
  await setCaps(11,11)
  const refused=await api(path+'/full-export',{scope:'underlying',format:'csv',offset:0,planDigest:stale.planDigest},409);assert.equal(refused.error,'full_export_plan_changed')
  await setCaps(10,10)
  for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/questions')
  await page.getByRole('status').filter({hasText:'Ready to explore'}).waitFor()
  await page.locator('#composition > summary').click()
  const pick=async(label,id)=>{const select=page.getByLabel(label,{exact:true}),option=select.locator('option').filter({hasText:id.slice(0,8)});await select.selectOption(await option.first().getAttribute('value'))}
  await pick('Left subject',left.modelId);await pick('Right subject',right.modelId)
  await page.getByLabel('Left matching key',{exact:true}).selectOption('region');await page.getByLabel('Right matching key',{exact:true}).selectOption('region')
  await page.getByLabel('Combination',{exact:true}).selectOption('join');await page.getByLabel('Match behavior',{exact:true}).selectOption('inner')
  await page.getByRole('button',{name:'Combine permitted subjects',exact:true}).click();await page.getByRole('heading',{name:'Combined subjects',exact:true}).waitFor()
  await page.getByRole('table',{name:'Combined summary',exact:true}).waitFor();await proveScreen('composition-joined-summary')
  await page.getByRole('button',{name:'Combined underlying rows',exact:true}).click();await page.getByRole('table',{name:'Combined underlying rows',exact:true}).waitFor();await proveScreen('composition-exact-underlying')
  await page.getByRole('button',{name:'Next combined page',exact:true}).click();await page.getByRole('table',{name:'Combined underlying rows',exact:true}).getByRole('row').filter({has:page.getByText('r2',{exact:true})}).waitFor();await proveScreen('composition-last-underlying-page')
  await page.getByText('Export combined question',{exact:true}).click();await page.getByRole('button',{name:'Export combined CSV',exact:true}).click()
  await page.locator('#composition-status').filter({hasText:'exceeds the interactive limit'}).waitFor();await proveScreen('composition-complete-export-offer')
  const nextPart=page.getByRole('button',{name:'Download next combined export part',exact:true})
  for(let part=1;part<=4;part++){const download=page.waitForEvent('download');await nextPart.click();assert.equal((await download).suggestedFilename(),'bifocal-combined-underlying-part-'+part+'.csv');await page.locator('#composition-full-export-note').filter({hasText:Math.min(part*10,31)+' of 31 rows downloaded.'}).waitFor()}
  await page.locator('#composition-status').filter({hasText:'Complete combined export: every part downloaded.'}).waitFor();assert.equal(await nextPart.isDisabled(),true);await proveScreen('composition-complete-export-finished')
  }
 }finally{await setCaps(policy.csv,policy.xlsx)}
 // Current source and model fences protect all retained composition surfaces.
 const sourcePlan=await api(path+'/export-plan',{scope:'underlying',format:'csv'})
 await upload(rightDataset,rightCSV.replace('$7.00','$8.00'),true)
 await api(path,undefined,409);await api(path+'/page',{scope:'underlying',offset:0},409);await api(path+'/export',{scope:'summary',format:'csv'},409)
 await api(path+'/full-export',{scope:'underlying',format:'csv',offset:0,planDigest:sourcePlan.planDigest},409)
 const refreshed=await api('/explore/compositions/run',input,201),next=await api('/models/'+right.modelId+'/branches',{definition:definition(rightDataset)})
 await publish('/models/'+right.modelId+'/branches/'+next.branchId)
 await api('/explore/compositions/'+refreshed.id,undefined,409)
 const source=await api('/datasets/'+leftDataset);await api('/datasets/'+leftDataset+'/erase',{confirmDataset:leftDataset,reviewedRevision:source.revision})
 await api(path,undefined,404);await api('/explore/compositions/'+appended.id,undefined,404)
 console.log('Ad hoc compositions: exact inner, left and full joins and tagged append, recomputed distinct counts and ratios, complete named export parts, stale cap refusal and current source, model and erasure fences passed at 1440 and 390')
}
