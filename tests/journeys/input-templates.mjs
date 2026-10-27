import assert from 'node:assert/strict'

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
 await call(customPath+'/rows',{rowKey:'1',previousVersion:1,schemaRevision:custom.schemaRevision,...edited})
 custom=await call(customPath);assertState(custom,edited,'100.00')
 assert.deepEqual(custom.history[0].before,normalized);assert.deepEqual(custom.history[0].after,edited)
 await page.goto(origin+'/app'+customPath);await shot('custom-saved',1440)
 await unchangedSource();states.push([customPath,custom]);erasedValues.push(valid.memo,edited.memo,'12.50')
 return {states,erasedValues}
}
