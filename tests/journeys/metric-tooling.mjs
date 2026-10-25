import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Actual native metric authoring, CLI files and saved Terraform plans. */
export async function proveMetricTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf}){
 const dataset='synthetic-bifocal-metric-tools',csv='invoice,region,revenue\n1,West,$10.01\n2,East,$20.02\n3,West,-$0.03\n'
 await upload(dataset,csv)
 const source=await call('/datasets/'+dataset),base=JSON.parse(await readFile(join(directory,'export.native.json'),'utf8')).views[0].query
 const query={...base,dataset,filters:[],groupBy:[],joins:[],semantic:{grain:['invoice'],dimensions:source.table.columns.map(c=>({column:c.name,type:c.type})),hierarchies:[],slowlyChanging:'reject-duplicate-grain'}}
 delete query.fiscal
 const company=await call('/company')
 const document={version:1,id:'synthetic-bifocal-git-metric',definition:{name:'Net revenue',description:'Revenue with returns',grain:'invoice',unit:query.measures[0].unit,timezone:company.settings.timezone,accountingBasis:query.context.accountingBasis,query}}
 const file=join(directory,'metric.native.json'),exported=join(directory,'metric-export.native.json');let sequence=0
 const review=async(label='metric')=>{await writeFile(file,JSON.stringify(document));const plan=join(directory,label+'-'+sequence+++'.plan.json');return {plan,result:await cli('metric-plan',['--file',file,'--plan-file',plan])}}
 const create=await review();assert.equal(create.result.previousRevision,null);assert.equal(create.result.after.value.value,'30.00');assert.equal(create.result.before,null)
 const unauthenticated=await fetch(origin+'/api/operator/metric-definitions/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({document,previousRevision:null})});assert.equal(unauthenticated.status,401)
 const foreign=await context.request.post(origin+'/api/operator/metric-definitions/review',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{document,previousRevision:null}});assert.equal(foreign.status(),401)
 const metric=await cli('metric-apply',['--plan-file',create.plan,'--approve',create.result.digest]);assert.equal(metric.revision,1)
 await cli('metric-apply',['--plan-file',create.plan,'--approve',create.result.digest],false)
 await cli('metric-export',['--metric',document.id,'--output',exported]);assert.deepEqual(JSON.parse(await readFile(exported,'utf8')),create.result.document)
 document.definition=create.result.document.definition
 await page.goto(origin+'/app/metrics/'+document.id);await page.getByRole('heading',{name:'Net revenue',exact:true}).waitFor();await proveScreen('metric-cli-draft')
 await page.getByLabel('Dated change annotation').fill('Reviewed exact source cents');await page.getByLabel('I approve this exact metric definition').check();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/metrics/'+document.id+'/approve')&&r.request().method()==='POST'),page.getByRole('button',{name:'Certify revision 1'}).click()]);await page.waitForLoadState();assert.match(await page.locator('body').innerText(),/Certified revision 1/);await proveScreen('metric-human-certified')
 const certified=await call('/metrics/'+document.id+'/run',{});assert.equal(certified.answer.totals.revenue.value,'30.00')
 const writeConfig=async(digest)=>writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_metric_definition:{main:{document:JSON.stringify(document),...(digest?{review_digest:digest}:{})}}}}))
 const terraform=async(args,ok=true)=>tfRun([args[0],'-state=metric.tfstate',...args.slice(1)],ok)
 await writeConfig();await terraform(['import','-input=false','-no-color','bifocal_metric_definition.main',document.id])
 await terraform(['plan','-input=false','-no-color','-detailed-exitcode'])
 document.definition.query.filters=[{column:'region',op:'eq',value:'West'}]
 const edit=await review();assert.equal(edit.result.before.value.value,'30.00');assert.equal(edit.result.after.value.value,'9.98');await writeConfig(edit.result.digest)
 await terraform(['plan','-input=false','-no-color','-out=metric-stale.tfplan'])
 const native=await call('/metrics/'+document.id+'/propose',{previousRevision:1,definition:{...document.definition,name:'Concurrent owner edit'}})
 const concurrent=await call('/metric-definitions/'+document.id)
 await terraform(['apply','-input=false','-no-color','metric-stale.tfplan'],false);assert.deepEqual(await call('/metric-definitions/'+document.id),concurrent)
 assert.equal((await call('/metrics/'+document.id+'/run',{})).answer.totals.revenue.value,'30.00','Drafts cannot change certified execution')
 const fresh=await review();await writeConfig(fresh.result.digest)
 await terraform(['plan','-input=false','-no-color','-out=metric-current.tfplan']);await terraform(['apply','-input=false','-no-color','metric-current.tfplan'])
 const current=await call('/metric-definitions/'+document.id);assert.equal(current.revision,3);assert.equal(current.certifiedRevision,1);assert.equal(current.document.definition.name,'Net revenue')
 await page.goto(origin+'/app/metrics/'+document.id);assert.match(await page.locator('body').innerText(),/Draft revision 3/);await proveScreen('metric-terraform-draft-diff')
 // Changing only the review fingerprint never creates another native revision.
 await writeConfig((await review()).result.digest);await terraform(['apply','-auto-approve','-input=false','-no-color']);assert.equal((await call('/metric-definitions/'+document.id)).revision,3)
 const staleSource=await review();document.definition.description='Source-fenced change';const changedSource=await review();await writeConfig(changedSource.result.digest)
 await terraform(['plan','-input=false','-no-color','-out=metric-source.tfplan'])
 await upload(dataset,csv.replace('$10.01','$11.01'),true)
 await terraform(['apply','-input=false','-no-color','metric-source.tfplan'],false);assert.deepEqual(await call('/metric-definitions/'+document.id),current)
 await cli('metric-apply',['--plan-file',staleSource.plan,'--approve',staleSource.result.digest],false)
 // Restoring the original file is a newly reviewed draft, never certification replay.
 Object.assign(document,JSON.parse(await readFile(exported,'utf8')));const restore=await review();const restored=await cli('metric-apply',['--plan-file',restore.plan,'--approve',restore.result.digest]);assert.equal(restored.revision,4)
 assert.equal((await call('/metric-definitions/'+document.id)).certifiedRevision,1)
 await page.goto(origin+'/app/metrics/'+document.id);await proveScreen('metric-reviewed-restore')
 await writeConfig();await terraform(['refresh','-input=false','-no-color']);await terraform(['destroy','-auto-approve','-input=false','-no-color']);assert.equal((await call('/metric-definitions/'+document.id)).revision,4)
 document.id='synthetic-bifocal-terraform-metric';const tfCreate=await review();await writeConfig(tfCreate.result.digest);await terraform(['plan','-input=false','-no-color','-out=metric-create.tfplan']);await terraform(['apply','-input=false','-no-color','metric-create.tfplan']);assert.equal((await call('/metric-definitions/'+document.id)).certifiedRevision,null)
 const state=await readFile(join(directory,'metric.tfstate'),'utf8'),portable=await readFile(exported,'utf8'),plan=await readFile(tfCreate.plan,'utf8'),cookie=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ')
 for(const text of [state,portable,plan]){assert.ok(!text.includes(cookie));assert.ok(!text.includes('SESSION_SECRET'));assert.ok(!text.includes('table_json'));assert.ok(!text.includes('approved_at'));assert.ok(!text.includes('securityScope'))}
 assert.deepEqual((await call('/datasets/'+dataset)).table.columns,source.table.columns)
 await terraform(['destroy','-auto-approve','-input=false','-no-color'])
 console.log('Native metric tools: real CLI and Terraform import, draft edits, exact review diff, independent certification, source and concurrent-edit refusal, reviewed restore and retained history passed')
}
