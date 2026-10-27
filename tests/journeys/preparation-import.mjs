import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {zipSync,strToU8} from 'fflate'

/** Synthetic, documented source-format cases prove the bounded native door.
 * They are not the buyer-authorized corpus or its translation pass bars. */
export async function provePreparationImports({origin,context,page,call,upload,proveScreen,signInMember}){
 const dataset='synthetic-bifocal-flow-source',projectId='synthetic-bifocal-flow',csv='id,a,b,label\n1,2,3,A\n2,,4,B\n1,2,3,A\n3,0.1,0.2,C\n'
 await upload(dataset,csv)
 const m=`let
 Source = Csv.Document(File.Contents("synthetic-bifocal-1.csv")),
 Typed = Table.TransformColumnTypes(Source, {{"a", type number}, {"b", type number}}),
 Unique = Table.Distinct(Typed),
 Total = Table.AddColumn(Unique, "total", each [a] + [b]),
 Renamed = Table.RenameColumns(Total, {{"label", "region"}}),
 Selected = Table.SelectColumns(Renamed, {"id", "a", "b", "region", "total"}),
 Sorted = Table.Sort(Selected, {{"id", Order.Descending}}),
 Long = Table.Unpivot(Sorted, {"a", "b"}, "measure", "value")
in Long`
 const envelope=(id,format,files)=>({version:1,projectId:id,format,files,bindings:{Orders:{dataset,grain:['id']}},formats:{},context:{modelVersion:'model-import',metricVersion:'source-measures',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-july',version:1},rounding:'half-even'}})
 const post=async(id,action,data,expected=200)=>{const response=await context.request.post(origin+'/api/operator/import/'+action,{headers:{Origin:origin,'X-Import-Kind':'model','X-Import-Dataset':id},data});assert.equal(response.status(),expected,await response.text());return response.json()}
 const prepare=async(input,catchup=false)=>{const bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex'),u=await post(input.projectId,'uploads',{name:'synthetic-bifocal-flow.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')});return post(input.projectId,'plan',{uploadId:u.uploadId,...catchup?{catchup:true}:{}})}
 const apply=async(id,plan)=>{for(let i=0;i<20;i++){const result=await post(id,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(result.job.state==='completed'){assert.equal((await post(id,'reconcile',{planId:plan.planId})).ok,true);return}}assert.fail('Preparation import did not complete')}
 const source=[['1','2','3','A'],['2',null,'4','B'],['1','2','3','A'],['3','0.1','0.2','C']],unique=[source[0],source[1],source[3]],total=[['1','2','3','A','5'],['2',null,'4','B',null],['3','0.1','0.2','C','0.3']],sorted=[total[2],total[1],total[0]],long=[['3','C','0.3','a','0.1'],['3','C','0.3','b','0.2'],['2','B',null,'b','4'],['1','A','5','a','2'],['1','A','5','b','3']]
 const expected=[source,source,unique,total,total,total,sorted,long]
 const variants=[
  envelope(projectId,'powerquery',[{path:'Orders.pq',content:m}]),
  envelope('synthetic-bifocal-gen1','dataflow-gen1',[{path:'model.json',content:JSON.stringify({name:'Synthetic orders',version:'1.0','pbi:mashup':{document:'section Section1; shared Orders = '+m+';',queriesMetadata:{Orders:{queryName:'Orders',loadEnabled:true}}}})}]),
  envelope('synthetic-bifocal-gen2','dataflow-gen2',[{path:'definition.json',content:JSON.stringify({definition:{parts:[{path:'mashup.pq',payloadType:'InlineBase64',payload:Buffer.from('section Section1; shared Orders = '+m+';').toString('base64')},{path:'queryMetadata.json',payloadType:'InlineBase64',payload:Buffer.from(JSON.stringify({formatVersion:'202502',name:'Synthetic orders',queriesMetadata:{Orders:{queryName:'Orders',loadEnabled:true}},connections:[]})).toString('base64')}]}})}]),
  envelope('synthetic-bifocal-pbip-flow','powerquery',[{path:'Orders.SemanticModel/definition/tables/Orders.tmdl',content:'table Orders\n\tpartition Orders = m\n\t\tmode: import\n\t\tsource =\n'+m.split('\n').map(line=>'\t\t\t'+line).join('\n')+'\n'}])
 ]
 const sourceRevision=(await call('/datasets/'+dataset)).revision,baseColumns=[{name:'id',type:'number'},{name:'a',type:'number'},{name:'b',type:'number'},{name:'label',type:'text'}],totalColumns=[...baseColumns,{name:'total',type:'number'}],renamedColumns=[...baseColumns.slice(0,3),{name:'region',type:'text'},{name:'total',type:'number'}],longColumns=[{name:'id',type:'number'},{name:'region',type:'text'},{name:'total',type:'number'},{name:'measure',type:'text'},{name:'value',type:'number'}]
 const schemas=[baseColumns,baseColumns,baseColumns,totalColumns,renamedColumns,renamedColumns,renamedColumns,longColumns],stepNames=['Source','Typed','Unique','Total','Renamed','Selected','Sorted','Long']
 variants[0].sourceOutputs=stepNames.map((step,i)=>({flow:'Orders',step,columns:schemas[i],rows:expected[i],ordered:true,sources:[{dataset,revision:sourceRevision}]}))
 const imported=[]
 for(const input of variants){
  const plan=await prepare(input);assert.equal(plan.counts.rejected,0,JSON.stringify(plan));assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report.issues))
  const flows=plan.project.preparation;assert.equal(flows.length,1);const flow=flows[0];assert.deepEqual(flow.steps.map(s=>s.name),['Source','Typed','Unique','Total','Renamed','Selected','Sorted','Long'])
  for(const [i,step] of flow.steps.entries()){
   assert.equal(step.status,'translated');assert.equal(step.file.includes(input.files[0].path)||input.format==='dataflow-gen2',true);assert.ok(step.location.length);assert.ok(step.sourceExpression.length)
   assert.deepEqual(step.output.rows,expected[i],step.name);assert.equal(step.rowEquivalence,input===variants[0]?'matched':'not-supplied');if(input===variants[0])assert.deepEqual(step.comparison,{state:'matched',schemaEqual:true,multisetEqual:true,orderEqual:true,ordered:true,sourceRows:expected[i].length,nativeRows:expected[i].length});assert.equal(step.remediationOwner,'installation-owner')
   assert.deepEqual(step.executable,i===0?[]:flow.document.steps.slice(flow.steps[i-1].document.steps.length,step.document.steps.length))
  }
  assert.deepEqual(flow.steps[4].outputSchema.map(c=>c.name),['id','a','b','region','total']);assert.deepEqual(flow.steps[4].inputSchema.map(c=>c.name),['id','a','b','label','total'])
  assert.deepEqual(flow.output.columns,[{name:'id',type:'number'},{name:'region',type:'text'},{name:'total',type:'number'},{name:'measure',type:'text'},{name:'value',type:'number'}]);assert.deepEqual(flow.output.rows,long)
  await apply(input.projectId,plan)
  const current=await call('/model-imports/'+input.projectId);assert.deepEqual(current.input.files,input.files)
  const native=await call('/model-imports/'+input.projectId+'/preparation',{reviewedRevision:current.revision,flow:flow.id},200);assert.deepEqual(native.output.rows,long);assert.equal(native.document.imported.revision,current.revision)
  await call('/model-imports/'+input.projectId+'/preparation',{reviewedRevision:'synthetic-bifocal-stale',flow:flow.id},409)
  // Preparation imports do not become a semantic model merely by being parsed.
  await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:current.revision},409)
  imported.push({input,plan,current,flow,native})
 }
 for(const mismatch of ['order','null','duplicate','type','snapshot']){
  const input=structuredClone(variants[0]);input.projectId='synthetic-bifocal-compare-'+mismatch
  const ref=input.sourceOutputs[0];ref.rows=ref.rows.map(row=>[...row]);ref.columns=ref.columns.map(column=>({...column}))
  if(mismatch==='order')ref.rows.reverse()
  if(mismatch==='null')ref.rows[1][1]='0'
  if(mismatch==='duplicate')ref.rows.splice(2,1)
  if(mismatch==='type')ref.columns[0].type='text'
  if(mismatch==='snapshot')ref.sources[0].revision='synthetic-bifocal-stale'
  const plan=await prepare(input),flow=plan.project.preparation[0];assert.equal(plan.project.report.compatible,false);assert.equal(flow.steps[0].rowEquivalence,mismatch==='snapshot'?'invalid':'different');assert.equal(flow.steps[0].status,'blocked');assert.equal(flow.steps[1].status,'blocked');assert.equal(flow.document,null)
  if(mismatch==='order'){assert.equal(flow.steps[0].comparison.multisetEqual,true);assert.equal(flow.steps[0].comparison.orderEqual,false)}
  if(mismatch==='duplicate'){assert.equal(flow.steps[0].comparison.sourceRows,3);assert.equal(flow.steps[0].comparison.nativeRows,4)}
  if(mismatch==='type')assert.equal(flow.steps[0].comparison.schemaEqual,false)
  await apply(input.projectId,plan);const current=await call('/model-imports/'+input.projectId);await call('/model-imports/'+input.projectId+'/preparation',{reviewedRevision:current.revision,flow:flow.id},409)
 }
 const unordered=structuredClone(variants[0]);unordered.projectId='synthetic-bifocal-unordered';unordered.sourceOutputs[0].rows=[...unordered.sourceOutputs[0].rows].reverse();unordered.sourceOutputs[0].ordered=false
 const multiset=await prepare(unordered);assert.equal(multiset.project.report.compatible,true);assert.equal(multiset.project.preparation[0].steps[0].comparison.multisetEqual,true);assert.equal(multiset.project.preparation[0].steps[0].comparison.orderEqual,false);assert.equal(multiset.project.preparation[0].steps[0].rowEquivalence,'matched')
 const first=imported[0],prepId='synthetic-bifocal-translated',path='/preparations/'+prepId,document=first.native.document
 const review=await call(path+'/review',{document,previousVersion:null},200);assert.equal(review.compatible,true);assert.deepEqual(review.output.rows,long)
 const sqlReview=await call(path+'/review',{dataset,sql:review.sql,imported:document.imported,previousVersion:null},200);assert.deepEqual(sqlReview.document,document);assert.deepEqual(sqlReview.output,review.output)
 const saved=await call(path+'/save',{document,previousVersion:null,reviewedDigest:review.digest});assert.equal(saved.version,1)
 const edited=structuredClone(document);edited.steps.find(s=>s.op==='calculate').operator='multiply'
 const changed=await call(path+'/review',{document:edited,previousVersion:1},200);assert.deepEqual(changed.output.rows,[['3','C','0.02','a','0.1'],['3','C','0.02','b','0.2'],['2','B',null,'b','4'],['1','A','6','a','2'],['1','A','6','b','3']]);assert.deepEqual(changed.output.lineage,review.output.lineage)
 await call(path+'/save',{document:edited,previousVersion:1,reviewedDigest:changed.digest});const history=await call(path);assert.equal(history.version,2);assert.deepEqual(history.revisions.map(r=>r.document.imported),[document.imported,document.imported]);assert.deepEqual(history.revisions.map(r=>r.lineage),[saved.output,changed.output].map(r=>({columns:r.columns,lineage:r.lineage})))
 const restore=await call(path+'/review',{document,previousVersion:2},200);await call(path+'/restore',{restoreVersion:1,previousVersion:2,reviewedDigest:restore.digest});assert.equal((await call(path)).version,3)
 // A local editor, through the same installed screen, opens the translated
 // graph and saves an edited revision retaining source project provenance.
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.deepEqual(await page.getByRole('table',{name:'Preparation step translations',exact:true}).locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.cells[3].textContent)),['matched','matched','matched','matched','matched','matched','matched','matched']);await proveScreen('preparation-import-translated');await page.getByText('Compare preparation source outputs',{exact:true}).click();assert.deepEqual(JSON.parse(await page.getByLabel('Source step outputs (JSON)',{exact:true}).inputValue()),variants[0].sourceOutputs);await proveScreen('preparation-import-source-comparison');await page.getByText('Compare preparation source outputs',{exact:true}).click()
 await page.getByRole('button',{name:/Edit translated flow:/}).click();await page.getByRole('status').filter({hasText:'Imported flow loaded'}).waitFor();await page.getByLabel('Step 4: Arithmetic',{exact:true}).selectOption('multiply');await page.getByRole('button',{name:'Review preparation',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft reviewed'}).waitFor();await proveScreen('preparation-import-native-edit')
 await page.getByLabel('I reviewed these exact rows, errors, source revisions and digest',{exact:true}).check();await page.getByRole('button',{name:'Save reviewed draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft saved'}).waitFor();assert.equal((await call('/preparations/'+projectId)).revisions[0].document.imported.revision,first.current.revision)
 const dependencies=envelope('synthetic-bifocal-flow-dependencies','powerquery',[{path:'mashup.pq',content:'section Section1; shared Limit = 7 meta [IsParameterQuery=true, Type="Number"]; shared Raw = Csv.Document(File.Contents("synthetic-bifocal-1.csv")); shared Orders = let Source = Raw, Unique = Table.Distinct(Source) in Unique;'}]);dependencies.bindings={Raw:{dataset,grain:['id']}}
 const dependencyPlan=await prepare(dependencies);assert.equal(dependencyPlan.project.report.compatible,true,JSON.stringify(dependencyPlan.project.report.issues));assert.deepEqual(dependencyPlan.project.preparation.map(f=>f.name),['Limit','Raw','Orders']);assert.deepEqual(dependencyPlan.project.preparation[0].steps[0].parameter,{type:'Number',value:7});assert.deepEqual(dependencyPlan.project.preparation[2].output.rows,unique);assert.deepEqual(dependencyPlan.project.preparation[2].steps[0].dependencies,[dependencyPlan.project.preparation[1].result])
 for(const [name,expression,reason] of [['custom','(value) => value','Custom M functions'],['python','Python.Execute("raise Exception()")','Python'],['folder','Folder.Files("synthetic-bifocal-root")','Folder'],['connector','CustomConnector.Contents("synthetic-bifocal-1")','CustomConnector'],['privacy','Value.Firewall(Source)','Value.Firewall'],['integer','Table.TransformColumnTypes(Source, {{"a", Int64.Type}})','Int64'],['culture','Table.Sort(Source, {{"label", Order.Ascending}})','Culture-sensitive']]){
  const input=envelope('synthetic-bifocal-unsupported-'+name,'powerquery',[{path:'Orders.pq',content:'let Source = Csv.Document(File.Contents("synthetic-bifocal-1.csv")), Unsupported = '+expression+', Output = Table.Distinct(Unsupported) in Output'}]),plan=await prepare(input),flow=plan.project.preparation[0]
  assert.equal(plan.project.report.compatible,false);assert.equal(flow.steps.length,3);assert.equal(flow.steps[1].status,'unsupported');assert.ok(flow.steps[1].reason.includes(reason),flow.steps[1].reason);assert.equal(flow.steps[2].status,'blocked');assert.deepEqual(flow.steps[1].affectedDownstream,[flow.steps[2].id]);assert.equal(flow.document,null)
 }
 // Every unsafe or unimplemented source construct stays in the denominator
 // and blocks all dependent output and the native transfer door.
 const bad=envelope('synthetic-bifocal-flow-blocked','powerquery',[{path:'Orders.pq',content:'let Source = Csv.Document(File.Contents("synthetic-bifocal-1.csv")), Unsafe = Web.Contents("https://example.test"), Output = Table.Distinct(Unsafe) in Output'}])
 const blocked=await prepare(bad);assert.equal(blocked.project.report.compatible,false);const badFlow=blocked.project.preparation[0];assert.equal(badFlow.steps.length,3);assert.equal(badFlow.steps[1].status,'unsupported');assert.match(badFlow.steps[1].reason,/Web.Contents|web/i);assert.ok(badFlow.steps[1].affectedDownstream.includes(badFlow.steps[2].id));assert.equal(badFlow.steps[2].status,'blocked');assert.equal(badFlow.document,null)
 await apply(bad.projectId,blocked);const badCurrent=await call('/model-imports/'+bad.projectId);await call('/model-imports/'+bad.projectId+'/preparation',{reviewedRevision:badCurrent.revision,flow:badFlow.id},409)
 await page.getByLabel('Project ID',{exact:true}).fill(bad.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();assert.equal(await page.getByRole('button',{name:/Edit translated flow:/}).isDisabled(),true);await proveScreen('preparation-import-blocked')
 // Prep documents are topology, not executable Tableau code. Both packaging
 // extensions use ZIP in Tableau's documented sample, with a literal flow member.
 const prep={majorVersion:1,minorVersion:7,initialNodes:['input'],connections:{csv:{id:'csv',connectionType:'.v1.FileConnection',connectionAttributes:{class:'textscan',filename:'synthetic-bifocal-1.csv'}}},nodes:{input:{id:'input',name:'Orders',nodeType:'.v1.LoadCsv',baseType:'input',connectionId:'csv',nextNodes:[{nextNodeId:'output'}]},output:{id:'output',name:'Result',nodeType:'.v1.PublishExtract',baseType:'output',nextNodes:[]}}}
 for(const extension of ['tfl','tflx']){
  const file={path:'synthetic-bifocal-1.'+extension,content:Buffer.from(zipSync({flow:strToU8(JSON.stringify(prep)),displaySettings:strToU8('{}')})).toString('base64')},input=envelope('synthetic-bifocal-prep-'+extension,'prep',[file]),plan=await prepare(input)
  assert.equal(plan.project.report.compatible,true,JSON.stringify(plan.project.report.issues));assert.deepEqual(plan.project.preparation[0].steps.map(s=>[s.name,s.status]),[['Orders','translated'],['Result','translated']]);assert.deepEqual(plan.project.preparation[0].output.rows,source);assert.deepEqual(plan.project.preparation[0].metadata.inactiveReferences,['csv'])
  await apply(input.projectId,plan);const current=await call('/model-imports/'+input.projectId);assert.deepEqual(current.input.files,[file])
  await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();await proveScreen('preparation-import-'+extension)
 }
 const unsupported=structuredClone(prep);unsupported.nodes.input.nextNodes=[{nextNodeId:'script'}];unsupported.nodes.script={id:'script',name:'Python',nodeType:'.v1.Script',baseType:'transform',script:'raise Exception("must stay inert")',nextNodes:[{nextNodeId:'output'}]}
 const prepBad=envelope('synthetic-bifocal-prep-blocked','prep',[{path:'synthetic-bifocal-2.tfl',content:JSON.stringify(unsupported)}]),prepPlan=await prepare(prepBad);assert.equal(prepPlan.project.report.compatible,false);assert.deepEqual(prepPlan.project.preparation[0].steps.map(s=>[s.name,s.status]),[['Orders','translated'],['Result','blocked'],['Python','unsupported']]);assert.match(prepPlan.project.preparation[0].steps.find(s=>s.name==='Python').reason,/Script/)
 await apply(prepBad.projectId,prepPlan);const prepCurrent=await call('/model-imports/'+prepBad.projectId);await call('/model-imports/'+prepBad.projectId+'/preparation',{reviewedRevision:prepCurrent.revision,flow:prepPlan.project.preparation[0].id},409)
 const duplicate=envelope('synthetic-bifocal-prep-duplicate','prep',[{path:'synthetic-bifocal-4.tfl',content:'{"nodes":{"input":{"id":"input","name":"Orders","nodeType":".v1.LoadCsv","baseType":"input"},"input":{"id":"input","name":"Other","nodeType":".v1.LoadCsv","baseType":"input"}},"initialNodes":["input"]}'}]);const duplicatePlan=await prepare(duplicate);assert.equal(duplicatePlan.project.report.compatible,false);assert.match(duplicatePlan.project.report.issues[0].message,/duplicate/i)
 // An unsafe archive never yields guessed source data or a draft.
 const unsafe=envelope('synthetic-bifocal-prep-unsafe','prep',[{path:'synthetic-bifocal-3.tflx',content:Buffer.from(zipSync({'../flow':strToU8(JSON.stringify(prep))})).toString('base64')}]);const refused=await prepare(unsafe);assert.equal(refused.project.report.compatible,false);assert.match(refused.project.report.issues[0].message,/unsafe/i)
 const signedOut=await context.browser().newContext({ignoreHTTPSErrors:true});try{assert.equal((await signedOut.request.get(origin+'/api/operator/model-imports/'+projectId)).status(),401)}finally{await signedOut.close()}
 const cross=await context.request.post(origin+'/api/operator/model-imports/'+projectId+'/preparation',{headers:{Origin:'https://foreign.example.test'},data:{reviewedRevision:first.current.revision,flow:first.flow.id}});assert.equal(cross.status(),401)
 const member=await context.browser().newContext({ignoreHTTPSErrors:true})
 try{const email='synthetic-bifocal-flow-member@example.test';assert.equal((await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email,displayName:'Flow member',role:'member'}})).status(),202);await signInMember(member,email);assert.equal((await member.request.get(origin+'/api/operator/model-imports/'+projectId)).status(),401);assert.equal((await member.request.post(origin+'/api/operator/model-imports/'+projectId+'/preparation',{headers:{Origin:origin},data:{reviewedRevision:first.current.revision,flow:first.flow.id}})).status(),401)}finally{await member.close()}
 // Replacing a retained project invalidates its old native provenance; Undo
 // restores it, and erasure reaches native drafts and original custody.
 const replacement=structuredClone(first.input);replacement.files[0].content+='\n';const replacementPlan=await prepare(replacement,true);await apply(projectId,replacementPlan);await call(path+'/review',{document,previousVersion:3},409);await post(projectId,'undo',{planId:replacementPlan.planId});assert.equal((await call(path+'/review',{document,previousVersion:3},200)).compatible,true)
 await call('/model-imports/'+projectId+'/erase',{confirmProject:projectId,reviewedRevision:first.current.revision},200);await call(path,undefined,404);await call('/preparations/'+projectId,undefined,404);await call('/model-imports/'+projectId,undefined,404)
 console.log('Preparation import: exact ordered typed rows, nulls, schemas, unsupported downstream refusal, native edit and version lineage, inert archives, owner isolation and erasure passed')
}
