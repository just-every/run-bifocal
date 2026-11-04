import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function proveMigrationProjects({origin,context,call,page,proveScreen,persist}){
 const id='synthetic-bifocal-migration',base='/migration-projects/'+id,headers={Origin:origin,'X-Import-Kind':'migration-project','X-Import-Dataset':id}
 const post=async(action,data,status=200)=>{const response=await context.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(response.status(),status,await response.text());return response.json()}
 const baselines=new Set()
 const prepare=async input=>{const bytes=Buffer.from(JSON.stringify(input)),hash=createHash('sha256').update(bytes).digest('hex');const data={name:'synthetic-bifocal-migration.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')};const upload=await post('uploads',data);assert.equal((await post('uploads',{...data,uploadId:upload.uploadId})).uploadId,upload.uploadId);return post('plan',{uploadId:upload.uploadId,...(baselines.has(input.projectId)?{catchup:true}:{})})}
 const apply=async plan=>{for(let i=0;i<20;i++){const response=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(response.job.state==='completed'){baselines.add(headers['X-Import-Dataset']);assert.equal((await post('reconcile',{planId:plan.planId})).ok,true);return}}assert.fail('Migration apply incomplete')}
 const metric={id:'revenue',kind:'metric',sourceRevision:'1',original:'sum(amount)',mapping:'Reviewed revenue reconstruction',gap:'Source-query parity not yet proved'}
 const input={version:1,projectId:id,source:'qlik',cutoff:'2026-10-15T12:00:00Z',rollbackPlan:'Keep incumbent active; retain every reviewed version.',items:[metric,{id:'set-analysis',kind:'set-analysis',sourceRevision:'1',original:"sum({<Region={'West'}>} Amount)",mapping:'Governed West filter required',gap:'Associative equivalence unproved'}]}
 assert.equal((await fetch(origin+'/api/operator'+base)).status,401)
 const plan=await prepare(input);assert.equal(plan.counts.rejected,0)
 await post('apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},403)
 await apply(plan)
 let current=await call(base)
 assert.deepEqual(current.items.map(i=>i.source.id),['revenue','set-analysis'])
 assert.equal(current.state,'inactive');assert.equal(current.dispatch,'unavailable');assert.equal(current.grants,'none')
 assert.equal(current.items[1].source.gap,'Associative equivalence unproved')
 const before=current.revision,retry=await prepare(input);await apply(retry);current=await call(base)
 assert.equal(current.items[0].native,'sum(amount)');assert.equal(current.items.length,2)
 // The shared door resumes the exact retained plan without repeating effects.
 await apply(retry);assert.deepEqual(await call(base),current)
 await post('undo',{planId:retry.planId});assert.equal((await call(base)).items[0].native,'sum(amount)')
 const edit=await call(base+'/edit',{reviewedRevision:current.revision,itemId:'revenue',native:'sum(net_amount)'},200)
 await call(base+'/edit',{reviewedRevision:current.revision,itemId:'revenue',native:'stale edit'},409)
 const beforeUndo=await call(base);await post('undo',{planId:plan.planId},409);assert.deepEqual(await call(base),beforeUndo)
 const delta=structuredClone(input);delta.cutoff='2026-10-16T12:00:00Z';delta.items=[{...metric,sourceRevision:'2',original:'sum(gross_amount)'},{id:'new-dashboard',kind:'dashboard',sourceRevision:'1',original:'Revenue dashboard',mapping:'Retained chart required',gap:'Rendering not reconstructed'}]
 const deltaPlan=await prepare(delta);assert.equal(deltaPlan.project.items.find(i=>i.source.id==='revenue').conflict.original,'sum(gross_amount)')
 // A stale import plan cannot overwrite a later native edit.
 await call(base+'/edit',{reviewedRevision:edit.revision,itemId:'revenue',native:'sum(net_amount)-returns'},200)
 const beforeStale=await call(base);const stale=await post('apply',{planId:deltaPlan.planId,reviewedFingerprint:deltaPlan.fingerprint},409);assert.equal(stale.error,'import_door_apply_constraint');assert.deepEqual(await call(base),beforeStale)
 const freshInput=structuredClone(delta),fresh=await prepare(delta);await apply(fresh);current=await call(base)
 assert.deepEqual(current.items.map(i=>i.source.id),['new-dashboard','revenue','set-analysis'])
 const conflicted=current.items.find(i=>i.source.id==='revenue');assert.equal(conflicted.native,'sum(net_amount)-returns');assert.equal(conflicted.source.original,'sum(amount)');assert.equal(conflicted.conflict.original,'sum(gross_amount)')
 await call(base+'/resolve',{reviewedRevision:before,itemId:'revenue',choice:'use-source'},409)
 current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:'revenue',choice:'keep-native'},200)
 assert.equal(current.items.find(i=>i.source.id==='revenue').native,'sum(net_amount)-returns');assert.equal(current.items.find(i=>i.source.id==='revenue').conflict,null)
 const replay=await prepare(delta);await apply(replay);current=await call(base)
 assert.equal(current.items.find(i=>i.source.id==='revenue').conflict,null)
 // A future conflicting delta can instead accept the reviewed source definition.
 delta.items[0].sourceRevision='3';delta.items[0].original='sum(final_amount)';await apply(await prepare(delta));current=await call(base)
 current=await call(base+'/resolve',{reviewedRevision:current.revision,itemId:'revenue',choice:'use-source'},200)
 assert.equal(current.items.find(i=>i.source.id==='revenue').native,'sum(final_amount)');assert.equal(current.items.find(i=>i.source.id==='revenue').edited,false)
 const history=await call(base),versions=await Promise.all(history.history.map(h=>call(base+'/versions/'+h.revision)));assert.ok(versions.some(h=>h.action==='edit'&&h.value.items.some(i=>i.native==='sum(net_amount)')));assert.ok(versions.some(h=>h.action==='import'&&h.value.items.some(i=>i.conflict?.original==='sum(gross_amount)')))
 const originals=await context.request.get(origin+'/api/operator/import/original/'+fresh.planId,{headers});assert.equal(originals.status(),200);const retained=(await originals.json()).originals;assert.equal(retained.length,1);assert.deepEqual(JSON.parse(Buffer.from(retained[0].original.base64,'base64').toString('utf8')),freshInput)
 const foreign=await context.request.post(origin+'/api/operator'+base+'/edit',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{reviewedRevision:current.revision,itemId:'revenue',native:'foreign'}});assert.equal(foreign.status(),401)
 const invitation=await context.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email:'synthetic-bifocal-migration-member@example.test',displayName:'Synthetic migration member',role:'member'}});assert.equal(invitation.status(),202)
 const member=await context.browser().newContext()
 try{
  const entered=await member.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent('synthetic-bifocal-migration-member@example.test'),{headers:{'x-rer-dev-key':'synthetic-bifocal-9'.repeat(3)},maxRedirects:0});assert.equal(entered.status(),303)
  assert.equal((await member.request.get(origin+'/api/operator'+base)).status(),401)
  assert.equal((await member.request.get(origin+'/api/operator'+base+'/versions/'+history.history[0].revision)).status(),401)
  for(const action of ['edit','resolve','erase'])assert.equal((await member.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:origin},data:{reviewedRevision:current.revision,itemId:'revenue',native:'forbidden',choice:'use-source',confirmImport:id}})).status(),401)
  assert.equal((await member.request.post(origin+'/api/operator/import/apply',{headers,data:{planId:fresh.planId,reviewedFingerprint:fresh.fingerprint}})).status(),401)
 }finally{await member.close()}
 // All formats remain inert reconstruction manifests, never translated claims.
 for(const source of ['spreadsheet','databox','zoho','klipfolio']){const specimen={...input,source};const other=id+'-'+source,old=headers['X-Import-Dataset'];headers['X-Import-Dataset']=other;specimen.projectId=other;const p=await prepare(specimen);assert.equal(p.counts.rejected,0);assert.equal(p.project.source,source);assert.equal(p.project.dispatch,'unavailable');headers['X-Import-Dataset']=old}
 await call(base+'/erase',{confirmImport:id,reviewedRevision:current.revision},200);await call(base,undefined,404)
 const withdrawn=await context.request.get(origin+'/api/operator/import/original/'+fresh.planId,{headers});assert.equal(withdrawn.status(),200);const unavailable=(await withdrawn.json()).originals;assert.equal(unavailable.length,1);assert.equal(unavailable[0].original.status,'unavailable');assert.equal(unavailable[0].original.base64,undefined)
 await call(base+'/versions/'+history.history[0].revision,undefined,404)
 await post('apply',{planId:fresh.planId,reviewedFingerprint:fresh.fingerprint},410)
 await proveHexMigration({origin,context,call,page,proveScreen,persist})
 console.log('Migration projects: shared retained plans, exact approval, idempotent resume, deltas, native conflicts, both resolutions, original history, stale and foreign refusal, erasure and inert reconstruction inventories passed')
}

