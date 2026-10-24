import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {dump} from 'js-yaml'
import {unzipSync,strFromU8} from 'fflate'
import {modelProjectFixtures} from './model-project-fixtures.mjs'

export async function proveModelImports({origin,context,page,call,upload,proveScreen}){
 const dataset='synthetic-bifocal-model-imports',csv='invoice,region,revenue,internal-note\n1,West,$10.01,Restricted source detail\n2,East,$20.02,Other source detail\n3,West,-$0.03,Return detail\n4,East,,Missing revenue detail\n'
 await upload(dataset,csv)
 const expected=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json
c=sqlite3.connect(':memory:');c.execute('CREATE TABLE invoices(invoice INTEGER,region TEXT,cents INTEGER)')
c.executemany('INSERT INTO invoices VALUES(?,?,?)',[(1,'West',1001),(2,'East',2002),(3,'West',-3),(4,'East',None)])
print(json.dumps({'all':c.execute('SELECT sum(cents),count(distinct region) FROM invoices').fetchone(),'west':c.execute("SELECT sum(cents),count(distinct region) FROM invoices WHERE region='West'").fetchone()}))`],{encoding:'utf8'}))
 const projects=modelProjectFixtures(dataset,'synthetic-bifocal-july'),saved=[]
 const post=async(id,action,data,expected=200)=>{const r=await context.request.post(origin+'/api/operator/import/'+action,{headers:{Origin:origin,'X-Import-Kind':'model','X-Import-Dataset':id},data});assert.equal(r.status(),expected,await r.text());return r.json()}
 const prepare=async input=>{const bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex'),u=await post(input.projectId,'uploads',{name:'synthetic-bifocal-project.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')});return post(input.projectId,'plan',{uploadId:u.uploadId})}
 const apply=async(id,plan)=>{await post(id,'apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},403);for(let i=0;i<20;i++){const a=await post(id,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(a.job.state==='completed'){const r=await post(id,'reconcile',{planId:plan.planId});assert.equal(r.ok,true);return}}assert.fail('Project import did not complete')}
 for(const input of projects){
  const plan=await prepare(input)
  assert.equal(plan.counts.rejected,0,JSON.stringify(plan));assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report));assert.deepEqual(plan.project.report.issues,[]);assert.ok(plan.project.definition.views.every(v=>v.query.semantic.dimensions.every(d=>d.column!=='internal-note')))
  await apply(input.projectId,plan)
  const originalFiles=await context.request.get(origin+'/api/operator/import/original/'+plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':input.projectId}});assert.equal(originalFiles.status(),200,await originalFiles.text());const originals=(await originalFiles.json()).originals;assert.equal(originals[0].original.status,'retained');assert.deepEqual(JSON.parse(Buffer.from(originals[0].original.base64,'base64').toString()).files,input.files)
  const imported=await call('/model-imports/'+input.projectId),native=dump(imported.definition),body={document:native,importProject:input.projectId,importRevision:imported.revision}
  assert.deepEqual(imported.input.files,input.files)
  const review=await call('/model-authoring/review',body,200);assert.equal(review.compatible,true,JSON.stringify(review));assert.equal(review.imported.format,input.format)
  const measure=input.format==='tmdl'?'revenuesum':'revenue-sum',value=review.impacts[0].answer.totals[measure]
  assert.equal(value.value,(expected.all[0]/100).toFixed(2));if(input.format!=='tmdl')assert.equal(review.impacts[0].answer.totals['unique-regions'].value,String(expected.all[1]))
  const model=await call('/model-authoring/create',{...body,reviewedDigest:review.digest}),path='/models/'+model.modelId+'/branches/'+model.branchId
  const publication=await call(path+'/validate',{},200);await call(path+'/approve',{digest:publication.digest},200);await call(path+'/promote',{environment:'staging',digest:publication.digest},200);await call(path+'/promote',{environment:'production',digest:publication.digest},200)
  const answer=await call('/models/'+model.modelId+'/production/run',{viewId:'sales'})
  assert.equal(answer.answer.totals[measure].value,value.value);assert.equal(answer.context.modelImport.projectId,input.projectId);assert.equal(answer.context.modelImport.revision,imported.revision)
  const report=await call('/reports',{queryId:answer.queryId,title:input.format+' source revenue'}),dashboard=await call('/dashboards',{queryId:answer.queryId,title:input.format+' source revenue'})
  assert.deepEqual(report.answer,answer.answer);assert.deepEqual(dashboard.context.modelImport,answer.context.modelImport)
  const question=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['region'],filters:[{column:'region',op:'eq',value:'West'}]})
  assert.equal(question.answer.totals[measure].value,(expected.west[0]/100).toFixed(2));assert.equal(question.context.modelImport.digest,imported.digest)
  await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:['internal-note'],filters:[]},403)
  const empty=await call('/explore/run',{modelId:model.modelId,revision:model.revision,viewId:'sales',groupBy:[],filters:[{column:'region',op:'eq',value:'Absent'}]})
  assert.equal(empty.answer.totals[measure].value,input.format==='lookml'?'0.00':null)
  for(const format of ['csv','xlsx']){const exported=await context.request.post(origin+'/api/operator/explore/'+question.queryId+'/export',{headers:{Origin:origin},data:{scope:'summary',format}});assert.equal(exported.status(),200);if(format==='csv')assert.match(await exported.text(),/9\.98/);else{const zip=unzipSync(await exported.body()),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);assert.match(sheet,/<v>9\.98<\/v>/)}}
  saved.push({input,plan,imported,model,answer,report,question})
 }
 // Original files load from a real git working tree, then use the same browser
 // and exact-review door as any owner-authored native model.
 const git=await mkdtemp(join(tmpdir(),'bifocal-model-git-'))
 try{execFileSync('git',['init','-q',git]);await writeFile(join(git,'model.yaml'),dump(saved[0].imported.definition));execFileSync('git',['-C',git,'add','model.yaml']);execFileSync('git',['-C',git,'-c','user.name='+execFileSync('git',['log','-1','--format=%an'],{encoding:'utf8'}).trim(),'-c','user.email='+execFileSync('git',['log','-1','--format=%ae'],{encoding:'utf8'}).trim(),'commit','-qm','Author reviewed fiscal model']);const tracked=await readFile(join(git,'model.yaml'),'utf8');await page.goto(origin+'/app/models');await page.getByRole('status').filter({hasText:'Ready to author'}).waitFor();await page.getByLabel('Open native model YAML').setInputFiles(join(git,'model.yaml'));await page.getByRole('status').filter({hasText:'Native YAML loaded'}).waitFor();assert.equal(await page.getByLabel('Model document').inputValue(),tracked);await page.getByRole('button',{name:'Review model',exact:true}).click();await page.getByRole('status').filter({hasText:'Review complete'}).waitFor();await proveScreen('model-git-review')}finally{await rm(git,{recursive:true,force:true})}
 const original=saved[0],uiInput=structuredClone(projects[0]);uiInput.projectId='synthetic-bifocal-browser-model'
 await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project fiscal calendar',{exact:true}).selectOption(JSON.stringify(uiInput.context.calendar));await page.getByLabel('Project ID',{exact:true}).fill(uiInput.projectId);await page.getByLabel('Model format',{exact:true}).selectOption('lookml');await page.getByLabel('Original project files',{exact:true}).setInputFiles(uiInput.files.map(f=>({name:f.path,mimeType:'text/plain',buffer:Buffer.from(f.content)})));await page.getByLabel('Source bindings (JSON)',{exact:true}).fill(JSON.stringify(uiInput.bindings));await page.getByLabel('Measure formats (JSON)',{exact:true}).fill(JSON.stringify(uiInput.formats));await page.getByRole('button',{name:'Preview semantic import',exact:true}).click();await page.getByRole('status').filter({hasText:'Review the source compatibility'}).waitFor();await proveScreen('model-project-review');await page.getByLabel('I reviewed this exact project plan and its unresolved items').check();await page.getByRole('button',{name:'Import reviewed project',exact:true}).click();await page.getByRole('status').filter({hasText:'Project imported and reconciled'}).waitFor();await proveScreen('model-project-imported');await page.getByRole('link',{name:'Review imported model',exact:true}).click();await page.getByRole('status').filter({hasText:'Imported definition loaded'}).waitFor();await page.getByRole('button',{name:'Review model',exact:true}).click();await page.getByRole('status').filter({hasText:'Review complete'}).waitFor();await proveScreen('model-translated-review')
 const unsupported=structuredClone(projects[0]);unsupported.projectId='synthetic-bifocal-unsupported-model';unsupported.files[0].content=unsupported.files[0].content.replace('explore: sales {}','explore: sales { sql_always_where: ${sales.region} = \'West\' ;; }')
 const blocked=await prepare(unsupported);assert.equal(blocked.project.report.compatible,false);assert.ok(blocked.project.report.issues.some(i=>i.object.includes('sql_always_where')&&i.sourceExpression.includes('West')));await apply(unsupported.projectId,blocked)
 await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(unsupported.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.equal(await page.getByRole('link',{name:'Review imported model',exact:true}).count(),0);await proveScreen('model-unresolved-project')
 const cancelled=structuredClone(projects[0]);cancelled.projectId='synthetic-bifocal-cancelled-model';const cancelledPlan=await prepare(cancelled);await post(cancelled.projectId,'undo',{planId:cancelledPlan.planId})
 const stale=structuredClone(projects[0]);stale.projectId='synthetic-bifocal-stale-model';const stalePlan=await prepare(stale);await upload(dataset,csv.replace('$10.01','$11.01'),true);await post(stale.projectId,'apply',{planId:stalePlan.planId,reviewedFingerprint:stalePlan.fingerprint},409)
 assert.equal((await fetch(origin+'/api/operator/model-imports/'+projects[0].projectId)).status,401)
 const foreign=await context.request.post(origin+'/api/operator/import/plan',{headers:{Origin:'https://synthetic-bifocal.invalid','X-Import-Kind':'model','X-Import-Dataset':projects[0].projectId},data:{uploadId:'synthetic-bifocal-denied'}});assert.equal(foreign.status(),401)
 await call('/model-authoring/review',{document:dump(original.imported.definition),importProject:projects[0].projectId,importRevision:'stale'},409)
 const source=await call('/datasets/'+dataset);const erased=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200);assert.ok(erased.modelProjects.length>=projects.length)
 for(const item of saved){const originals=await context.request.get(origin+'/api/operator/import/original/'+item.plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':item.input.projectId}});assert.equal(originals.status(),200,await originals.text());assert.ok((await originals.json()).originals.every(o=>o.original.status==='unavailable'));await call('/model-imports/'+item.input.projectId,undefined,404);await call('/models/'+item.model.modelId,undefined,404);await call('/queries/'+item.answer.queryId,undefined,404);await call('/reports/'+item.report.id,undefined,404);await post(item.input.projectId,'apply',{planId:item.plan.planId,reviewedFingerprint:item.plan.fingerprint},410)}
 for(const [input,plan] of [[unsupported,blocked],[cancelled,cancelledPlan],[stale,stalePlan]]){await call('/model-imports/'+input.projectId,undefined,404);await post(input.projectId,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410)}
 console.log('Source model imports: original LookML, dbt, MetricFlow, TMDL and Cube shared review, exact source SQL parity, native publication, governed exploration and exports, git YAML, explicit gaps, stale refusal and full source withdrawal passed')
}
