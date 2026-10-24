import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
export async function proveScorecards({call,today,proveScreen,page,origin}) {
 const year=today.slice(0,4),month=Number(today.slice(5,7)),quarter=Math.floor((month-1)/3)*3+1
 const from=`${year}-${String(quarter).padStart(2,'0')}-01`,to=quarter===10?`${Number(year)+1}-01-01`:`${year}-${String(quarter+3).padStart(2,'0')}-01`
 const definition={id:'synthetic-bifocal-revenue-goal',metricId:'synthetic-bifocal-revenue',title:'Quarterly USD revenue',from,to,dateColumn:'date',target:'1000.00',currency:'USD',maxAgeSeconds:86400}
 await page.setViewportSize({width:390,height:1000});await page.goto(origin+'/app/goals')
 for(const [label,value] of [['Goal ID',definition.id],['Certified metric ID',definition.metricId],['Title',definition.title],['Period start',from],['Period end (exclusive)',to],['Actuals date column','date'],['Target (USD, two decimal places)','1000.00']])await page.getByLabel(label,{exact:true}).fill(value)
 const [created]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/operator/goals')&&r.request().method()==='POST'),page.getByRole('button',{name:'Save goal',exact:true}).click()]);assert.equal(created.status(),303);await page.waitForURL(origin+'/app/goals/'+definition.id)
 let goal=await call('/goals/'+definition.id)
 assert.equal(goal.actual.state,'value');assert.equal(goal.actual.value.value,'30.00');assert.equal(goal.actual.metric.revision,1);assert.equal(goal.actual.forecast.kind,'linear pace, not a financial forecast');assert.equal(goal.easel.state,'unresolved')
 const source=await call('/queries/run',goal.actual.query);assert.deepEqual(goal.actual.value,source.answer.totals.revenue)
 await page.getByLabel('Observation date',{exact:true}).fill(today);await page.getByLabel('Observation',{exact:true}).fill('Owner observation, without changing actuals')
 const [noted]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/checkins')&&r.request().method()==='POST'),page.getByRole('button',{name:'Add check-in',exact:true}).click()]);assert.equal(noted.status(),303)
 goal=await call('/goals/'+definition.id);assert.equal(goal.checkins.length,1);assert.equal(goal.actual.value.value,'30.00')
 const {id,metricId,...changed}=definition
 await call('/goals/'+id+'/revise',{...changed,previousVersion:1,from:year+'-01-01',to:(Number(year)+1)+'-01-01',target:'1200.00'})
 await call('/goals/'+id+'/revise',{...changed,previousVersion:1,from:year+'-01-01',to:(Number(year)+1)+'-01-01',target:'1200.00'},409)
 goal=await call('/goals/'+id);assert.equal(goal.versions.length,2);assert.equal(goal.definition.target,'1200.00');assert.equal(goal.versions[1].definition.target,'1000.00')
 await proveScreen('/app/goals','goals');await proveScreen('/app/goals/'+id,'goal-checkins')
 console.log('Scorecards: certified source-query parity, exact USD target versions, dated attributed observations, stale revision refusal and phone workflow passed; Easel remains unresolved')
}

