import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Current native resources move as one reviewed environment estate. */
export async function proveEnvironmentTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf}){
 const dataset='synthetic-bifocal-estate-source',csv='invoice,region,revenue\n1,West,$10.01\n2,East,$20.02\n'
 await upload(dataset,csv)
 const base=JSON.parse(await readFile(join(directory,'metric-export.native.json'),'utf8')).definition.query
 const query={...base,dataset,filters:[],groupBy:[]};delete query.fiscal;delete query.semantic
 const definition={views:[{id:'revenue',kind:'report',query,rowRules:[]}],quality:[]},model=await call('/models',{definition}),flags=['--model',model.modelId,'--branch',model.branchId]
 const nativeQualityScreen=async(branchId,state,label)=>{
  await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor()
  await page.getByRole('button',{name:'Open model '+model.modelId.slice(0,8)+' · revision 1 · branch '+branchId.slice(0,8),exact:true}).click()
  await page.getByRole('status').filter({hasText:'Saved revision loaded'}).waitFor();await page.getByRole('button',{name:'Review publication',exact:true}).click()
  await page.getByRole('status').filter({hasText:state==='healthy'?'Publication review complete':'Publication refused'}).waitFor()
  assert.match(await page.locator('#publication-quality').innerText(),new RegExp('Current quality: '+state));await proveScreen(label)
 }
 const unconfigured=await cli('validate',flags);assert.equal(unconfigured.compatible,true);assert.equal(unconfigured.qualityImpact.state,'unknown');assert.equal(unconfigured.qualityImpact.blocking,false)
 await cli('approve',[...flags,'--digest',unconfigured.digest])
 const qualityRule='synthetic-bifocal-estate-invoice'
 await call('/quality/rules',{id:qualityRule,dataset,definition:{name:'Estate invoice identity',kind:'unique',column:'invoice'}})
 const nativeBefore=await call('/models/'+model.modelId)
 await cli('promote',[...flags,'--digest',unconfigured.digest,'--environment','staging'],false)
 assert.deepEqual(await call('/models/'+model.modelId),nativeBefore,'A newly configured unchecked rule cannot mutate native promotion state')
 const unchecked=await cli('validate',flags,'incompatible');assert.equal(unchecked.compatible,false);assert.equal(unchecked.qualityImpact.state,'unknown');assert.equal(unchecked.qualityImpact.blocking,true)
 assert.equal(unchecked.qualityImpact.tests.find(test=>test.ruleId===qualityRule).state,'unknown')
 await cli('approve',[...flags,'--digest',unchecked.digest],false)
 await nativeQualityScreen(model.branchId,'unknown','model-quality-unknown-refusal')
 const runQuality=()=>call('/quality/rules/'+qualityRule+'/run',{})
 assert.equal((await runQuality()).result.state,'passed')
 let initial=await cli('validate',flags);assert.equal(initial.qualityImpact.state,'healthy');await cli('approve',[...flags,'--digest',initial.digest]);await cli('promote',[...flags,'--digest',initial.digest,'--environment','staging'])
 const reviewedModel=await call('/models/'+model.modelId),previousRun=initial.qualityImpact.tests.find(test=>test.ruleId===qualityRule).runId
 const rerun=await runQuality();assert.notEqual(rerun.id,previousRun)
 await cli('promote',[...flags,'--digest',initial.digest,'--environment','production'],false)
 assert.deepEqual(await call('/models/'+model.modelId),reviewedModel,'New passing evidence also requires an exact current review before production')
 initial=await cli('validate',flags);await cli('approve',[...flags,'--digest',initial.digest])
 const armQualityBoundary=async(at,before)=>{
  const cookie=(await context.cookies()).map(item=>item.name+'='+item.value).join('; ')
  const armed=await context.request.post(origin+'/__machine-boundary',{data:{at,before,path:'/api/operator/quality/rules/'+qualityRule+'/run',cookie,body:{},expectedStatus:201}})
  assert.equal(armed.status(),200)
 }
 const beforeBoundary=await call('/models/'+model.modelId)
 await armQualityBoundary('/api/operator/models/'+model.modelId+'/branches/'+model.branchId+'/promote','UPDATE bf_semantic_models SET production=')
 await call('/models/'+model.modelId+'/branches/'+model.branchId+'/promote',{digest:initial.digest,environment:'production'},409)
 assert.deepEqual(await call('/models/'+model.modelId),beforeBoundary,'Changed evidence inside the native promotion transaction leaves every model pointer and history unchanged')
 initial=await cli('validate',flags);await cli('approve',[...flags,'--digest',initial.digest]);await cli('promote',[...flags,'--digest',initial.digest,'--environment','production'])
 const scalar={...query,context:{...query.context,modelVersion:model.revision}},grouped={...scalar,groupBy:['region']}
 const metric=await call('/metrics',{id:'synthetic-bifocal-estate-revenue',definition:{name:'Estate revenue',description:'Exact revenue',grain:'invoice',unit:'money',timezone:'America/New_York',accountingBasis:'accrual',query:scalar}})
 const retain=async(kind,document)=>{const reviewed=await call('/'+kind+'-definitions/review',{document});return call('/'+kind+'-definitions/create',{document,reviewedDigest:reviewed.digest})}
 const chart=await retain('chart',{version:1,title:'Estate regions',definition:grouped,visual:{kind:'bar',dimension:'region',measure:'revenue'}})
 const dashboard=await retain('dashboard',{version:1,title:'Estate dashboard',cards:[scalar,grouped]}),report=await retain('report',{version:1,title:'Estate report',cards:[scalar,grouped]})
 const impact=await call('/quality/impact/'+dataset+'?column=revenue')
 const expectedAnswers=[chart.queryId,...dashboard.cards.map(card=>card.queryId),...report.cards.map(card=>card.queryId)].sort()
 assert.deepEqual(impact.queries,expectedAnswers)
 assert.deepEqual(impact.models,[{id:model.modelId,revision:model.revision,views:['revenue']}])
 assert.deepEqual(impact.metrics,[{id:metric.id,revision:1,published:false}])
 assert.deepEqual(impact.charts,[{id:chart.id,snapshot_id:chart.queryId}])
 assert.deepEqual(impact.cards.map(card=>({id:card.id,position:card.position,snapshot:card.snapshot_id})).sort((a,b)=>a.id.localeCompare(b.id)||a.position-b.position),[...dashboard.cards.map((card,position)=>({id:dashboard.id,position,snapshot:card.queryId})),...report.cards.map((card,position)=>({id:report.id,position,snapshot:card.queryId}))].sort((a,b)=>a.id.localeCompare(b.id)||a.position-b.position))
 const unused=await call('/quality/impact/'+dataset+'?column=unreferenced')
 assert.deepEqual(unused.queries,[]);assert.deepEqual(unused.models,[]);assert.deepEqual(unused.metrics,[]);assert.deepEqual(unused.cards,[])
 const policyDocument={version:1,id:'synthetic-bifocal-estate-policy',name:'Estate inactive policy',modelId:model.modelId,viewId:'revenue',filters:[],dimensions:['region'],underlying:false,summaryExport:false,underlyingExport:false,maxAgeSeconds:3600}
 const policyReview=await call('/policy-definitions/review',{document:policyDocument,previousRevision:null});const policy=await call('/policy-definitions/apply',{document:policyDocument,previousRevision:null,reviewedDigest:policyReview.digest})
 const schedule=await call('/schedules',{id:'synthetic-bifocal-estate-schedule',previousVersion:null,definition:{name:'Estate one-time schedule',localDate:'2026-11-01',time:'01:30',timezone:'America/New_York',reportCutoff:'02:00',skipped:'reject',repeated:'both'}})
 const document={version:1,id:'synthetic-bifocal-release',name:'Regional reporting release',resources:[{key:'sales-model',kind:'model',id:model.modelId,branchId:model.branchId,revisionId:model.revision},{key:'revenue',kind:'metric',id:metric.id,revision:1},{key:'regions',kind:'chart',id:chart.id},{key:'dashboard',kind:'dashboard',id:dashboard.id},{key:'report',kind:'report',id:report.id},{key:'access-intent',kind:'policy',id:policy.id,revision:1},{key:'schedule',kind:'schedule',id:schedule.id,version:1}]}
 const file=join(directory,'environment.native.json'),exported=join(directory,'environment-export.native.json');let sequence=0
 const plan=async()=>{await writeFile(file,JSON.stringify(document));const path=join(directory,'environment-'+sequence+++'.plan.json');return {path,review:await cli('environment-plan',['--file',file,'--plan-file',path])}}
 const first=await plan();const created=await cli('environment-apply',['--plan-file',first.path,'--approve',first.review.digest]);assert.equal(created.revision,1)
 await cli('environment-apply',['--plan-file',first.path,'--approve',first.review.digest],false)
 await cli('environment-export',['--estate',document.id,'--output',exported]);assert.deepEqual(JSON.parse(await readFile(exported,'utf8')),document)
 const envFlags=['--estate',document.id],status=()=>cli('environment-status',envFlags)
 await page.goto(origin+'/app/environments/'+document.id);await page.getByRole('heading',{name:document.name,exact:true}).waitFor();await proveScreen('environment-draft')
 const preview=await cli('environment-run',[...envFlags,'--environment','development','--key','sales-model','--view','revenue']);assert.equal(preview.answer.totals.revenue.value,'30.03');assert.equal(preview.estateRevision,1);assert.equal(preview.productionSends,0);assert.equal(preview.sourceWrites,0)
 await page.goto(origin+'/app/queries/'+preview.queryId);await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();await proveScreen('environment-authorized-development-preview')
 const publish=async(version)=>{
  const review=await cli('environment-review',[...envFlags,'--version',String(version)]);assert.equal(review.compatible,true)
  await cli('environment-approve',[...envFlags,'--version',String(version),'--digest',review.digest,'--security-resolution','Reviewed exact estate definitions and inherited source restrictions.'])
  const staged=await cli('environment-promote',[...envFlags,'--version',String(version),'--digest',review.digest,'--environment','staging']);assert.equal(staged.productionSends,0);assert.equal(staged.sourceWrites,0)
  await cli('environment-promote',[...envFlags,'--version',String(version),'--digest',review.digest,'--environment','production']);return review
 }
 await publish(1)
 assert.deepEqual((await status()).environments,{development:1,staging:1,production:1});assert.equal((await call('/models/'+model.modelId)).production,model.revision);assert.equal((await call('/metric-definitions/'+metric.id)).certifiedRevision,1)
 for(const environment of ['development','staging','production']){
  const answer=await cli('environment-run',[...envFlags,'--environment',environment,'--key','revenue']);assert.equal(answer.answer.totals.revenue.value,'30.03');assert.equal(answer.estateRevision,1)
 }
 await page.goto(origin+'/app/environments/'+document.id);await proveScreen('environment-first-production')
 const config=digest=>({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_environment_definition:{main:{document:JSON.stringify(document),...(digest?{review_digest:digest}:{})}}}})
 const terraform=(args,ok=true)=>tfRun([args[0],'-state=environment.tfstate',...args.slice(1)],ok)
 await writeFile(tf,JSON.stringify(config()));await terraform(['import','-input=false','-no-color','bifocal_environment_definition.main',document.id]);await terraform(['plan','-input=false','-no-color','-detailed-exitcode'])
 const changed=structuredClone(definition);changed.views[0].query.filters=[{column:'region',op:'eq',value:'West'}]
 const modelFile=join(directory,'estate-branch.native.json');await writeFile(modelFile,JSON.stringify(changed));const branch=await cli('branch',['--model',model.modelId,'--file',modelFile])
 const originalResources=structuredClone(document.resources)
 document.resources[0]={...document.resources[0],branchId:branch.branchId,revisionId:branch.revision}
 const refuseMixed=async()=>{const before={estate:await status(),model:await call('/models/'+model.modelId),metric:await call('/metric-definitions/'+metric.id)};await writeFile(file,JSON.stringify(document));await cli('environment-plan',['--file',file,'--plan-file',join(directory,'environment-mixed-'+sequence+++'.json')],false);assert.deepEqual(await status(),before.estate);assert.deepEqual(await call('/models/'+model.modelId),before.model);assert.deepEqual(await call('/metric-definitions/'+metric.id),before.metric)}
 await refuseMixed()
 const westScalar={...scalar,filters:changed.views[0].query.filters,context:{...scalar.context,modelVersion:branch.revision}},westGrouped={...westScalar,groupBy:['region']}
 const metricRevision=await call('/metrics/'+metric.id+'/propose',{previousRevision:1,definition:{...JSON.parse(await readFile(join(directory,'metric-export.native.json'),'utf8')).definition,name:'Estate revenue',description:'West revenue',query:westScalar}})
 const westChart=await retain('chart',{version:1,title:'West estate regions',definition:westGrouped,visual:{kind:'bar',dimension:'region',measure:'revenue'}})
 const westDashboard=await retain('dashboard',{version:1,title:'West estate dashboard',cards:[westScalar,westGrouped]}),westReport=await retain('report',{version:1,title:'West estate report',cards:[westScalar,westGrouped]})
 document.resources[1].revision=metricRevision.revision
 document.resources[2].id=westChart.id;document.resources[3].id=westDashboard.id;document.resources[4].id=westReport.id
 const coherent=structuredClone(document.resources)
 for(const index of [1,2,3,4]){document.resources[index]=originalResources[index];await refuseMixed();document.resources[index]=coherent[index]}
 document.resources=coherent.filter(resource=>resource.kind!=='model');await refuseMixed();document.resources=coherent
 assert.equal((await call('/charts/'+westChart.id)).definition.context.modelVersion,branch.revision)
 for(const [kind,id] of [['dashboards',westDashboard.id],['reports',westReport.id]]){const saved=await call('/'+kind+'/'+id);assert.ok(saved.cards.every(card=>card.definition.context.modelVersion===branch.revision));assert.ok(saved.cards.every(card=>card.definition.filters.some(filter=>filter.column==='region'&&filter.value==='West')))}
 assert.equal((await call('/charts/'+chart.id)).definition.context.modelVersion,model.revision,'Retained original snapshots keep their original semantic revision')
 const edit=await plan();await writeFile(tf,JSON.stringify(config(edit.review.digest)));await terraform(['plan','-input=false','-no-color','-out=environment-stale.tfplan'])
 const concurrent=await cli('environment-apply',['--plan-file',edit.path,'--approve',edit.review.digest]);assert.equal(concurrent.revision,2)
 const stateBefore=await status(),modelBefore=await call('/models/'+model.modelId),metricBefore=await call('/metric-definitions/'+metric.id)
 await terraform(['apply','-input=false','-no-color','environment-stale.tfplan'],false);assert.deepEqual(await status(),stateBefore);assert.deepEqual(await call('/models/'+model.modelId),modelBefore);assert.deepEqual(await call('/metric-definitions/'+metric.id),metricBefore)
 // The concurrent draft already has the desired resources. Give the fresh
 // Terraform update a real document change instead of expecting a no-op to append.
 document.name='Reviewed West reporting release'
 const current=await plan();await writeFile(tf,JSON.stringify(config(current.review.digest)));await terraform(['plan','-input=false','-no-color','-out=environment-current.tfplan']);await terraform(['apply','-input=false','-no-color','environment-current.tfplan']);assert.equal((await status()).revision,3)
 let review=await cli('environment-review',[...envFlags,'--version','3']);assert.ok(review.diff.some(d=>d.key==='sales-model'));assert.ok(review.diff.some(d=>d.key==='revenue'));assert.equal(review.qualityImpact.state,'healthy')
 await cli('environment-approve',[...envFlags,'--version','3','--digest',review.digest]);await cli('environment-promote',[...envFlags,'--version','3','--digest',review.digest,'--environment','staging'])
 const immutableBefore=await call('/reports/'+report.id)
 assert.equal(immutableBefore.cards.length,2);assert.deepEqual(immutableBefore.cards.map(card=>card.answer.totals.revenue.value),['30.03','30.03'])
 const reviewedState={estate:await status(),model:await call('/models/'+model.modelId),metric:await call('/metric-definitions/'+metric.id)}
 await runQuality()
 await cli('environment-promote',[...envFlags,'--version','3','--digest',review.digest,'--environment','production'],false)
 assert.deepEqual(await status(),reviewedState.estate);assert.deepEqual(await call('/models/'+model.modelId),reviewedState.model);assert.deepEqual(await call('/metric-definitions/'+metric.id),reviewedState.metric)
 const evidenceChanged=await cli('environment-review',[...envFlags,'--version','3']);assert.notEqual(evidenceChanged.digest,review.digest);assert.equal(evidenceChanged.qualityImpact.state,'healthy')
 review=evidenceChanged;await cli('environment-approve',[...envFlags,'--version','3','--digest',review.digest])
 await upload(dataset,csv.replace('$10.01','$11.01'),true)
 const staged=await status(),stagedModel=await call('/models/'+model.modelId),stagedMetric=await call('/metric-definitions/'+metric.id)
 await cli('environment-promote',[...envFlags,'--version','3','--digest',review.digest,'--environment','production'],false)
 assert.deepEqual(await status(),staged);assert.deepEqual(await call('/models/'+model.modelId),stagedModel);assert.deepEqual(await call('/metric-definitions/'+metric.id),stagedMetric)
 const unknown=await cli('environment-review',[...envFlags,'--version','3']);assert.equal(unknown.compatible,false);assert.equal(unknown.qualityImpact.state,'unknown');assert.equal(unknown.qualityImpact.blocking,true);const uncheckedSource=unknown.qualityImpact.tests.find(test=>test.ruleId===qualityRule);assert.notEqual(uncheckedSource.runSourceRevision,uncheckedSource.sourceRevision)
 await cli('environment-approve',[...envFlags,'--version','3','--digest',unknown.digest],false)
 await page.goto(origin+'/app/environments/'+document.id);assert.match(await page.locator('[data-environment="development"] [data-quality-impact]').innerText(),/Current quality: unknown/);await proveScreen('environment-unknown-quality-refusal')
 await upload(dataset,'invoice,region,revenue\n1,West,$11.01\n1,Confidential payroll detail,$20.02\n',true)
 const failedRun=await runQuality();assert.equal(failedRun.result.state,'failed');assert.deepEqual(failedRun.result.failingRowNumbers,[2])
 const failed=await cli('environment-review',[...envFlags,'--version','3']);assert.equal(failed.compatible,false);assert.equal(failed.qualityImpact.state,'at risk');assert.equal(failed.qualityImpact.blocking,true)
 const failedTest=failed.qualityImpact.tests.find(test=>test.ruleId===qualityRule);assert.equal(failedTest.runId,failedRun.id);assert.equal(failedTest.state,'failed');assert.equal(failedTest.href,'/app/quality#run-'+failedRun.id);assert.equal(failedTest.ownerId,stagedModel.owner_id);assert.equal(failedTest.sourceRevision,failedRun.sourceRevision);assert.equal(failedTest.checkedAt,failedRun.createdAt)
 const mailHeaders={Origin:origin,'X-Bifocal-Test-Mail':'synthetic-bifocal-mail'},email='synthetic-bifocal-quality-member@example.test'
 assert.equal((await context.request.post(origin+'/auth/invite',{headers:mailHeaders,data:{email,displayName:'Quality restricted member',role:'member'}})).status(),202)
 const restricted=await context.browser().newContext()
 try {
  const messages=await(await context.request.get(origin+'/__model-mail')).json(),message=messages.find(item=>item.to.includes(email));assert.ok(message)
  const token=new URL(message.text.match(/https?:[^\s]+/)[0]).searchParams.get('token');assert.ok(token)
  assert.equal((await restricted.request.post(origin+'/auth/confirm',{headers:mailHeaders,data:{token},maxRedirects:0})).status(),303)
  const session=await restricted.request.get(origin+'/auth/session');assert.equal(session.status(),200);assert.equal((await session.json()).operator.role,'member')
  for(const path of ['/quality','/quality/impact/'+dataset+'?column=invoice','/queries/'+report.cards[0].queryId,'/reports/'+report.id]) {
   const denied=await restricted.request.get(origin+'/api/operator'+path);assert.equal(denied.status(),401)
   const body=await denied.text();assert.ok(!body.includes('failingRowNumbers'));assert.ok(!body.includes('Confidential payroll detail'));assert.ok(!body.includes(failedRun.id))
  }
  assert.equal((await restricted.request.get(origin+'/app/quality')).status(),403)
 } finally {await restricted.close()}
 assert.ok(!JSON.stringify(await call('/quality')).includes('Confidential payroll detail'),'Quality evidence retains row positions without raw sensitive values')
 const failedNative=await cli('validate',['--model',model.modelId,'--branch',branch.branchId],'incompatible');assert.equal(failedNative.compatible,false);assert.equal(failedNative.qualityImpact.state,'at risk')
 await cli('approve',['--model',model.modelId,'--branch',branch.branchId,'--digest',failedNative.digest],false)
 await nativeQualityScreen(branch.branchId,'at risk','model-quality-failed-refusal')
 assert.equal(await page.locator('#publication-quality').getByRole('link',{name:'Inspect exact quality evidence',exact:true}).getAttribute('href'),'/app/quality#run-'+failedRun.id)
 await cli('environment-approve',[...envFlags,'--version','3','--digest',failed.digest],false)
 await cli('environment-promote',[...envFlags,'--version','3','--digest',failed.digest,'--environment','production'],false)
 assert.deepEqual(await status(),staged);assert.deepEqual(await call('/models/'+model.modelId),stagedModel);assert.deepEqual(await call('/metric-definitions/'+metric.id),stagedMetric)
 const retainedFailed=await call('/reports/'+report.id);assert.deepEqual(retainedFailed.cards.map(card=>card.answer.totals.revenue.value),['30.03','30.03']);assert.deepEqual(retainedFailed.cards.map(card=>card.answer),immutableBefore.cards.map(card=>card.answer));assert.deepEqual(retainedFailed.cards.map(card=>card.definition),immutableBefore.cards.map(card=>card.definition));assert.deepEqual(retainedFailed.cards.map(card=>card.createdAt),immutableBefore.cards.map(card=>card.createdAt))
 await page.goto(origin+'/app/environments/'+document.id);const failedPanel=page.locator('[data-environment="development"] [data-quality-impact]');assert.match(await failedPanel.innerText(),/Current quality: at risk/);assert.equal(await failedPanel.getByRole('link',{name:'Inspect exact quality evidence',exact:true}).getAttribute('href'),'/app/quality#run-'+failedRun.id);await proveScreen('environment-failed-quality-refusal')
 await upload(dataset,csv.replace('$10.01','$11.01'),true);assert.equal((await runQuality()).result.state,'passed')
 const repaired=await cli('environment-review',[...envFlags,'--version','3']);assert.equal(repaired.compatible,true);assert.equal(repaired.qualityImpact.state,'healthy');assert.notEqual(repaired.digest,failed.digest)
 await page.goto(origin+'/app/environments/'+document.id);await proveScreen('environment-stale-source-production-refusal')
 await nativeQualityScreen(branch.branchId,'healthy','model-quality-repaired-review')
 const boundaryReview=await cli('environment-review',[...envFlags,'--version','3'])
 await cli('environment-approve',[...envFlags,'--version','3','--digest',boundaryReview.digest]);await cli('environment-promote',[...envFlags,'--version','3','--digest',boundaryReview.digest,'--environment','staging'])
 const boundaryState={estate:await status(),model:await call('/models/'+model.modelId),metric:await call('/metric-definitions/'+metric.id)}
 await armQualityBoundary('/api/operator/environments/'+document.id+'/promote','UPDATE bf_environment_estates SET production=')
 await call('/environments/'+document.id+'/promote',{version:3,environment:'production',digest:boundaryReview.digest},409)
 assert.deepEqual(await status(),boundaryState.estate);assert.deepEqual(await call('/models/'+model.modelId),boundaryState.model);assert.deepEqual(await call('/metric-definitions/'+metric.id),boundaryState.metric)
 await publish(3)
 const production=await cli('environment-run',[...envFlags,'--environment','production','--key','sales-model','--view','revenue']),productionMetric=await cli('environment-run',[...envFlags,'--environment','production','--key','revenue'])
 assert.equal(production.answer.totals.revenue.value,'11.01');assert.equal(productionMetric.answer.totals.revenue.value,'11.01');assert.equal(production.estateRevision,3)
 assert.equal((await call('/models/'+model.modelId)).production,branch.revision);assert.equal((await call('/metric-definitions/'+metric.id)).certifiedRevision,2)
 await page.goto(origin+'/app/environments/'+document.id);assert.match(await page.locator('[data-environment="production"] [data-quality-impact]').innerText(),/Current quality: healthy/);await proveScreen('environment-reviewed-production')
 const rollback=await cli('environment-rollback-plan',[...envFlags,'--version','1']),generation=(await status()).generation
 await cli('environment-rollback',[...envFlags,'--version','1','--generation',String(generation),'--digest',rollback.digest,'--security-resolution','Restore the complete reviewed native definition estate.'])
 const restored=await status();assert.deepEqual(restored.environments,{development:1,staging:1,production:1});assert.equal((await call('/models/'+model.modelId)).production,model.revision);assert.equal((await call('/models/'+model.modelId)).staging,model.revision);assert.equal((await call('/metric-definitions/'+metric.id)).certifiedRevision,1)
 const restoredAnswer=await cli('environment-run',[...envFlags,'--environment','production','--key','sales-model','--view','revenue']);assert.equal(restoredAnswer.answer.totals.revenue.value,'31.03')
 await page.goto(origin+'/app/environments/'+document.id);await proveScreen('environment-coherent-rollback')
 await cli('environment-rollback',[...envFlags,'--version','1','--generation',String(generation),'--digest',rollback.digest],false)
 assert.equal((await call('/explore/access')).grants.some(g=>g.definition_json?.includes(policy.id)),false)
 const state=await readFile(join(directory,'environment.tfstate'),'utf8'),portable=await readFile(exported,'utf8'),saved=await readFile(current.path,'utf8')
 for(const text of [state,portable,saved]){for(const cookie of await context.cookies())if(cookie.value)assert.ok(!text.includes(cookie.value));assert.ok(!text.includes('value_json'));assert.ok(!text.includes('securityScope'));assert.ok(!text.includes('answer_json'));assert.ok(!text.includes('approved_at'))}
 await terraform(['destroy','-auto-approve','-input=false','-no-color']);assert.equal((await status()).environments.production,1)
 const denied=await fetch(origin+'/api/operator/environment-definitions/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({document,previousRevision:3})});assert.equal(denied.status,401)
 const foreign=await context.request.post(origin+'/api/operator/environments/'+document.id+'/approve',{headers:{Origin:'https://foreign.example.test'},data:{version:1,digest:rollback.digest}});assert.equal(foreign.status(),401)
 const erased=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:erased.revision})
 assert.equal((await call('/environment-definitions/'+document.id)).document,null);assert.equal((await call('/policy-definitions/'+policy.id)).document,null);assert.equal((await context.request.get(origin+'/api/operator/charts/'+chart.id)).status(),404)
 console.log('Environment estates: actual CLI and Terraform imports, semantic and configured quality review, native and estate changed-evidence refusal without mutation, unknown and failed checks, repaired recovery with pinned original answers, staging-first promotion, coherent rollback and inactive policies passed')
}
