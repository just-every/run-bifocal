import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Actual native definition, CLI files and Terraform; nothing activates access. */
export async function provePolicyTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf,model,revision,viewId}) {
 const catalog=await call('/explore'),view=catalog.views.find(v=>v.modelId===model&&v.viewId===viewId&&v.revision===revision)
 assert.ok(view,'Policy references the exact published governed view')
 const accessBefore=await call('/explore/access'),sourceBefore=await call('/datasets/synthetic-bifocal-invoices')
 const document={version:1,id:'synthetic-bifocal-git-policy',name:'Regional reporting intent',modelId:model,viewId,filters:[],dimensions:[view.groupBy[0]??view.dimensions[0].column],underlying:false,summaryExport:true,underlyingExport:false,maxAgeSeconds:3600}
 const file=join(directory,'policy.native.json'),exported=join(directory,'policy-export.native.json');let sequence=0
 const review=async(doc=document)=>{await writeFile(file,JSON.stringify(doc));const plan=join(directory,'policy-'+sequence+++'.plan.json');return {plan,result:await cli('policy-plan',['--file',file,'--plan-file',plan])}}
 const missing=await call('/policy-definitions/'+document.id);assert.equal(missing.document,null);assert.equal(missing.active,false)
 const unauthorized=await fetch(origin+'/api/operator/policy-definitions/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({document,previousRevision:null})});assert.equal(unauthorized.status,401)
 const post=(path,data)=>context.request.post(origin+'/api/operator/policy-definitions'+path,{headers:{Origin:origin},data})
 const foreign=await context.request.post(origin+'/api/operator/policy-definitions/review',{headers:{Origin:'https://foreign.example.test'},data:{document,previousRevision:null}});assert.equal(foreign.status(),401)
 for(const invalid of [{...document,operatorId:'unreviewed-member'},{...document,sourceGrants:[]},{...document,underlyingExport:true},{...document,maxAgeSeconds:604801}])assert.equal((await post('/review',{document:invalid,previousRevision:null})).status(),400)
 assert.equal((await post('/review',{document:{...document,dimensions:['synthetic-hidden-field']},previousRevision:null})).status(),403)
 const initial=await review();assert.equal(initial.result.before,null);assert.deepEqual(initial.result.after,document);assert.equal(initial.result.active,false);assert.equal(initial.result.productionSends,0);assert.equal(initial.result.sourceWrites,0)
 const created=await cli('policy-apply',['--plan-file',initial.plan,'--approve',initial.result.digest]);assert.equal(created.revision,1);assert.equal(created.active,false)
 await cli('policy-apply',['--plan-file',initial.plan,'--approve',initial.result.digest],false)
 await cli('policy-export',['--policy',document.id,'--output',exported]);assert.deepEqual(JSON.parse(await readFile(exported,'utf8')),document)
 const writeConfig=async(digest)=>writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_role_policy_definition:{main:{document:JSON.stringify(document),...(digest?{review_digest:digest}:{})}}}}))
 const terraform=(args,ok=true)=>tfRun([args[0],'-state=policy.tfstate',...args.slice(1)],ok)
 await writeConfig();await terraform(['import','-input=false','-no-color','bifocal_role_policy_definition.main',document.id]);await terraform(['plan','-input=false','-no-color','-detailed-exitcode'])
 document.maxAgeSeconds=1800
 const edit=await review();assert.equal(edit.result.before.maxAgeSeconds,3600);assert.equal(edit.result.after.maxAgeSeconds,1800);await writeConfig(edit.result.digest)
 await terraform(['plan','-input=false','-no-color','-out=policy-stale.tfplan'])
 const concurrentDocument={...document,name:'Concurrent owner policy intent'},nativeReview=await call('/policy-definitions/review',{document:concurrentDocument,previousRevision:1})
 await call('/policy-definitions/apply',{document:concurrentDocument,previousRevision:1,reviewedDigest:nativeReview.digest})
 const concurrent=await call('/policy-definitions/'+document.id)
 await terraform(['apply','-input=false','-no-color','policy-stale.tfplan'],false);await cli('policy-apply',['--plan-file',edit.plan,'--approve',edit.result.digest],false)
 assert.deepEqual(await call('/policy-definitions/'+document.id),concurrent)
 const fresh=await review();await writeConfig(fresh.result.digest);await terraform(['plan','-input=false','-no-color','-out=policy-current.tfplan']);await terraform(['apply','-input=false','-no-color','policy-current.tfplan'])
 const current=await call('/policy-definitions/'+document.id);assert.equal(current.revision,3);assert.equal(current.active,false);assert.deepEqual(current.document,document)
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/policies/'+document.id);await page.getByRole('heading',{name:document.name,exact:true}).waitFor();assert.match(await page.getByRole('status').innerText(),/Inactive definition/);await page.getByRole('heading',{name:'Semantic before and after'}).waitFor();await page.getByRole('heading',{name:'Version history'}).waitFor();assert.equal(await page.getByText('Revision 1 ·',{exact:false}).count(),1);await proveScreen('policy-inactive-semantic-history')}
 // Explicit restoration is another immutable inactive revision.
 const original=JSON.parse(await readFile(exported,'utf8')),restore=await review(original)
 const restored=await cli('policy-apply',['--plan-file',restore.plan,'--approve',restore.result.digest]);assert.equal(restored.revision,4);assert.equal(restored.active,false)
 Object.assign(document,original);await writeConfig();await terraform(['refresh','-input=false','-no-color']);await terraform(['destroy','-auto-approve','-input=false','-no-color']);assert.equal((await call('/policy-definitions/'+document.id)).revision,4)
 document.id='synthetic-bifocal-terraform-policy';const create=await review();await writeConfig(create.result.digest);await terraform(['plan','-input=false','-no-color','-out=policy-create.tfplan']);await terraform(['apply','-input=false','-no-color','policy-create.tfplan']);assert.equal((await call('/policy-definitions/'+document.id)).active,false)
 const portable=await readFile(exported,'utf8'),state=await readFile(join(directory,'policy.tfstate'),'utf8'),plan=await readFile(create.plan,'utf8')
 for(const text of [portable,state,plan]){for(const cookie of await context.cookies())if(cookie.value)assert.ok(!text.includes(cookie.value),'Policy files and state contain no session credential');assert.ok(!text.includes('SESSION_SECRET'));assert.ok(!text.includes('value_json'));assert.ok(!text.includes('securityScope'));assert.ok(!text.includes('operatorId'));assert.ok(!text.includes('sourceGrants'))}
 assert.deepEqual((await call('/explore/access')).grants,accessBefore.grants,'Policy lifecycle issues no grant or activation')
 assert.deepEqual(await call('/datasets/synthetic-bifocal-invoices'),sourceBefore,'Policy lifecycle never writes the production source')
 await terraform(['destroy','-auto-approve','-input=false','-no-color'])
 // Isolated source and model proves both binding fences without changing production fixtures.
 const dataset='synthetic-bifocal-policy-drift',csv='invoice,region,revenue\n1,West,$10.01\n'
 await upload(dataset,csv)
 const native=JSON.parse(await readFile(join(directory,'export.native.json'),'utf8')),query=structuredClone(native.views[0].query)
 query.dataset=dataset;query.joins=[];query.filters=[];query.groupBy=['region'];query.semantic={grain:['invoice'],dimensions:[{column:'invoice',type:'number'},{column:'region',type:'text'},{column:'revenue',type:'money'}],hierarchies:[],slowlyChanging:'reject-duplicate-grain'};delete query.fiscal
 const definition={views:[{id:'regional',kind:'chart',query,rowRules:[]}],quality:[]},own=await call('/models',{definition}),branch='/models/'+own.modelId+'/branches/'+own.branchId
 const publish=async(path)=>{const checked=await call(path+'/validate',{});assert.equal(checked.compatible,true);await call(path+'/approve',{digest:checked.digest});await call(path+'/promote',{environment:'staging',digest:checked.digest});await call(path+'/promote',{environment:'production',digest:checked.digest})}
 await publish(branch)
 const driftDocument={...document,id:'synthetic-bifocal-policy-drift',modelId:own.modelId,viewId:'regional',dimensions:['region']},sourcePlan=await review(driftDocument)
 await upload(dataset,csv.replace('$10.01','$11.01'),true)
 await cli('policy-apply',['--plan-file',sourcePlan.plan,'--approve',sourcePlan.result.digest],false);assert.equal((await call('/policy-definitions/'+driftDocument.id)).document,null)
 const modelPlan=await review(driftDocument),next=await call('/models/'+own.modelId+'/branches',{definition})
 await publish('/models/'+own.modelId+'/branches/'+next.branchId)
 await cli('policy-apply',['--plan-file',modelPlan.plan,'--approve',modelPlan.result.digest],false);assert.equal((await call('/policy-definitions/'+driftDocument.id)).document,null)
 assert.deepEqual((await call('/explore/access')).grants,accessBefore.grants)
 console.log('Inactive role policies: actual CLI and Terraform creation, import, edits and restoration, semantic history, concurrent/source and model drift refusal and no analytical activation passed at 1440 and 390')
}
