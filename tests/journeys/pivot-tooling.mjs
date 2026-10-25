import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

/** Complete authorized pivot domain, whole-group paging and identical exports. */
export async function provePivotTooling({origin,context,page,call,upload,proveScreen}) {
 const dataset='synthetic-bifocal-pivot-source',calendar='synthetic-bifocal-pivot-calendar'
 const records=[]
 for(let store=1;store<=31;store++)for(let period=0;period<3;period++)records.push({invoice:'pivot-'+store+'-'+period,store:'Store '+String(store).padStart(2,'0'),period:['A','B','C'][period],cents:store*100+period,won:1,total:[2,4,8][period],score:[10,20,30][period],weight:[1,2,4][period],customer:'customer-'+store%5})
 records.push({invoice:'pivot-last',store:'Store 31',period:'Z-final',cents:3103,won:1,total:16,score:40,weight:8,customer:'customer-1'})
 const hidden={invoice:'pivot-hidden',store:'Hidden',period:'Secret-domain',cents:999999,won:1,total:1,score:999,weight:999,customer:'secret-customer'}
 await upload(dataset,'invoice,store,period,amount,won,total,score,weight,customer\n'+[...records,hidden].map(record=>[record.invoice,record.store,record.period,'$'+(record.cents/100).toFixed(2),record.won,record.total,record.score,record.weight,record.customer].join(',')).join('\n')+'\n')
 await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Pivot calendar',kind:'fiscal',startMonth:1}})
 const source=await call('/datasets/'+dataset)
 const query={version:1,dataset,joins:[],filters:[],groupBy:['store','period'],measures:[{id:'sales',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD'},{id:'win-rate',op:'ratio',numerator:'won',denominator:'total',unit:'percent',scale:4},{id:'customers',op:'count-distinct',column:'customer',unit:'count',scale:0},{id:'weighted-score',op:'weighted-average',column:'score',weight:'weight',unit:'number',scale:4}],semantic:{grain:['invoice'],dimensions:source.table.columns.map(column=>({column:column.name,type:column.type})),hierarchies:[],slowlyChanging:'reject-duplicate-grain'},context:{modelVersion:'pivot-v1',metricVersion:'pivot-v1',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const model=await call('/models',{definition:{views:[{id:'pivot',kind:'chart',query,rowRules:[{column:'store',op:'ne',value:'Hidden'}]}],quality:[]}})
 const branch='/models/'+model.modelId+'/branches/'+model.branchId,review=await call(branch+'/validate',{},200)
 await call(branch+'/approve',{digest:review.digest},200);await call(branch+'/promote',{environment:'staging',digest:review.digest},200);await call(branch+'/promote',{environment:'production',digest:review.digest},200)
 const parameters={modelId:model.modelId,revision:model.revision,viewId:'pivot',groupBy:['store','period'],pivot:'period',filters:[]}
 const snapshot=await call('/explore/run',parameters),base=origin+'/api/operator/explore/'+snapshot.snapshotId
 assert.equal(snapshot.context.exploration.parameters.pivot,'period')
 const rows=[],pages=[];let offset=0
 do {
  const result=await call('/explore/'+snapshot.snapshotId+'/page',{scope:'summary',offset},200)
  assert.equal(result.layout,'pivot');assert.equal(result.totalRows,31)
  assert.deepEqual(result.pivot.domain,['A','B','C','Z-final'],'Headers include the final domain value before the last group is paged')
  if(pages.length)assert.deepEqual(result.columns,pages[0].columns)
  rows.push(...result.rows);pages.push(result);offset=result.nextOffset
 }while(offset!==null)
 assert.deepEqual(pages.map(result=>result.rows.length),[25,6]);assert.equal(new Set(rows.map(row=>row[0])).size,31)
 const columns=pages[0].columns
 assert.equal(columns[0].type,'text');assert.ok(columns.filter(column=>column.measure==='sales').every(column=>column.type==='money'&&column.unit==='money'&&column.currency==='USD'))
 for(const row of rows)for(let index=1;index<columns.length;index++) {
  const column=columns[index],selected=records.filter(record=>record.store===row[0]&&record.period===column.pivotValue),record=selected[0]
  const expected=!record?null:column.measure==='sales'?(record.cents/100).toFixed(2):column.measure==='win-rate'?(record.won/record.total*100).toFixed(4):column.measure==='customers'?'1':record.score.toFixed(4)
  assert.equal(row[index],expected)
 }
 const expectedRate=(records.reduce((sum,record)=>sum+record.won,0)/records.reduce((sum,record)=>sum+record.total,0)*100).toFixed(4)
 const expectedWeighted=(records.reduce((sum,record)=>sum+record.score*record.weight,0)/records.reduce((sum,record)=>sum+record.weight,0)).toFixed(4)
 for(const result of pages) {
  assert.equal(result.totals['win-rate'].value,expectedRate);assert.equal(result.totals['weighted-score'].value,expectedWeighted);assert.equal(result.totals.customers.value,'5')
  assert.deepEqual(result.totals,snapshot.answer.totals,'Grand totals retain the exact original aggregate metadata')
 }
 assert.ok(!JSON.stringify(pages).includes('Secret-domain'))
 for(const format of ['csv','xlsx']) {
  const response=await context.request.post(base+'/export',{headers:{Origin:origin},data:{scope:'summary',format}})
  assert.equal(response.status(),200,await response.text());assert.equal(Number(response.headers()['x-bifocal-row-count']),rows.length)
  if(format==='csv') {
   const parsed=JSON.parse(execFileSync('python3',['-c','import csv,io,json,sys; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read())))))'],{input:await response.text(),encoding:'utf8'}))
   assert.deepEqual(parsed[0],columns.map(column=>column.name));assert.deepEqual(parsed.slice(1),rows.map(row=>row.map(value=>value===null?'':String(value))))
  }else {
   const xml=strFromU8(unzipSync(new Uint8Array(await response.body()))['xl/worksheets/sheet1.xml']),document=new DOMParser().parseFromString(xml,'application/xml'),sheetRows=Array.from(document.getElementsByTagName('row'))
   const values=row=>Array.from(row.getElementsByTagName('c')).map(cell=>cell.getElementsByTagName('t')[0]?.textContent??cell.getElementsByTagName('v')[0]?.textContent??null)
   assert.deepEqual(values(sheetRows[0]),columns.map(column=>column.name));assert.deepEqual(sheetRows.slice(1).map(values),rows)
   for(const row of sheetRows.slice(1))for(const cell of Array.from(row.getElementsByTagName('c')).slice(1))if(cell.getElementsByTagName('v').length)assert.equal(cell.getAttribute('t'),'n')
   assert.equal(document.getElementsByTagName('f').length,0)
  }
 }
 const underlying=await call('/explore/'+snapshot.snapshotId+'/page',{scope:'underlying',offset:0},200)
 assert.deepEqual(underlying.columns.map(column=>column.name),query.semantic.dimensions.map(dimension=>dimension.column),'Underlying scope keeps original authorized typed records')
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/questions/'+snapshot.snapshotId)
  await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor()
  assert.equal(await page.getByLabel('Pivot columns').inputValue(),'period')
  assert.equal(await page.getByRole('region',{name:'Pivot of summarized rows',exact:true}).count(),1)
  const table=page.getByRole('table',{name:'Pivot results',exact:true})
  assert.deepEqual((await table.locator('thead th').allTextContents()).slice(0,columns.length),columns.map(column=>column.name))
  assert.equal(await table.locator('tbody tr').count(),25);assert.match(await page.locator('#totals').innerText(),new RegExp(expectedRate.replace('.','\\.')))
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page-note').textContent.includes('26–31'))
  assert.equal(await table.locator('tbody tr').count(),6);assert.deepEqual((await table.locator('thead th').allTextContents()).slice(0,columns.length),columns.map(column=>column.name))
  await proveScreen('complete-pivot-last-page')
  await page.getByRole('button',{name:'Previous page',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page-note').textContent.includes('1–25'))
  await page.getByLabel('Pivot columns').selectOption('');await page.getByRole('button',{name:'Run and save question'}).click();await page.getByRole('status').filter({hasText:'Question saved'}).waitFor()
  assert.equal(await page.getByRole('region',{name:'Pivot of summarized rows',exact:true}).count(),0)
  await page.getByLabel('Pivot columns').selectOption('period');await page.getByRole('button',{name:'Run and save question'}).click();await page.getByRole('status').filter({hasText:'Question saved'}).waitFor()
  assert.equal(await page.getByRole('region',{name:'Pivot of summarized rows',exact:true}).isVisible(),true)
  await proveScreen('complete-pivot-authoring')
 }
 // A legitimate narrow, tall source can produce a workbook wider than XLSX.
 // Refuse that representation explicitly; CSV still carries the complete row.
 const wideDataset='synthetic-bifocal-pivot-wide'
 await upload(wideDataset,'invoice,period\n'+Array.from({length:1366},(_,index)=>'wide-'+index+',P'+String(index).padStart(4,'0')).join('\n')+'\n')
 const wideSource=await call('/datasets/'+wideDataset),wideQuery={...query,dataset:wideDataset,groupBy:['period'],measures:Array.from({length:12},(_,index)=>({id:'c'+index,op:'count',unit:'count',scale:0})),semantic:{grain:['invoice'],dimensions:wideSource.table.columns.map(column=>({column:column.name,type:column.type})),hierarchies:[],slowlyChanging:'reject-duplicate-grain'}}
 const wideModel=await call('/models',{definition:{views:[{id:'wide',kind:'chart',query:wideQuery,rowRules:[]}],quality:[]}}),wideBranch='/models/'+wideModel.modelId+'/branches/'+wideModel.branchId,wideReview=await call(wideBranch+'/validate',{},200)
 await call(wideBranch+'/approve',{digest:wideReview.digest},200);await call(wideBranch+'/promote',{environment:'staging',digest:wideReview.digest},200);await call(wideBranch+'/promote',{environment:'production',digest:wideReview.digest},200)
 const wide=await call('/explore/run',{modelId:wideModel.modelId,revision:wideModel.revision,viewId:'wide',groupBy:['period'],pivot:'period',filters:[]})
 const workbook=await context.request.post(origin+'/api/operator/explore/'+wide.snapshotId+'/export',{headers:{Origin:origin},data:{scope:'summary',format:'xlsx'}})
 assert.equal(workbook.status(),422);assert.equal((await workbook.json()).error,'xlsx_column_limit')
 const wideCSV=await context.request.post(origin+'/api/operator/explore/'+wide.snapshotId+'/export',{headers:{Origin:origin},data:{scope:'summary',format:'csv'}})
 assert.equal(wideCSV.status(),200);assert.equal(Number(wideCSV.headers()['x-bifocal-row-count']),1)
 assert.equal((await wideCSV.text()).trimEnd().split('\r\n').length,2)
 console.log('Complete native pivot: stable authorized column domain, whole-group paging, original nonadditive totals, identical CSV and typed XLSX, saved authoring and native workbook width refusal passed')
}