export async function proveEaselTargets({call,today,proveScreen,page,origin}) {
 const year=today.slice(0,4),from=year+'-01-01',to=(Number(year)+1)+'-01-01',id='synthetic-bifocal-revenue-goal',dataset='synthetic-bifocal-easel'
 const link='https://easel.example.com/api/easel/dataset/synthetic-bifocal-plan'
 // Original dataset CSV schema: run-easel src/easel/dataset.ts at
 // 277548b08ec1a0ebf588db971b099df865405f84. Values are integer minor units.
 const csv=(series,amount,duplicate=false)=>'row_id,row_name,month,series,amount_minor,currency\r\n'+Array.from({length:12},(_,i)=>`revenue,Revenue,${year}-${String(i+1).padStart(2,'0')},${series},${amount},USD\r\n`).join('')+(duplicate?`revenue,Revenue,${year}-01,${series},${amount},USD\r\n`:'')
 async function upload(data) {
  await page.goto(origin+'/app/import')
  await page.getByLabel('Dataset id',{exact:true}).fill(dataset)
  await page.getByLabel('CSV or XLSX file',{exact:true}).setInputFiles({name:'synthetic-bifocal-easel.csv',mimeType:'',buffer:Buffer.from(data)})
  await page.getByText('Source links for this file',{exact:true}).click()
  await page.getByLabel('Source kind',{exact:true}).selectOption('easel-export')
  await page.getByLabel('Source record or report URL').fill(link)
  await page.getByLabel('Source description',{exact:true}).fill('Easel saved plan dataset, original CSV')
  await page.getByLabel('Window start',{exact:true}).fill(from);await page.getByLabel('Window end (exclusive)',{exact:true}).fill(to)
  await page.getByRole('button',{name:'Preview import',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Plan ready'}).waitFor()
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/easel-file-review-${width}.png`,fullPage:true})}
  await page.getByLabel('I reviewed this exact plan and its fingerprint',{exact:true}).check()
  await page.getByRole('button',{name:'Apply import',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Import completed and reconciled'}).waitFor()
  const source=await call('/datasets/'+dataset)
  assert.equal(source.table.source.sha256,createHash('sha256').update(data).digest('hex'))
  return source
 }
 const def={title:'Quarterly USD revenue',from,to,dateColumn:'date',currency:'USD',maxAgeSeconds:86400}
 const one=await upload(csv('Budget revision 1',10000))
 const input=(source,series,target,previousVersion)=>({...def,previousVersion,target,easelDataset:dataset,easelRevision:source.revision,easelRow:'revenue',easelSeries:series})
 async function importTarget(source,series,target) {
  await page.goto(origin+'/app/goals/'+id)
  await page.getByLabel('Target (USD, two decimal places)',{exact:true}).fill(target)
  const summary=page.getByText('Use an Easel target export',{exact:true});await summary.focus();await page.keyboard.press('Enter')
  for(const [label,value] of [['Easel dataset ID',dataset],['Reviewed dataset revision',source.revision],['Easel row ID','revenue'],['Easel plan series',series]])await page.getByLabel(label,{exact:true}).fill(value)
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/revise')&&r.request().method()==='POST'),page.getByRole('button',{name:'Save target revision',exact:true}).click()])
  assert.equal(response.status(),303,await response.text());await page.waitForURL(origin+'/app/goals/'+id)
  const goal=await call('/goals/'+id)
  assert.equal(goal.definition.target,target);assert.equal(goal.easel.series,series);assert.equal(goal.easel.link,link);assert.equal(goal.easel.exportSha256,source.table.source.sha256)
  const actual=await call('/queries/run',goal.actual.query);assert.deepEqual(goal.actual.value,actual.answer.totals.revenue)
  return goal
 }
 await importTarget(one,'Budget revision 1','1200.00')
 const two=await upload(csv('Budget revision 2',11000))
 await call('/goals/'+id+'/revise',input(one,'Budget revision 1','1200.00',3),409)
 await call('/goals/'+id+'/revise',input(two,'Budget revision 2','1320.01',3),409)
 await call('/goals/'+id+'/revise',input(two,'Actual','1320.00',3),400)
 const revised=await importTarget(two,'Budget revision 2','1320.00')
 assert.equal(revised.versions.length,4);assert.equal(revised.versions[1].definition.easel.series,'Budget revision 1');assert.notEqual(revised.versions[0].definition.easel.exportSha256,revised.versions[1].definition.easel.exportSha256);assert.equal(revised.checkins.length,1)
 const invalid=await upload(csv('Budget revision 3',12000,true))
 await call('/goals/'+id+'/revise',input(invalid,'Budget revision 3','1440.00',4),409)
 assert.equal((await call('/goals/'+id)).goal.version,4)
 await proveScreen('/app/goals','goals-easel');await proveScreen('/app/goals/'+id,'goal-easel-revised')
 console.log('Easel targets: original reviewed CSV, exact month and USD sums, source series and export digest, stale and duplicate refusals, revised target and live actual parity passed')
 return dataset
}
