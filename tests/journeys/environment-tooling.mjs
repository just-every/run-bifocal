import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Current native resources move as one reviewed environment estate. */
export async function proveEnvironmentTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf}){
 const dataset='synthetic-bifocal-estate-source',csv='invoice,region,revenue\n1,West,$10.01\n2,East,$20.02\n'
 await upload(dataset,csv)
 const base=JSON.parse(await readFile(join(directory,'metric-export.native.json'),'utf8')).definition.query
 const query={...base,dataset,filters:[],groupBy:[]};delete query.fiscal
 const definition={views:[{id:'revenue',kind:'report',query,rowRules:[]}],quality:[]},model=await call('/models',{definition}),flags=['--model',model.modelId,'--branch',model.branchId]
 const initial=await cli('validate',flags);await cli('approve',[...flags,'--digest',initial.digest]);await cli('promote',[...flags,'--digest',initial.digest,'--environment','staging']);await cli('promote',[...flags,'--digest',initial.digest,'--environment','production'])
 const scalar={...query,context:{...query.context,modelVersion:model.revision}},grouped={...scalar,groupBy:['region']}
 const metric=await call('/metrics',{id:'synthetic-bifocal-estate-revenue',definition:{name:'Estate revenue',description:'Exact revenue',grain:'invoice',unit:'money',timezone:'America/New_York',accountingBasis:'accrual',query:scalar}})
 const retain=async(kind,document)=>{const reviewed=await call('/'+kind+'-definitions/review',{document});return call('/'+kind+'-definitions/create',{document,reviewedDigest:reviewed.digest})}
 const chart=await retain('chart',{version:1,title:'Estate regions',definition:grouped,visual:{kind:'bar',dimension:'region',measure:'revenue'}})
 const dashboard=await retain('dashboard',{version:1,title:'Estate dashboard',cards:[scalar,grouped]}),report=await retain('report',{version:1,title:'Estate report',cards:[scalar,grouped]})
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
 const metricRevision=await call('/metrics/'+metric.id+'/propose',{previousRevision:1,definition:{...JSON.parse(await readFile(join(directory,'metric-export.native.json'),'utf8')).definition,name:'Estate revenue',description:'West revenue',query:{...scalar,filters:changed.views[0].query.filters}}})
 document.resources[0]={...document.resources[0],branchId:branch.branchId,revisionId:branch.revision};document.resources[1].revision=metricRevision.revision
 const edit=await plan();await writeFile(tf,JSON.stringify(config(edit.review.digest)));await terraform(['plan','-input=false','-no-color','-out=environment-stale.tfplan'])
 const concurrent=await cli('environment-apply',['--plan-file',edit.path,'--approve',edit.review.digest]);assert.equal(concurrent.revision,2)
 const stateBefore=await status(),modelBefore=await call('/models/'+model.modelId),metricBefore=await call('/metric-definitions/'+metric.id)
 await terraform(['apply','-input=false','-no-color','environment-stale.tfplan'],false);assert.deepEqual(await status(),stateBefore);assert.deepEqual(await call('/models/'+model.modelId),modelBefore);assert.deepEqual(await call('/metric-definitions/'+metric.id),metricBefore)
 const current=await plan();await writeFile(tf,JSON.stringify(config(current.review.digest)));await terraform(['plan','-input=false','-no-color','-out=environment-current.tfplan']);await terraform(['apply','-input=false','-no-color','environment-current.tfplan']);assert.equal((await status()).revision,3)
 const review=await cli('environment-review',[...envFlags,'--version','3']);assert.ok(review.diff.some(d=>d.key==='sales-model'));assert.ok(review.diff.some(d=>d.key==='revenue'))
 await cli('environment-approve',[...envFlags,'--version','3','--digest',review.digest]);await cli('environment-promote',[...envFlags,'--version','3','--digest',review.digest,'--environment','staging'])
 await upload(dataset,csv.replace('$10.01','$11.01'),true)
 const staged=await status(),stagedModel=await call('/models/'+model.modelId),stagedMetric=await call('/metric-definitions/'+metric.id)
 await cli('environment-promote',[...envFlags,'--version','3','--digest',review.digest,'--environment','production'],false)
 assert.deepEqual(await status(),staged);assert.deepEqual(await call('/models/'+model.modelId),stagedModel);assert.deepEqual(await call('/metric-definitions/'+metric.id),stagedMetric)
 await page.goto(origin+'/app/environments/'+document.id);await proveScreen('environment-stale-source-production-refusal')
 await publish(3)
 const production=await cli('environment-run',[...envFlags,'--environment','production','--key','sales-model','--view','revenue']),productionMetric=await cli('environment-run',[...envFlags,'--environment','production','--key','revenue'])
 assert.equal(production.answer.totals.revenue.value,'11.01');assert.equal(productionMetric.answer.totals.revenue.value,'11.01');assert.equal(production.estateRevision,3)
 assert.equal((await call('/models/'+model.modelId)).production,branch.revision);assert.equal((await call('/metric-definitions/'+metric.id)).certifiedRevision,2)
 await page.goto(origin+'/app/environments/'+document.id);await proveScreen('environment-reviewed-production')
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
 console.log('Environment estates: actual CLI and Terraform imports, semantic review, authorized development preview, staging-first atomic promotion, stale edits and source refusal, coherent native model and metric rollback and inactive policies passed')
}
