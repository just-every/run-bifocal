import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Finite recurrence and environment binding through real native tools. */
export async function proveRecurringTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf}) {
 const dataset='synthetic-bifocal-recurring-source',calendar='synthetic-bifocal-recurring-calendar'
 const csv='invoice,region,revenue\n1,West,$10.00\n2,East,$20.00\n'
 await upload(dataset,csv)
 await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Recurring calendar',kind:'fiscal',startMonth:1}})
 const query={version:1,dataset,joins:[],filters:[],groupBy:[],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'}],semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'number'},{column:'region',type:'text'},{column:'revenue',type:'money'}],hierarchies:[],slowlyChanging:'reject-duplicate-grain'},context:{modelVersion:'recurring-native-v1',metricVersion:'recurring-native-v1',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const modelDefinition={views:[{id:'revenue',kind:'report',query,rowRules:[{column:'region',op:'eq',value:'West'}]}],quality:[]}
 const modelFile=join(directory,'recurring-model.native.json'),modelPlan=join(directory,'recurring-model.plan.json')
 await writeFile(modelFile,JSON.stringify(modelDefinition))
 const modelReview=await cli('plan',['--file',modelFile,'--plan-file',modelPlan]),model=await cli('apply',['--plan-file',modelPlan,'--approve',modelReview.digest])
 const modelFlags=['--model',model.modelId,'--branch',model.branchId],publication=await cli('validate',modelFlags)
 await cli('approve',[...modelFlags,'--digest',publication.digest])
 await cli('promote',[...modelFlags,'--digest',publication.digest,'--environment','staging'])
 await cli('promote',[...modelFlags,'--digest',publication.digest,'--environment','production'])
 const development=await cli('branch',['--model',model.modelId,'--file',modelFile])
 const target=environment=>({modelId:model.modelId,viewId:'revenue',environment,...environment==='development'?{branchId:development.branchId}:{}})
 const base={name:'Daily development recurrence',startDate:'2026-03-07',endDate:'2026-03-09',time:'02:30',timezone:'America/New_York',reportCutoff:'04:00',skipped:'shift-forward',repeated:'both',recurrence:{frequency:'daily',interval:1},target:target('development')}
 let document={version:2,id:'synthetic-bifocal-daily-recurring',definition:base}
 const sourceBefore=await call('/datasets/'+dataset),modelBefore=await call('/models/'+model.modelId),grantsBefore=await call('/explore/access'),queriesBefore=await call('/queries')
 const file=join(directory,'recurring.native.json'),exported=join(directory,'recurring-export.native.json')
 let sequence=0
 const reviewDocument=async(value)=>{
  await writeFile(file,JSON.stringify(value))
  const plan=join(directory,'recurring-review-'+sequence+++'.json'),review=await cli('schedule-plan',['--file',file,'--plan-file',plan])
  return {plan,review}
 }
 const created=await reviewDocument(document)
 assert.equal(created.review.preview.totals.revenue.value,'10.00','Schedule previews inherit the model West row rule')
 assert.equal(created.review.binding.environment,'development');assert.equal(created.review.binding.revision,development.revision)
 assert.deepEqual(created.review.resolution.occurrences.map(occurrence=>occurrence.instants.map(instant=>instant.instant)),[['2026-03-07T07:30:00.000Z'],['2026-03-08T07:30:00.000Z'],['2026-03-09T06:30:00.000Z']])
 assert.equal(created.review.resolution.occurrences[1].status,'shifted');assert.equal(created.review.resolution.occurrences[1].shiftSeconds,3600)
 assert.equal(created.review.resolution.occurrences[1].instants[0].localTime,'03:30:00')
 assert.equal(created.review.active,false);assert.equal(created.review.productionSends,0);assert.equal(created.review.sourceWrites,0)
 const daily=await cli('schedule-apply',['--plan-file',created.plan,'--approve',created.review.digest])
 assert.equal(daily.definition.dispatcher,'unavailable');assert.equal(daily.definition.binding.digest,created.review.digest)
 await cli('schedule-export',['--schedule',document.id,'--output',exported])
 assert.deepEqual(JSON.parse(await readFile(exported,'utf8')),created.review.document)
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/schedules/'+document.id)
  await page.getByRole('heading',{name:base.name,exact:true}).waitFor()
  assert.match(await page.getByRole('status').innerText(),/does not activate/)
  assert.match(await page.getByRole('table',{name:'Resolved civil-time occurrences'}).innerText(),/2026-03-08T07:30:00.000Z/)
  assert.match(await page.locator('main').innerText(),new RegExp(development.revision))
  await proveScreen('recurring-schedule-definition')
 }
 const weekly={version:2,id:'synthetic-bifocal-weekly-recurring',definition:{...base,name:'Weekly staging recurrence',startDate:'2026-10-25',endDate:'2026-11-08',time:'01:30',recurrence:{frequency:'weekly',interval:1,weekdays:[0]},target:target('staging')}}
 const weeklyReview=await reviewDocument(weekly)
 assert.equal(weeklyReview.review.binding.environment,'staging');assert.equal(weeklyReview.review.binding.revision,model.revision)
 assert.deepEqual(weeklyReview.review.resolution.occurrences.map(occurrence=>occurrence.instants.map(instant=>instant.instant)),[['2026-10-25T05:30:00.000Z'],['2026-11-01T05:30:00.000Z','2026-11-01T06:30:00.000Z'],['2026-11-08T06:30:00.000Z']])
 await cli('schedule-apply',['--plan-file',weeklyReview.plan,'--approve',weeklyReview.review.digest])
 const monthly={version:2,id:'synthetic-bifocal-monthly-recurring',definition:{...base,name:'Monthly production recurrence',startDate:'2026-01-08',endDate:'2026-05-08',recurrence:{frequency:'monthly',interval:2,day:8,missingDay:'skip'},target:target('production')}}
 const monthlyReview=await reviewDocument(monthly)
 assert.equal(monthlyReview.review.binding.environment,'production')
 assert.deepEqual(monthlyReview.review.resolution.occurrences.map(occurrence=>occurrence.localDate),['2026-01-08','2026-03-08','2026-05-08'])
 assert.deepEqual(monthlyReview.review.resolution.occurrences.map(occurrence=>occurrence.instants[0].instant),['2026-01-08T07:30:00.000Z','2026-03-08T07:30:00.000Z','2026-05-08T06:30:00.000Z'])
 await cli('schedule-apply',['--plan-file',monthlyReview.plan,'--approve',monthlyReview.review.digest])
 const reviewHTTP=async(value,previousVersion=null)=>{
  const response=await context.request.post(origin+'/api/operator/schedule-definitions/review',{headers:{Origin:origin},data:{document:value,previousVersion}})
  assert.equal(response.status(),200,await response.text());return response.json()
 }
 const monthEnd={...monthly,id:'synthetic-bifocal-month-end',definition:{...monthly.definition,startDate:'2026-01-31',endDate:'2026-05-31',recurrence:{frequency:'monthly',interval:1,day:31,missingDay:'skip'}}}
 assert.deepEqual((await reviewHTTP(monthEnd)).resolution.occurrences.map(occurrence=>occurrence.localDate),['2026-01-31','2026-03-31','2026-05-31'])
 monthEnd.definition.recurrence.missingDay='last-day'
 assert.deepEqual((await reviewHTTP(monthEnd)).resolution.occurrences.map(occurrence=>occurrence.localDate),['2026-01-31','2026-02-28','2026-03-31','2026-04-30','2026-05-31'])
 const invalid={...monthly,definition:{...monthly.definition,endDate:'2028-01-08'}}
 const invalidResponse=await context.request.post(origin+'/api/operator/schedule-definitions/review',{headers:{Origin:origin},data:{document:invalid,previousVersion:null}})
 assert.equal(invalidResponse.status(),422,'Recurring definitions require a bounded declared horizon')
 assert.equal((await fetch(origin+'/api/operator/schedule-definitions/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({document:monthly,previousVersion:null})})).status,401)
 assert.equal((await context.request.post(origin+'/api/operator/schedule-definitions/review',{headers:{Origin:'https://foreign.example.test'},data:{document:monthly,previousVersion:1}})).status(),401)
 assert.deepEqual(await call('/datasets/'+dataset),sourceBefore);assert.deepEqual(await call('/models/'+model.modelId),modelBefore)
 assert.deepEqual(await call('/explore/access'),grantsBefore);assert.deepEqual(await call('/queries'),queriesBefore,'Review and apply do not create query jobs or retained answers')
 const branchBoundReview=await reviewDocument(document),branchPlan=join(directory,'recurring-branch-edit.plan.json')
 const branchEdit=await cli('plan',['--model',model.modelId,'--branch',development.branchId,'--file',modelFile,'--plan-file',branchPlan])
 await cli('apply',['--plan-file',branchPlan,'--approve',branchEdit.digest])
 const beforeBranchDrift=await call('/schedules/'+document.id)
 await cli('schedule-apply',['--plan-file',branchBoundReview.plan,'--approve',branchBoundReview.review.digest],false)
 assert.deepEqual(await call('/schedules/'+document.id),beforeBranchDrift,'An exact branch revision change invalidates the old schedule review')
 const terraform=async(args,ok=true)=>tfRun([args[0],'-state=recurring.tfstate',...args.slice(1)],ok)
 const writeConfig=async(digest)=>writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_schedule_definition:{main:{document:JSON.stringify(document),...(digest?{review_digest:digest}:{})}}}}))
 document=created.review.document
 await writeConfig()
 await terraform(['import','-input=false','-no-color','bifocal_schedule_definition.main',document.id])
 await terraform(['plan','-input=false','-no-color','-detailed-exitcode'])
 document={...document,definition:{...document.definition,name:'Daily production recurrence',recurrence:{frequency:'daily',interval:2},target:target('production')}}
 let reviewed=await reviewDocument(document);await writeConfig(reviewed.review.digest)
 await terraform(['plan','-input=false','-no-color','-out=recurring-stale.tfplan'])
 const concurrent={...document,definition:{...document.definition,name:'Concurrent staging recurrence',target:target('staging')}},concurrentReview=await reviewDocument(concurrent)
 await cli('schedule-apply',['--plan-file',concurrentReview.plan,'--approve',concurrentReview.review.digest])
 const savedConcurrent=await call('/schedules/'+document.id+'/2')
 await terraform(['apply','-input=false','-no-color','recurring-stale.tfplan'],false)
 assert.deepEqual(await call('/schedules/'+document.id+'/2'),savedConcurrent)
 reviewed=await reviewDocument(document);await writeConfig(reviewed.review.digest)
 await terraform(['plan','-input=false','-no-color','-out=recurring-current.tfplan'])
 await terraform(['apply','-input=false','-no-color','recurring-current.tfplan'])
 const updated=await call('/schedules/'+document.id+'/3')
 assert.equal(updated.definition.binding.environment,'production');assert.equal(updated.definition.dispatcher,'unavailable')
 assert.deepEqual(updated.definition.resolution.occurrences.map(occurrence=>occurrence.localDate),['2026-03-07','2026-03-09'])
 document={...document,definition:{...document.definition,name:'Review against current source'}}
 reviewed=await reviewDocument(document);await writeConfig(reviewed.review.digest)
 await terraform(['plan','-input=false','-no-color','-out=recurring-source-stale.tfplan'])
 await upload(dataset,csv.replace('$10.00','$11.00'),true)
 const beforeDriftApply=await call('/schedules/'+document.id),changedSource=await call('/datasets/'+dataset)
 await terraform(['apply','-input=false','-no-color','recurring-source-stale.tfplan'],false)
 assert.deepEqual(await call('/schedules/'+document.id),beforeDriftApply)
 assert.deepEqual(await call('/datasets/'+dataset),changedSource)
 // Release tracking after aligning configuration; immutable definitions remain.
 document=updated.definition.document;await writeConfig()
 await terraform(['destroy','-auto-approve','-input=false','-no-color'])
 assert.deepEqual(await call('/schedules/'+document.id+'/1'),{id:daily.id,version:daily.version,definition:daily.definition,createdAt:daily.createdAt,createdBy:daily.createdBy})
 document={...document,id:'synthetic-bifocal-terraform-recurring'}
 reviewed=await reviewDocument(document);await writeConfig(reviewed.review.digest)
 await terraform(['plan','-input=false','-no-color','-out=recurring-create.tfplan'])
 await terraform(['apply','-input=false','-no-color','recurring-create.tfplan'])
 const tfCreated=await call('/schedules/'+document.id+'/1')
 assert.equal(tfCreated.definition.binding.environment,'production');assert.equal(tfCreated.definition.dispatcher,'unavailable')
 const stateText=await readFile(join(directory,'recurring.tfstate'),'utf8')
 assert.ok(!stateText.includes('sourceWatermarks'));assert.ok(!stateText.includes('securityScope'));assert.ok(!stateText.includes('answer_json'))
 await terraform(['destroy','-auto-approve','-input=false','-no-color'])
 assert.deepEqual(await call('/schedules/'+document.id+'/1'),tfCreated)
 const restore=await reviewDocument(JSON.parse(await readFile(exported,'utf8')))
 await cli('schedule-apply',['--plan-file',restore.plan,'--approve',restore.review.digest])
 await cli('schedule-apply',['--plan-file',restore.plan,'--approve',restore.review.digest],false)
 assert.equal((await call('/schedules/'+daily.id+'/4')).definition.document.definition.target.environment,'development')
 assert.deepEqual(await call('/explore/access'),grantsBefore)
 console.log('Recurring native tools: finite daily, weekly and monthly IANA DST resolution, inherited row rules, environment binding, real CLI and Terraform create, import and update, stale atomic refusal and retained inactive history passed')
}
