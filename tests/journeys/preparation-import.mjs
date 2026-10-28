import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {zipSync,strToU8} from 'fflate'

/** Synthetic public-door evidence; provider step equivalence needs the separately
 * registered authorized original corpus and its complete output snapshots. */
export async function provePreparationImports({origin,context,call,upload,signInMember,calendar='synthetic-bifocal-july'}){
 const dataset='synthetic-bifocal-170',sourceCSV='quantity,enabled,region\n1.25,true,West\n1.25,true,West\n3.5,false,East\n'
 await upload(dataset,sourceCSV,false,{columns:{quantity:'text',enabled:'boolean',region:'text'}})
 const original=await call('/datasets/'+dataset)
 const post=async(id,action,data,expected=200)=>{const response=await context.request.post(origin+'/api/operator/import/'+action,{headers:{Origin:origin,'X-Import-Kind':'model','X-Import-Dataset':id},data});assert.equal(response.status(),expected,await response.text());return response.json()}
 async function ingest(projectId,format,file){
  const input={version:1,projectId,format,files:[file],bindings:{},formats:{},context:{modelVersion:'synthetic-bifocal-1',metricVersion:'synthetic-bifocal-2',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
  const bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex')
  const uploadResult=await post(projectId,'uploads',{name:'synthetic-bifocal-1.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')})
  const plan=await post(projectId,'plan',{uploadId:uploadResult.uploadId})
  assert.equal(plan.counts.rejected,0,JSON.stringify(plan));assert.equal(plan.project.report.compatible,false);assert.equal(plan.project.definition,null)
  let completed=false
  for(let i=0;i<20;i++){const result=await post(projectId,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(result.job.state==='completed'){completed=true;break}}
  assert.equal(completed,true);assert.equal((await post(projectId,'reconcile',{planId:plan.planId})).ok,true)
  const project=await call('/model-imports/'+projectId)
  assert.deepEqual(project.input.files,[file])
  const retained=await context.request.get(origin+'/api/operator/import/original/'+plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':projectId}})
  assert.equal(retained.status(),200);const originals=(await retained.json()).originals
  assert.deepEqual(JSON.parse(Buffer.from(originals[0].original.base64,'base64').toString()).files,[file])
  return {project,plan,input}
 }
 const mFile={path:'synthetic-bifocal-1.m',content:'let\n Source = Excel.CurrentWorkbook(){[Name="synthetic-bifocal-1"]}[Content],\n #"Changed Type" = Table.TransformColumnTypes(Source, {{"enabled", type text}, {"quantity", type number}}),\n #"Removed Duplicates" = Table.Distinct(#"Changed Type")\nin #"Removed Duplicates"'}
 const imported=await ingest('synthetic-bifocal-171','powerquery',mFile),path='/preparations/synthetic-bifocal-172/flow-review'
 const bindings={[mFile.path+'#Source']:dataset},request={projectId:imported.project.id,revision:imported.project.revision,bindings}
 const translated=await call(path,request,200)
 assert.equal(translated.compatible,true,JSON.stringify(translated));assert.deepEqual(translated.document,{version:1,dataset,imported:{projectId:imported.project.id,revision:imported.project.revision,flowId:mFile.path,bindings},steps:[{op:'cast',column:'enabled',type:'text'},{op:'cast',column:'quantity',type:'number'},{op:'dedupe'}]})
 assert.deepEqual(translated.output.rows,[['1.25','true','West'],['3.5','false','East']]);assert.equal(translated.steps.length,3)
 assert.deepEqual(translated.steps.map(s=>[s.inputRows,s.outputRows]),[[null,3],[3,3],[3,2]])
 assert.equal(translated.steps[1].inputSchema.find(c=>c.name==='enabled').type,'boolean');assert.equal(translated.steps[1].outputSchema.find(c=>c.name==='enabled').type,'text')
 for(const step of translated.steps){assert.equal(step.status,'translated');assert.equal(mFile.content.slice(step.location.start,step.location.end),step.sourceExpression)}
 const again=await call(path,request,200);assert.equal(again.digest,translated.digest)
 const missing=await call(path,{...request,bindings:{}},200);assert.equal(missing.compatible,false);assert.equal(missing.document,null);assert.deepEqual(missing.steps.map(s=>s.status),['failed','dependency-blocked','dependency-blocked'])
 await call(path,{...request,revision:'synthetic-bifocal-1'},409)
 const unknown=await call(path,{...request,bindings:{[mFile.path+'#Source']:dataset,unknown:dataset}},200);assert.equal(unknown.compatible,false);assert.ok(unknown.diagnostics.some(d=>d.code==='unknown_flow_source_binding'))
 const anonymous=await context.browser().newContext({ignoreHTTPSErrors:true})
 try{const noSession=await anonymous.request.post(origin+'/api/operator'+path,{headers:{Origin:origin},data:request});assert.equal(noSession.status(),401)}finally{await anonymous.close()}
 const foreign=await context.request.post(origin+'/api/operator'+path,{headers:{Origin:'https://synthetic-bifocal-1.invalid'},data:request});assert.equal(foreign.status(),401)
 if(signInMember){
  const member=await context.browser().newContext({ignoreHTTPSErrors:true}),email='synthetic-bifocal-170@example.test'
  try{
   assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email,displayName:'Flow reviewer',role:'member'}})).status(),202)
   await signInMember(member,email)
   const read=await member.request.get(origin+'/api/operator/model-imports/'+imported.project.id);assert.equal(read.status(),401)
   const review=await member.request.post(origin+'/api/operator'+path,{headers:{Origin:origin},data:request});assert.equal(review.status(),401)
  }finally{await member.close()}
 }
 const prepDocument={initialNodes:['synthetic-bifocal-1'],connections:{'synthetic-bifocal-3':{connectionType:'.v1.SqlConnection',connectionAttributes:{class:'textscan',filename:'synthetic-bifocal-1.csv'}}},nodes:{'synthetic-bifocal-1':{id:'synthetic-bifocal-1',name:'Source',nodeType:'.v1.LoadSql',connectionId:'synthetic-bifocal-3',relation:{type:'table',table:'synthetic-bifocal-1'},fields:[{name:'quantity',type:'string'},{name:'enabled',type:'bool'},{name:'region',type:'string'}],nextNodes:[{nextNodeId:'synthetic-bifocal-2',namespace:'Default',nextNamespace:'Default'}]},'synthetic-bifocal-2':{id:'synthetic-bifocal-2',name:'Changed Type',nodeType:'.v1.ChangeColumnType',fields:{enabled:{type:'string',calc:null}},nextNodes:[]}}}
 const prepJSON=JSON.stringify(prepDocument,null,2),prepFile={path:'synthetic-bifocal-2.tfl',content:Buffer.from(zipSync({flow:strToU8(prepJSON),displaySettings:strToU8('{}')})).toString('base64')}
 const prep=await ingest('synthetic-bifocal-173','tableau-prep',prepFile)
 const prepReview=await call('/preparations/synthetic-bifocal-174/flow-review',{projectId:prep.project.id,revision:prep.project.revision,bindings:{[prepFile.path+'#synthetic-bifocal-1']:dataset}},200)
 assert.equal(prepReview.compatible,true,JSON.stringify(prepReview));assert.deepEqual(prepReview.output.rows,[['1.25','true','West'],['1.25','true','West'],['3.5','false','East']])
 for(const step of prepReview.steps){assert.equal(step.location.member,'flow');assert.equal(prepJSON.slice(step.location.start,step.location.end),step.sourceExpression)}
 const unsupportedFile={path:'synthetic-bifocal-3.m',content:'let Source = Excel.CurrentWorkbook(){[Name="synthetic-bifocal-1"]}[Content], Custom = Table.SelectRows(Source, each [quantity] > 1), Final = Table.Distinct(Custom) in Final'}
 const unsupported=await ingest('synthetic-bifocal-175','powerquery',unsupportedFile)
 const blocked=await call('/preparations/synthetic-bifocal-176/flow-review',{projectId:unsupported.project.id,revision:unsupported.project.revision,bindings:{[unsupportedFile.path+'#Source']:dataset}},200)
 assert.equal(blocked.compatible,false);assert.equal(blocked.document,null);assert.equal(blocked.output,null);assert.deepEqual(blocked.steps.map(s=>s.status),['translated','unsupported','dependency-blocked']);assert.ok(blocked.diagnostics.some(d=>d.code==='unsupported_m_step'))
 const unsafeArchive={path:'synthetic-bifocal-4.tflx',content:Buffer.from(zipSync({'../synthetic-bifocal-1.json':strToU8('{}'),flow:strToU8(prepJSON)})).toString('base64')}
 const unsafe=await ingest('synthetic-bifocal-177','tableau-prep',unsafeArchive)
 assert.ok(unsafe.project.report.issues.some(i=>i.code==='invalid_prep_flow'))
 const failureFile={path:'synthetic-bifocal-5.m',content:'let Source = Excel.CurrentWorkbook(){[Name="synthetic-bifocal-1"]}[Content], Broken = Table.TransformColumnTypes(Source, {{"region", type number}}), Final = Table.Distinct(Broken) in Final'}
 const failure=await ingest('synthetic-bifocal-178','powerquery',failureFile)
 const failed=await call('/preparations/synthetic-bifocal-179/flow-review',{projectId:failure.project.id,revision:failure.project.revision,bindings:{[failureFile.path+'#Source']:dataset}},200)
 assert.equal(failed.compatible,false);assert.equal(failed.document,null);assert.deepEqual(failed.steps.map(s=>s.status),['translated','failed','dependency-blocked']);assert.ok(failed.diagnostics.some(d=>d.code==='flow_canonical_conversion_required'))
 assert.deepEqual(await call('/datasets/'+dataset),original)
 const erase=async()=>{
  const current=await call('/datasets/'+dataset)
  const receipt=await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision},200)
  assert.ok(receipt.modelProjects.length>=4)
  await call('/model-imports/'+imported.project.id,undefined,404)
  await call(path,request,404)
  const retained=await context.request.get(origin+'/api/operator/import/original/'+imported.plan.planId,{headers:{'X-Import-Kind':'model','X-Import-Dataset':imported.project.id}})
  assert.equal(retained.status(),200);assert.equal((await retained.json()).originals[0].original.status,'unavailable')
 }
 return {projectId:imported.project.id,preparationId:'synthetic-bifocal-172',review:translated,request,erase}
}
