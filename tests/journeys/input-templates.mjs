import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

/** Extend the existing input journey through browser and authenticated HTTP doors. */
export async function proveInputTemplates({origin,context,page,call,definition,source,owner,shot}) {
 const root=origin+'/api/operator',headers={Origin:origin},states=[],erasedValues=[]
 const unchangedSource=async()=>assert.deepEqual(await call('/datasets/'+definition.dataset),source,'Typed analytical inputs preserve the exact observed source')
 const attributed=state=>{
  for(const entry of [...state.history,...state.schemaHistory]){
   assert.equal(entry.actorId,owner.id);assert.equal(entry.actorName,owner.displayName)
   assert.match(entry.recordedAt,/^\d{4}-\d{2}-\d{2}T/)
  }
  for(const entry of state.history)assert.ok(state.schemaHistory.some(schema=>schema.version===entry.schemaVersion),'Row history identifies a retained column definition')
 }
 const row=state=>state.rows[0]
 const assertState=(state,values,adjusted)=>{
  assert.equal(state.rows.length,1);assert.equal(row(state).observed,'100.00')
  assert.equal(row(state).adjusted,adjusted);assert.deepEqual(row(state).values,values)
  assert.deepEqual(state.columns,state.schema.columns);attributed(state)
 }
 const browserCreate=async(template,name)=>{
  const id='synthetic-bifocal-'+template,path='/inputs/'+id,before=await call('/inputs')
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/inputs')
  for(const [label,value] of Object.entries({'Input table ID':id,'Table name':name,'Dataset ID':definition.dataset,'Reviewed source revision':source.revision,'Source key column':definition.keyColumn,'Region column':definition.regionColumn,'Allowed region':definition.region,'Observed USD column':definition.observedColumn}))await page.getByLabel(label,{exact:true}).fill(value)
  await page.getByLabel('Input template',{exact:true}).selectOption(template)
  await page.getByRole('button',{name:'Review input table',exact:true}).click()
  assert.deepEqual(await call('/inputs'),before,'A browser review cannot persist a table')
  const reviewText=await page.locator('body').innerText()
  for(const value of [definition.dataset,source.revision,definition.keyColumn,definition.regionColumn,definition.region,definition.observedColumn,template])assert.ok(reviewText.includes(value),'Review exposes exact source binding and selected template')
  await shot(template+'-review',1440)
  await page.getByRole('button',{name:'Create input table',exact:true}).click();await page.waitForURL(origin+'/app'+path)
  const state=await call(path)
  assert.equal(state.schema.template,template);assert.equal(state.schemaHistory.length,1)
  assert.deepEqual(row(state).values,null);assert.equal(row(state).observed,'100.00');assert.equal(row(state).adjusted,'100.00')
  attributed(state);await shot(template+'-empty',1440)
  return {path,state}
 }
 const browserEdit=async(path,values,labels,button,screen)=>{
  await page.goto(origin+'/app'+path)
  for(const [name,label] of Object.entries(labels)){
   const control=page.getByLabel(label,{exact:true})
   if(typeof values[name]==='boolean')await control.selectOption(String(values[name]))
   else await control.fill(values[name])
  }
  await page.getByRole('button',{name:button,exact:true}).click();await page.waitForURL(origin+'/app'+path)
  const state=await call(path)
  assert.deepEqual(row(state).values,values);await shot(screen,1440);await unchangedSource()
  return state
 }
 const common={note:'Target planning note',effectiveOn:'2026-10-02',active:true}
 const target=await browserCreate('light-target','West operating target')
 assert.deepEqual(target.state.columns.map(c=>c.name),['target','note','effectiveOn','active'])
 const targetLabels={target:'Target (USD)',note:'Reason',effectiveOn:'Effective date',active:'Apply target'}
 let targetValues={target:'150.00',...common}
 target.state=await browserEdit(target.path,targetValues,targetLabels,'Save target','target-saved')
 assertState(target.state,targetValues,'100.00');assert.equal(row(target.state).target,'150.00');assert.equal(row(target.state).targetVariance,'50.00')
 targetValues={...targetValues,target:'175.25',note:'Revised target note'}
 target.state=await browserEdit(target.path,targetValues,targetLabels,'Save target','target-edited')
 assertState(target.state,targetValues,'100.00');assert.equal(row(target.state).target,'175.25');assert.equal(row(target.state).targetVariance,'75.25')
 assert.equal(target.state.history[0].before.target,'150.00');assert.equal(target.state.history[0].after.target,'175.25')
 states.push([target.path,target.state]);erasedValues.push(common.note,targetValues.note,'150.00','175.25')

 const note=await browserCreate('note-only','West regional commentary')
 assert.deepEqual(note.state.columns.map(c=>c.name),['note']);assert.equal(note.state.schema.effect,null)
 let noteValues={note:'Regional context note'}
 note.state=await browserEdit(note.path,noteValues,{note:'Note'},'Save note','note-saved')
 assertState(note.state,noteValues,'100.00')
 noteValues={note:'Reviewed regional context'}
 note.state=await browserEdit(note.path,noteValues,{note:'Note'},'Save note','note-edited')
 assertState(note.state,noteValues,'100.00')
 const previous=note.state,revised=structuredClone(previous.schema)
 revised.columns[0].label='Regional explanation';revised.columns[0].maxLength=80
 const schemaInput={previousSchemaRevision:previous.schemaRevision,schema:revised}
 await call(note.path+'/schema',schemaInput,409)
 const schemaReview=await call(note.path+'/schema/review',schemaInput)
 assert.deepEqual(await call(note.path),previous,'Reviewing a column revision cannot mutate data or history')
 const tampered=structuredClone(revised);tampered.columns[0].label='Unreviewed label'
 await call(note.path+'/schema',{...schemaInput,schema:tampered,reviewedDigest:schemaReview.digest},409)
 const incompatible=[]
 const renamed=structuredClone(revised);renamed.columns[0].name='renamed';incompatible.push(renamed)
 const changedType=structuredClone(revised);changedType.columns[0]={name:'note',label:'Note',type:'date'};incompatible.push(changedType)
 const tooShort=structuredClone(revised);tooShort.columns[0].maxLength=5;incompatible.push(tooShort)
 const changedEffect=structuredClone(revised);changedEffect.effect={kind:'adjustment',column:'note',activeColumn:'note'};incompatible.push(changedEffect)
 for(const schema of incompatible){
  const response=await context.request.post(root+note.path+'/schema/review',{headers,data:{...schemaInput,schema}})
  assert.ok([400,409].includes(response.status()),await response.text())
 }
 assert.deepEqual(await call(note.path),previous,'Incompatible schemas never mutate saved values or schema history')
 await page.goto(origin+'/app'+note.path)
 const schemaSection=page.locator('details').filter({has:page.getByLabel('Revised column definition (JSON)',{exact:true})})
 if(await schemaSection.count())await schemaSection.locator(':scope > summary').click()
 await page.getByLabel('Revised column definition (JSON)',{exact:true}).fill(JSON.stringify(revised))
 await page.getByRole('button',{name:'Review column definition',exact:true}).click()
 assert.deepEqual(await call(note.path),previous,'Browser schema review is read-only')
 await shot('note-schema-review',1440)
 await page.getByRole('button',{name:'Save column definition',exact:true}).click();await page.waitForURL(origin+'/app'+note.path)
 note.state=await call(note.path)
 assert.deepEqual(note.state.schema,revised);assert.notEqual(note.state.schemaRevision,previous.schemaRevision)
 assert.deepEqual(row(note.state),row(previous));assert.deepEqual(note.state.history,previous.history)
 assert.equal(note.state.schemaHistory.length,2);assert.deepEqual(note.state.schemaHistory.map(h=>h.schema),[previous.schema,revised])
 assert.deepEqual(note.state.schemaHistory.map(h=>h.revision),[previous.schemaRevision,note.state.schemaRevision]);attributed(note.state)
 const stale=await call(note.path+'/rows',{rowKey:'1',previousVersion:2,schemaRevision:previous.schemaRevision,note:'Stale schema edit'},409)
 assert.equal(stale.error,'schema_changed');assert.deepEqual(await call(note.path),note.state)
 await call(note.path+'/schema/review',schemaInput,409)
 await call(note.path+'/schema',{...schemaInput,reviewedDigest:schemaReview.digest},409)
 noteValues={note:'Fresh definition regional note'}
 note.state=await browserEdit(note.path,noteValues,{note:'Regional explanation'},'Save note','note-revised-edited')
 assertState(note.state,noteValues,'100.00');assert.equal(note.state.history[0].schemaVersion,note.state.schemaVersion)
 states.push([note.path,note.state]);erasedValues.push('Regional context note','Reviewed regional context',noteValues.note,'Regional explanation')

 const correction=await browserCreate('analytical-correction','West analytical correction')
 assert.deepEqual(correction.state.columns.map(c=>c.name),['correction','note','effectiveOn','active'])
 const correctionLabels={correction:'Correction (USD)',note:'Reason',effectiveOn:'Effective date',active:'Apply correction'}
 let correctionValues={correction:'-2.50',note:'Correction source explanation',effectiveOn:'2026-02-28',active:true}
 correction.state=await browserEdit(correction.path,correctionValues,correctionLabels,'Save correction','correction-saved')
 assertState(correction.state,correctionValues,'97.50')
 correctionValues={...correctionValues,correction:'3.25',note:'Reviewed correction explanation'}
 correction.state=await browserEdit(correction.path,correctionValues,correctionLabels,'Save correction','correction-edited')
 assertState(correction.state,correctionValues,'103.25')
 assert.equal(correction.state.history[0].before.correction,'-2.50');assert.equal(correction.state.history[0].after.correction,'3.25')
 states.push([correction.path,correction.state]);erasedValues.push('Correction source explanation',correctionValues.note,'-2.50','3.25')

 const customSchema={format:1,template:'custom',columns:[{name:'budget',label:'Budget (USD)',type:'money',currency:'USD',scale:2},{name:'memo',label:'Scoped memo',type:'text',maxLength:16},{name:'dueOn',label:'Due date',type:'date'},{name:'approved',label:'Approved',type:'boolean'}],effect:null}
 const customDefinition={id:'synthetic-bifocal-custom',name:'West bounded custom input',...definition,template:'custom',schema:customSchema}
 const beforeCustom=await call('/inputs')
 const invalidSchemas=[null,[],{...customSchema,format:2},{...customSchema,columns:[]},
  {...customSchema,columns:[{name:'memo',label:'Memo',type:'integer'}]},
  {...customSchema,columns:[{...customSchema.columns[0],currency:'EUR'}]},
  {...customSchema,columns:[{...customSchema.columns[0],scale:3}]},
  {...customSchema,columns:[{...customSchema.columns[1],maxLength:0}]},
  {...customSchema,columns:[{...customSchema.columns[1],label:''}]},
  {...customSchema,columns:[{name:'observed',label:'Observed',type:'text',maxLength:16}]},
  {...customSchema,columns:[customSchema.columns[1],customSchema.columns[1]]},
  {...customSchema,columns:Array.from({length:25},(_,n)=>({name:'column'+n,label:'Column '+n,type:'text',maxLength:16}))}]
 for(const schema of invalidSchemas)await call('/inputs/review',{...customDefinition,schema},400)
 const {schema:unusedSchema,...customForm}=customDefinition
 const malformed=await context.request.post(root+'/inputs/review',{headers,form:{...customForm,schemaJson:'{malformed'}})
 assert.equal(malformed.status(),400)
 const reviewed=await call('/inputs/review',customDefinition)
 assert.deepEqual(reviewed.schema,customSchema);assert.deepEqual(await call('/inputs'),beforeCustom)
 const changed=structuredClone(customSchema);changed.columns[1].maxLength=17
 await call('/inputs',{...customDefinition,schema:changed,reviewedDigest:reviewed.digest},409)
 await call('/inputs',{...customDefinition,region:'East',reviewedDigest:reviewed.digest},409)
 await call('/inputs',customDefinition,409)
 assert.deepEqual(await call('/inputs'),beforeCustom,'Unreviewed or changed definitions cannot create tables')
 await call('/inputs',{...customDefinition,reviewedDigest:reviewed.digest},201)
 const customPath='/inputs/'+customDefinition.id
 let custom=await call(customPath)
 const valid={rowKey:'1',previousVersion:0,schemaRevision:custom.schemaRevision,budget:'-0.00',memo:'Scoped memo',dueOn:'2024-02-29',approved:true}
 for(const invalid of [{budget:'100000000000000.00'},{budget:'1e2'},{budget:100},{budget:'1.001'},{memo:'x'.repeat(17)},{memo:'  '},{memo:123},{dueOn:'2026-02-29'},{dueOn:'2026-13-01'},{dueOn:'2026-2-01'},{approved:'true'},{approved:'false'},{approved:1},{extra:true},{region:'East'},{sourceRevision:'changed'}])await call(customPath+'/rows',{...valid,...invalid},400)
 for(const field of ['budget','memo','dueOn','approved','schemaRevision']){
  const missing={...valid};delete missing[field];await call(customPath+'/rows',missing,400)
 }
 assert.deepEqual(await call(customPath),custom,'Invalid typed rows cannot create values or audit history')
 await call(customPath+'/rows',valid)
 custom=await call(customPath)
 const normalized={budget:'0.00',memo:valid.memo,dueOn:valid.dueOn,approved:true}
 assertState(custom,normalized,'100.00');assert.deepEqual(custom.history[0].after,normalized)
 const edited={...normalized,budget:'12.50',memo:'Edited memo',approved:false}
 custom=await browserEdit(customPath,edited,{budget:'Budget (USD)',memo:'Scoped memo',dueOn:'Due date',approved:'Approved'},'Save values','custom-saved')
 assertState(custom,edited,'100.00')
 assert.deepEqual(custom.history[0].before,normalized);assert.deepEqual(custom.history[0].after,edited)
 await unchangedSource();states.push([customPath,custom]);erasedValues.push(valid.memo,edited.memo,'12.50')
 return {states,erasedValues}
}