// Self-authored original-format specimens from the published Hex v3 schema. No customer export or provider run is claimed.
async function proveHexMigration({origin,context,call,page,proveScreen,persist}){
 const {dump}=await import('js-yaml'),{promises:{readdir}}=await import('node:fs'),{join}=await import('node:path'),{DatabaseSync}=await import('node:sqlite')
 const id='synthetic-bifocal-hex',base='/migration-projects/'+id,headers={Origin:origin,'X-Import-Kind':'migration-project','X-Import-Dataset':id}
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006']
 const missing='00000000-0000-4000-8000-000000000099'
 const root={schemaVersion:3,meta:{projectId:'10000000-0000-4000-8000-000000000001',sourceVersionId:'20000000-0000-4000-8000-000000000001',title:'Synthetic Hex intake',codeLanguage:'PYTHON',kernelImage:'python-synthetic-bifocal',timezone:'UTC'},projectAssets:{dataConnections:[{dataConnectionId:'30000000-0000-4000-8000-000000000001'}],envVars:[{name:'BIFOCAL_REGION',value:'West'},{name:'PASSPHRASE',value:''},{name:'AUTHORIZATION',value:''}]},sharedAssets:{vcsPackages:[{vcsPackageId:'40000000-0000-4000-8000-000000000001'}],secrets:[{secretName:'synthetic-bifocal-reference'}]},cells:[
  {cellId:ids[0],cellType:'SQL',config:{source:'select amount from sales where region = {{ region }}',resultVariableName:'sales',dataConnectionId:'30000000-0000-4000-8000-000000000001'}},
  {cellId:ids[1],cellType:'CODE',config:{source:'import synthetic_bifocal_missing_package\nfrom os import system\nvalues = [1, 2]\nexpanded = [*values]\nreference = "https://example.test/data?region=West"\nresult = sales[globals()["column"]]\nsystem("synthetic-bifocal-must-never-execute")'}},
  {cellId:ids[2],cellType:'MARKDOWN',config:{source:'Some *emphasis* and **strong** text. [Guide](https://example.test/guide?topic=syntax) <script>globalThis.syntheticHexExecuted=true</script><img src="/__hex-executed"> {{ result }}'}},
  {cellId:ids[3],cellType:'CHART',config:{vegaSpec:{data:{name:'result'},mark:'bar',encoding:{x:{field:'region'},y:{field:'amount'}}}}},
  {cellId:ids[4],cellType:'INPUT',config:{name:'region',inputType:'TEXT_INPUT',outputType:'STRING'}},
  {cellId:ids[5],cellType:'TEXT',config:{richText:[{type:'paragraph',children:[{text:'*Quoted emphasis* and &ordinary text'}]}]}},
 ],dataAppCellIds:[ids[1]],appLayout:{fullWidth:true,tabs:[{name:'Original app',rows:[{columns:[{start:0,end:120,elements:[{type:'CELL',cellId:ids[4]},{type:'CELL',cellId:ids[3]},{type:'CELL',cellId:missing}]}]}]}]}}
 const original=Buffer.from('\ufeff'+dump(root,{noRefs:true,lineWidth:-1}),'utf8'),filename='synthetic-bifocal-hex.hex.yaml'
 const inputFor=(bytes=original)=>({version:1,projectId:id,source:'hex',format:'hex-yaml',filename,base64:bytes.toString('base64'),cutoff:'2026-11-04T07:00:00Z',rollbackPlan:'Keep the incumbent active until independently reconciled and explicitly approved.'})
 const post=async(action,data,status=200)=>{const response=await context.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(response.status(),status,await response.text());return response.json()}
 const refusedUploads=[]
 const upload=async(bytes,expected=200)=>{
  const payload=Buffer.from(JSON.stringify(inputFor(bytes))),hash=createHash('sha256').update(payload).digest('hex'),chunks=Math.ceil(payload.length/65536);let result
  if(expected===422)refusedUploads.push(hash)
  for(let index=0;index<chunks;index++){const chunk=payload.subarray(index*65536,(index+1)*65536);result=await post('uploads',{...(result?{uploadId:result.uploadId}:{}),name:'hex-project.json',bundleSha256:hash,totalBytes:payload.length,totalChunks:chunks,index,chunkSha256:createHash('sha256').update(chunk).digest('hex'),base64:chunk.toString('base64')},index===chunks-1?expected:200)}
  return result
 }
 const prepare=async(bytes,catchup=true)=>{const u=await upload(bytes);return post('plan',{uploadId:u.uploadId,...catchup?{catchup:true}:{}})}
 const apply=async plan=>{for(let i=0;i<20;i++)if((await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})).job.state==='completed'){assert.equal((await post('reconcile',{planId:plan.planId})).ok,true);return}assert.fail('Hex inventory apply did not complete')}
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/import');await page.locator('#hex-import > summary').click()
 const form=page.locator('#hex-import-form');await form.getByLabel('Migration project ID',{exact:true}).fill(id);await form.getByLabel('Reviewed cutoff (UTC)',{exact:true}).fill('2026-11-04T07:00:00Z')
 const browserPrepare=async bytes=>{
  await form.getByLabel('Hex original file',{exact:true}).setInputFiles({name:filename,mimeType:'application'+'/octet-stream',buffer:bytes})
  const response=page.waitForResponse(r=>r.url().endsWith('/api/operator/import/plan'))
  await form.getByRole('button',{name:'Preview Hex import',exact:true}).click();const result=await response;assert.equal(result.status(),200,await result.text());const plan=await result.json();await page.locator('#hex-status').filter({hasText:'Hex review ready'}).waitFor();return plan
 }
 let plan=await browserPrepare(original)
 assert.equal(plan.counts.rejected,0);assert.deepEqual(plan.project.hex.cellOrder,ids)
 assert.deepEqual(plan.project.hex.layoutReferences,[{location:'/appLayout/tabs/0/rows/0/columns/0/elements/0/cellId',cellId:ids[4]},{location:'/appLayout/tabs/0/rows/0/columns/0/elements/1/cellId',cellId:ids[3]},{location:'/appLayout/tabs/0/rows/0/columns/0/elements/2/cellId',cellId:missing},{location:'/dataAppCellIds/0',cellId:ids[1]}])
 assert.deepEqual(plan.project.items.filter(item=>item.source.kind==='cell').map(item=>JSON.parse(item.source.original).cellType).sort(),['CHART','CODE','INPUT','MARKDOWN','SQL','TEXT'])
 assert.equal(plan.project.hex.sourceVersionId,'20000000-0000-4000-8000-000000000001');assert.equal(plan.project.hex.schema.version,3)
 assert.equal(plan.project.hex.sha256,createHash('sha256').update(original).digest('hex'));assert.equal(plan.project.hex.execution,'disabled');assert.equal(plan.project.hex.dependencies,'incomplete');assert.equal(plan.project.hex.outputs,'unverified')
 for(const [code,location]of [['missing_referenced_cell','/appLayout/tabs/0/rows/0/columns/0/elements/2/cellId'],['unsupported_package','/cells/1/config/source:line-1'],['dynamic_dependencies_unresolved','/cells/1/config/source'],['inactive_asset_reference','/projectAssets/envVars/0']])assert.ok(plan.project.hex.issues.some(issue=>issue.code===code&&issue.location===location&&issue.remediation.length>25),code)
 assert.ok(JSON.parse(plan.project.items.find(item=>item.source.id==='hex-project').source.original).sharedAssets.secrets[0].secretName)
 assert.equal(await page.locator('#hex-plan table').first().locator('tbody tr').count(),6)
 let executed=0;const watch=request=>{if(new URL(request.url()).pathname==='/__hex-executed')executed++};page.on('request',watch)
 assert.equal(await page.evaluate(()=>globalThis.syntheticHexExecuted),undefined)
 const capture=async label=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' desktop overflow')
  assert.ok((await page.locator('#hex-import button').allTextContents()).every(text=>text.trim()))
  if(process.env.BIFOCAL_PROOF_DIR){for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('#hex-import').screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png')});}await page.setViewportSize({width:1440,height:1000})}
 }
 await capture('hex-original-review')
 await post('apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},403)
 await page.locator('#hex-approve').check();await page.getByRole('button',{name:'Apply Hex inventory',exact:true}).click();await page.locator('#hex-status').filter({hasText:'Hex inventory applied and reconciled'}).waitFor().catch(async error=>{throw Error(error.message+'; Hex browser status: '+await page.locator('#hex-status').innerText())})
 let current=await call(base);assert.equal(current.grants,'none');assert.equal(current.dispatch,'unavailable');assert.deepEqual(current.hex.cellOrder,ids)
 const first=current,firstPlan=plan
 const retained=await context.request.get(origin+'/api/operator/import/original/'+plan.planId,{headers});assert.equal(retained.status(),200)
 const envelope=JSON.parse(Buffer.from((await retained.json()).originals[0].original.base64,'base64').toString('utf8'));assert.deepEqual(Buffer.from(envelope.base64,'base64'),original)
 // A plain source delta has exact prior-state Undo; a delta incorporating native edits must refuse destructive Undo.
 const plain=structuredClone(root);plain.meta.sourceVersionId='20000000-0000-4000-8000-000000000002';plain.cells[0].config.source='select net_amount from sales'
 const plainPlan=await prepare(Buffer.from(dump(plain)));await apply(plainPlan);assert.equal((await call(base)).items.find(item=>item.source.id==='cell-'+ids[0]).native.includes('net_amount'),true)
 await post('undo',{planId:plainPlan.planId});current=await call(base);assert.equal(current.revision,first.revision);assert.deepEqual(current.items,first.items);assert.deepEqual(current.hex,first.hex)
 const editor=page.locator('#hex-edit');await editor.getByLabel('Inventory item',{exact:true}).selectOption('cell-'+ids[0]);await editor.getByLabel('Inactive native reconstruction',{exact:true}).fill('Native reviewed sum(net_amount)');await editor.getByRole('button',{name:'Save native reconstruction',exact:true}).click();await page.locator('#hex-status').filter({hasText:'Inactive native reconstruction saved'}).waitFor()
 const edited=await call(base);await call(base+'/edit',{reviewedRevision:first.revision,itemId:'cell-'+ids[0],native:'stale'},409)
 const delta=structuredClone(plain);delta.meta.sourceVersionId='20000000-0000-4000-8000-000000000003';delta.cells.unshift({cellId:'00000000-0000-4000-8000-000000000007',cellType:'MARKDOWN',config:{source:'New version cell'}})
 const deltaBytes=Buffer.from(dump(delta)),stale=await prepare(deltaBytes);assert.equal(stale.counts.rejected,0,JSON.stringify(stale.rejected))
 await call(base+'/edit',{reviewedRevision:edited.revision,itemId:'cell-'+ids[0],native:'Native reviewed sum(net_amount)-returns'},200)
 const beforeStale=await call(base);await post('apply',{planId:stale.planId,reviewedFingerprint:stale.fingerprint},409);assert.deepEqual(await call(base),beforeStale)
 plan=await browserPrepare(deltaBytes);assert.ok(plan.project.items.find(item=>item.source.id==='cell-'+ids[0]).conflict)
 await page.locator('#hex-approve').check();await page.getByRole('button',{name:'Apply Hex inventory',exact:true}).click();await page.locator('#hex-status').filter({hasText:'Hex inventory applied and reconciled'}).waitFor().catch(async error=>{throw Error(error.message+'; Hex browser status: '+await page.locator('#hex-status').innerText())})
 current=await call(base);assert.deepEqual(current.hex.cellOrder,['00000000-0000-4000-8000-000000000007',...ids]);assert.equal(current.items.filter(item=>item.source.kind==='cell').length,7)
 const conflicting=current.items.find(item=>item.source.id==='cell-'+ids[0]);assert.equal(conflicting.native,'Native reviewed sum(net_amount)-returns');assert.equal(JSON.parse(conflicting.source.original).config.source,'select amount from sales where region = {{ region }}');assert.equal(JSON.parse(conflicting.conflict.original).config.source,'select net_amount from sales')
 await post('undo',{planId:plan.planId},409);assert.deepEqual(await call(base),current)
 await capture('hex-native-conflict')
 const replay=await prepare(deltaBytes);await apply(replay);assert.deepEqual(await call(base),current)
 await editor.getByLabel('Inventory item',{exact:true}).selectOption('cell-'+ids[0]);await page.getByRole('button',{name:'Keep native conflict',exact:true}).click();await page.locator('#hex-status').filter({hasText:'Reviewed conflict resolved'}).waitFor().catch(async error=>{throw Error(error.message+'; Hex browser status: '+await page.locator('#hex-status').innerText())})
 current=await call(base);assert.equal(current.items.find(item=>item.source.id==='cell-'+ids[0]).native,'Native reviewed sum(net_amount)-returns');assert.equal(current.items.find(item=>item.source.id==='cell-'+ids[0]).conflict,null)
 const history=current.history
 assert.ok(history.some(entry=>entry.action==='edit'));const prior=await call(base+'/versions/'+first.revision);assert.deepEqual(prior.value.hex,first.hex)
 const unknown=structuredClone(root);unknown.cells[1].cellType='WRITEBACK';unknown.cells[1].config={source:'inert unsupported code',retainedOutput:{status:'COMPLETED',rows:[17]}}
 const unsupportedId='synthetic-bifocal-hex-unsupported',savedId=headers['X-Import-Dataset'];headers['X-Import-Dataset']=unsupportedId
 const unsupportedPayload={...inputFor(Buffer.from(dump(unknown))),projectId:unsupportedId},unsupportedBytes=Buffer.from(JSON.stringify(unsupportedPayload)),uh=createHash('sha256').update(unsupportedBytes).digest('hex')
 const u=await post('uploads',{name:'hex-project.json',bundleSha256:uh,totalBytes:unsupportedBytes.length,totalChunks:1,index:0,chunkSha256:uh,base64:unsupportedBytes.toString('base64')}),unsupported=await post('plan',{uploadId:u.uploadId})
 assert.ok(unsupported.project.hex.issues.some(issue=>issue.code==='unsupported_cell_type'&&issue.location==='/cells/1/cellType'));assert.equal(unsupported.project.hex.outputs,'unverified');await post('undo',{planId:unsupported.planId});headers['X-Import-Dataset']=savedId
 // Credential fields, source literals, environment name and value pairs, percent escapes and large refused uploads leave no secret in custody.
 const secrets=['synthetic-bifocal-701','synthetic-bifocal-702','synthetic-bifocal-703','synthetic-bifocal-704']
 const planted=[]
 for(let i=0;i<4;i++){const source=structuredClone(root);if(i===0)source.projectAssets.dataConnections[0].password=secrets[i];if(i===1)source.cells[1].config.source='api_key = "'+secrets[i]+'"';if(i===2)source.projectAssets.envVars=[{name:'ACCESS_TOKEN',value:secrets[i]}];if(i===3)source.cells[2].config.source='authorization%3D%22'+secrets[i]+'%22';planted.push(Buffer.from(dump(source)))}
 // Exercise credential names carried as data and literal URLs embedded in both source and prose.
 for(const name of ['PASSPHRASE','AUTHORIZATION']){
  const source=structuredClone(root),credential='synthetic-bifocal-'+(705+secrets.length);secrets.push(credential)
  source.projectAssets.envVars=[{name,value:credential}];planted.push(Buffer.from(dump(source)))
 }
 for(const cellType of ['CODE','MARKDOWN'])for(const queryName of ['api_key','api-key','%61pi%5fkey']){
  const source=structuredClone(root),credential='synthetic-bifocal-'+(705+secrets.length);secrets.push(credential)
  const address='https://example.test/data?'+queryName+'='+credential
  source.cells[cellType==='CODE'?1:2].config.source=cellType==='CODE'?'response = fetch("'+address+'")':'[Source data]('+address+')'
  planted.push(Buffer.from(dump(source)))
 }
 planted[0]=Buffer.concat([planted[0],Buffer.from('\n# '+'synthetic-bifocal-padding '.repeat(3500))])
 for(const bytes of planted){const refusal=await upload(bytes,422);assert.equal(refusal.error,'migration_secret_refused');for(const credential of secrets)assert.ok(!JSON.stringify(refusal).includes(credential));assert.deepEqual(await call(base),current)}
 await call(base+'/edit',{reviewedRevision:current.revision,itemId:'cell-'+ids[0],native:'password = "'+secrets[0]+'"'},422);assert.deepEqual(await call(base),current)
 // Scalar stars remain safe, while actual YAML graphs and executable tags remain refused.
 for(const suffix of ['\nsharedFilters: &synthetic-bifocal [*synthetic-bifocal]\n','\nsharedFilters: &synthetic-bifocal []\n','\nsharedFilters: !!js'+'/'+'function function() {}\n']){
  const refusal=await upload(Buffer.concat([original,Buffer.from(suffix)]),422);assert.equal(refusal.error,'hex_yaml_required');assert.deepEqual(await call(base),current)
 }

 const files=await readdir(persist,{recursive:true}),sqlite=files.filter(file=>file.endsWith('.sqlite'))
 let inspected=false;const custodyDatabases=[]
 for(const file of sqlite){const db=new DatabaseSync(join(persist,file),{readOnly:true});try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='ik_door_uploads'").get())continue;inspected=true;custodyDatabases.push(file)
  for(const hash of refusedUploads){
   assert.equal(db.prepare('SELECT count(*) AS n FROM ik_door_uploads WHERE bundle_sha256=?').get(hash).n,0,'Refused upload metadata purged')
   assert.equal(db.prepare('SELECT count(*) AS n FROM ik_door_plans WHERE bundle_sha256=?').get(hash).n,0,'Refused original cannot enter retained plan history')
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM ik_door_chunks c LEFT JOIN ik_door_uploads u ON c.upload_id=u.id WHERE u.id IS NULL').get().n,0,'No orphan refused upload chunks remain')
  for(const {name:table} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'ik_%' OR name LIKE 'bf_migration_%')").all()){
   if(!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table))continue
   for(const row of db.prepare('SELECT * FROM '+table).all())for(const value of Object.values(row))if(typeof value==='string'){
    let decoded=/^[A-Za-z0-9+/=]+$/.test(value)?Buffer.from(value,'base64').toString('utf8'):value
    try{const envelope=JSON.parse(decoded);if(envelope.format==='hex-yaml'&&typeof envelope.base64==='string')decoded+='\n'+Buffer.from(envelope.base64,'base64').toString('utf8')}catch{}
    for(const secret of secrets){assert.ok(!value.includes(secret),table+' has no plaintext credential');assert.ok(!decoded.includes(secret),table+' has no encoded credential')}
    if(table==='ik_door_chunks')for(const secret of secrets)assert.ok(!decoded.includes(Buffer.from(secret).toString('base64')),'No refused original envelope remains')
   }
  }
 }finally{db.close()}}
 assert.equal(inspected,true,'Inspect the real retained-custody database')
 assert.equal((await fetch(origin+'/api/operator'+base)).status,401)
 const member=await context.browser().newContext()
 try{
  const memberAddress=['synthetic-bifocal-migration-member','example.test'].join('@')
  const entered=await member.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(memberAddress),{headers:{'x-rer-dev-key':'synthetic-bifocal-9'.repeat(3)},maxRedirects:0});assert.equal(entered.status(),303)
  for(const path of [base,base+'/versions/'+first.revision])assert.equal((await member.request.get(origin+'/api/operator'+path)).status(),401)
  assert.equal((await member.request.post(origin+'/api/operator/import/apply',{headers,data:{planId:plan.planId,reviewedFingerprint:plan.fingerprint}})).status(),401)
  assert.equal((await member.request.post(origin+'/api/operator'+base+'/erase',{headers:{Origin:origin},data:{confirmImport:id,reviewedRevision:current.revision}})).status(),401)
 }finally{await member.close()}
 for(const path of [base,base+'/versions/'+first.revision])assert.equal((await context.request.get(origin+'/api/operator'+path,{headers:{Authorization:'Bearer '+'synthetic-bifocal-machine'}})).status(),403)
 for(const action of ['edit','resolve','erase'])assert.equal((await context.request.post(origin+'/api/operator'+base+'/'+action,{headers:{Origin:origin,Authorization:'Bearer '+'synthetic-bifocal-machine'},data:{}})).status(),403)
 assert.equal((await context.request.post(origin+'/api/operator/import/apply',{headers:{...headers,Authorization:'Bearer '+'synthetic-bifocal-machine'},data:{planId:plan.planId,reviewedFingerprint:plan.fingerprint}})).status(),403)
 assert.equal((await context.request.post(origin+'/api/operator'+base+'/edit',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{reviewedRevision:current.revision,itemId:'cell-'+ids[0],native:'foreign'}})).status(),401)
 assert.deepEqual(await call(base),current);assert.equal(executed,0);assert.equal(await page.evaluate(()=>globalThis.syntheticHexExecuted),undefined);page.off('request',watch)
 await form.getByRole('button',{name:'Load migration project',exact:true}).click();await page.locator('#hex-status').filter({hasText:'Migration project loaded'}).waitFor();await page.getByText('Erase a Hex migration project',{exact:true}).click();await page.getByLabel('Type migration project ID',{exact:true}).fill(id);await page.getByRole('button',{name:'Erase migration project',exact:true}).click();await page.locator('#hex-status').filter({hasText:'Migration project, originals and reconstruction history erased'}).waitFor()
 await call(base,undefined,404);await call(base+'/versions/'+first.revision,undefined,404)
 for(const planId of [firstPlan.planId,plan.planId,plainPlan.planId]){const response=await context.request.get(origin+'/api/operator/import/original/'+planId,{headers});assert.equal(response.status(),200);const originals=(await response.json()).originals;assert.equal(originals[0].original.status,'unavailable');assert.equal(originals[0].original.base64,undefined)}
 await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410);await post('undo',{planId:firstPlan.planId},410)
 for(const file of custodyDatabases){const db=new DatabaseSync(join(persist,file),{readOnly:true});try{for(const table of ['bf_migration_projects','bf_migration_workspaces','bf_migration_project_edits']){const key=table==='bf_migration_project_edits'?'project_id':'id';assert.equal(db.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+key+'=?').get(id).n,0)}}finally{db.close()}}
 console.log('PROBE BIF-049 original intake: browser /app/import -> six ordered cell definitions, exact original bytes and schema and source version identifiers retained inactive')
 console.log('PROBE BIF-049 diagnostics: missing layout reference, Python packages and dynamic dependencies -> exact source locations and concrete unresolved tasks; stored outputs unverified')
 console.log('PROBE BIF-049 deltas: stable IDs, stale approval and conflicting native edits -> preserved native definition; plain source Undo restores exact prior inventory')
 console.log('PROBE A safe intake: /app/import with Python [*values], Markdown emphasis and quoted rich text -> reviewed and applied; exact original bytes downloadable; actual YAML graphs refused')
 console.log('PROBE B environment refusal: import uploads with nonempty PASSPHRASE and AUTHORIZATION -> 422 migration_secret_refused, upload copies purged, unchanged retained project and no persisted credentials')
 console.log('PROBE B literal refusal: import uploads with API-key URLs embedded in Python and Markdown -> 422 migration_secret_refused, upload copies purged, redacted diagnostics and unchanged retained project')
 console.log('PROBE BIF-049 authority and erasure: member, machine and foreign requests refused; eligible erasure withdraws originals, project and history; replay is 410')
}