/** Public mutations scheduled immediately before the real input transaction. */
export async function proveInputCommitFences({origin,context,call,owner,environment,inspect}) {
 const headers={Origin:origin},dataset='synthetic-bifocal-input-fences',id='synthetic-bifocal-fenced-input',path='/inputs/'+id
 const importing=async(action,data,status=200,sourceId=dataset)=>{
  const response=await context.request.post(origin+'/api/operator/import/'+action,{headers:{...headers,'X-Import-Dataset':sourceId},data})
  assert.equal(response.status(),status,await response.text());return response.json()
 }
 const importSource=async sourceId=>{
  const bytes=Buffer.from(JSON.stringify({version:1,datasetId:sourceId,filename:'synthetic-bifocal-2.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:'id',formulaTreatment:'literal-text',data:'id,region,amount\n1,West,$100.00\n2,East,$250.00\n'}))
  const digest=createHash('sha256').update(bytes).digest('hex')
  const upload=await importing('uploads',{name:'synthetic-bifocal-2.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')},200,sourceId)
  const plan=await importing('plan',{uploadId:upload.uploadId},200,sourceId)
  for(let n=0;n<20;n++)if((await importing('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},200,sourceId)).job.state==='completed')return plan
  assert.fail('Input fence source import did not complete')
 }
 const plan=await importSource(dataset)
 const source=await call('/datasets/'+dataset)
 const definition={id,name:'Fenced regional inputs',dataset,sourceRevision:source.revision,keyColumn:'id',regionColumn:'region',region:'West',observedColumn:'amount'}
 const review=await call('/inputs/review',definition)
 await call('/inputs',{...definition,reviewedDigest:review.digest},201)
 let state=await call(path)
 const values={adjustment:'25.50',note:'Retained fence explanation',effectiveOn:'2026-10-01',active:true}
 const edit=(snapshot,extra={})=>({rowKey:'1',previousVersion:snapshot.rows[0].version,schemaRevision:snapshot.schemaRevision,...values,...extra})
 await call(path+'/rows',edit(state));state=await call(path)
 assert.equal(state.rows[0].adjusted,'125.50');assert.equal(state.historyCount,1)
 const arm=async(at,before,mutation)=>{
  const cookie=(await context.cookies(origin)).map(c=>c.name+'='+c.value).join('; ')
  const response=await context.request.post(origin+'/__entitlement-boundary',{data:{at:'/api/operator'+at,before,cookie,...mutation}})
  assert.equal(response.status(),200,await response.text())
 }
 const revise=async snapshot=>{
  const schema=structuredClone(snapshot.schema);schema.columns.find(c=>c.name==='note').label='Reviewed explanation'
  const input={previousSchemaRevision:snapshot.schemaRevision,schema}
  return {...input,reviewedDigest:(await call(path+'/schema/review',input)).digest}
 }
 // A row accepted during schema approval invalidates the exact reviewed rows.
 const schemaInput=await revise(state),rival=edit(state,{adjustment:'40.00',note:'Winning regional edit'})
 await arm(path+'/schema','UPDATE bf_input_tables',{path:'/api/operator'+path+'/rows',body:rival})
 await call(path+'/schema',schemaInput,409)
 let changed=await call(path)
 assert.equal(changed.rows[0].adjusted,'140.00');assert.equal(changed.historyCount,2)
 assert.deepEqual(changed.schemaHistory,state.schemaHistory)
 assert.deepEqual(changed.history[0].before,state.rows[0].values)
 assert.equal(changed.history[0].after.adjustment,'40.00')
 state=changed
 // Conversely, a committed column definition invalidates an already-admitted row edit.
 const approved=await revise(state)
 await arm(path+'/rows','INSERT INTO bf_input_rows',{path:'/api/operator'+path+'/schema',body:approved})
 await call(path+'/rows',edit(state,{adjustment:'80.00'}),409)
 changed=await call(path)
 assert.deepEqual(changed.rows,state.rows);assert.deepEqual(changed.history,state.history)
 assert.equal(changed.schemaVersion,state.schemaVersion+1);assert.deepEqual(changed.schema,approved.schema)
 state=changed
 // A conflicting writer wins once; the stale request cannot overwrite its value or audit.
 await arm(path+'/rows','INSERT INTO bf_input_rows',{path:'/api/operator'+path+'/rows',body:edit(state,{adjustment:'10.00'})})
 await call(path+'/rows',edit(state,{adjustment:'90.00'}),409)
 changed=await call(path)
 assert.equal(changed.rows[0].adjusted,'110.00');assert.equal(changed.historyCount,state.historyCount+1)
 assert.equal(changed.history[0].actorId,owner.id);assert.equal(changed.history[0].after.adjustment,'10.00')
 state=changed
 // Admission is not authority: revoke a second native session at each input door's final batch.
 const refusedDefinition={...definition,id:'synthetic-bifocal-revoked-input'}
 for(const [route,data,before] of [
  ['/inputs',undefined,'INSERT INTO ik_d1_assertions'],
  [path,undefined,'INSERT INTO ik_d1_assertions'],
  ['/inputs/review',refusedDefinition,'INSERT INTO ik_d1_assertions'],
  ['/inputs',refusedDefinition,'INSERT INTO bf_input_tables'],
  [path+'/rows',edit(state),'INSERT INTO bf_input_rows'],
  [path+'/schema',null,'UPDATE bf_input_tables'],
 ]) {
  const withdrawn=await context.browser().newContext()
  try {
   assert.equal((await withdrawn.request.post(origin+'/__dev/key',{headers,data:{key:environment.RER_DEV_KEY}})).status(),204)
   assert.equal((await withdrawn.request.get(origin+'/auth/dev/enter?as='+encodeURIComponent(owner.email),{maxRedirects:0})).status(),303)
   const session=await (await withdrawn.request.get(origin+'/auth/session')).json()
   const local=async(route,data)=>{
    const response=await withdrawn.request.post(origin+'/api/operator'+route,{headers,data})
    assert.equal(response.status(),200,await response.text());return response.json()
   }
   let body=data
   if(route==='/inputs'&&data)body={...data,reviewedDigest:(await local('/inputs/review',data)).digest}
   if(data===null){
    const schema=structuredClone(state.schema);schema.columns.find(c=>c.name==='note').maxLength=500
    body={previousSchemaRevision:state.schemaRevision,schema}
    body={...body,reviewedDigest:(await local(path+'/schema/review',body)).digest}
   }
   await arm(route,before,{path:'/auth/session/revoke',body:{sessionId:session.id}})
   const response=await withdrawn.request.fetch(origin+'/api/operator'+route,{method:body===undefined?'GET':'POST',headers,...body===undefined?{}:{data:body}})
   assert.equal(response.status(),409,await response.text())
   assert.deepEqual(await response.json(),{error:'input_conflict'},'Revoked input responses contain no values or table metadata')
   assert.equal((await withdrawn.request.get(origin+'/auth/session')).status(),401)
   assert.deepEqual(await call(path),state,'Revocation cannot change input values, column definitions or attributed history')
   assert.deepEqual((await call('/inputs')).tables,[{id,name:definition.name}])
  } finally {await withdrawn.close()}
 }
 assert.deepEqual(await call('/datasets/'+dataset),source,'Every accepted input change preserves source actuals')
 // Erasure wins at the input commit boundary, including removal of its value-bearing histories.
 await arm(path+'/rows','INSERT INTO bf_input_rows',{path:'/api/operator/datasets/'+dataset+'/erase',body:{confirmDataset:dataset,reviewedRevision:source.revision}})
 await call(path+'/rows',edit(state,{adjustment:'99.00'}),409)
 assert.deepEqual((await call('/inputs')).tables,[])
 const erasedCounts=await inspect()
 for(const store of ['bf_input_tables','bf_input_rows','bf_input_history','bf_input_schemas'])assert.deepEqual(erasedCounts[store],{n:0},store+' cannot be resurrected by an admitted input edit')
 await call(path,undefined,404);await call(path+'/rows',edit(state),404)
 const replay=await importing('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},410)
 assert.equal(replay.error,'snapshot_withdrawn')
 assert.equal((await context.request.get(origin+'/api/operator/datasets/'+dataset)).status(),404)
 // A list is also a read of controlled input metadata: an erased name cannot escape it.
 const listDataset='synthetic-bifocal-input-list-fence'
 await importSource(listDataset)
 const listSource=await call('/datasets/'+listDataset)
 const listDefinition={...definition,id:'synthetic-bifocal-list-fence',name:'Erased regional input name',dataset:listDataset,sourceRevision:listSource.revision}
 const listReview=await call('/inputs/review',listDefinition)
 await call('/inputs',{...listDefinition,reviewedDigest:listReview.digest},201)
 assert.deepEqual((await call('/inputs')).tables,[{id:listDefinition.id,name:listDefinition.name}])
 await arm('/inputs','INSERT INTO ik_d1_assertions',{path:'/api/operator/datasets/'+listDataset+'/erase',body:{confirmDataset:listDataset,reviewedRevision:listSource.revision}})
 assert.deepEqual(await call('/inputs',undefined,409),{error:'input_conflict'},'Erasure at the list boundary refuses all withdrawn names')
 assert.deepEqual((await call('/inputs')).tables,[])
 console.log('Input commit fences: exact schema and row conflicts, native session revocation on reads and writes, source erasure during edits and listing, and erased import replay refused without value, metadata or history resurrection')
}
