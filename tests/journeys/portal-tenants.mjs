import assert from 'node:assert/strict'

/** Real native sessions, reviewed models and import door; no tenant implementation fake. */
export async function provePortalTenants({origin,owner,reader,upload}) {
 const root='/api/operator/portal/tenants',headers={Origin:origin}
 const call=async(path,data,expected=data===undefined?200:201,context=owner,extra={})=>{
  const response=await context.request.fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{...headers,...extra},...data===undefined?{}:{data}})
  assert.equal(response.status(),expected,await response.text());return response.json()
 }
 const admin=(path,data,status)=>call(root+path,data,status)
 const dataset='synthetic-bifocal-portal-sales'
 await upload(dataset,'invoice,region,revenue\n1,West,$100.00\n2,West,$50.00\n3,East,$200.00\n')
 await call('/api/operator/calendars',{id:'synthetic-bifocal-portal-calendar',previousVersion:null,definition:{name:'Portal year',kind:'fiscal',startMonth:1}})
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'}],semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'number'},{column:'region',type:'text'}],hierarchies:[['region']],slowlyChanging:'reject-duplicate-grain'},context:{modelVersion:'synthetic-bifocal-portal-v1',metricVersion:'draft',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-portal-calendar',version:1},rounding:'half-even'}}
 const model=await call('/api/operator/models',{definition:{views:[{id:'sales',kind:'portal',query,rowRules:[]}],quality:[]}}),branch='/api/operator/models/'+model.modelId+'/branches/'+model.branchId
 const validation=await call(branch+'/validate',{},200)
 assert.equal(validation.compatible,true)
 await call(branch+'/approve',{digest:validation.digest},200)
 await call(branch+'/promote',{environment:'staging',digest:validation.digest},200)
 await call(branch+'/promote',{environment:'production',digest:validation.digest},200)
 await call(root,{},403,reader)
 const west=await admin('',{}),east=await admin('',{})
 const doc=(region,name)=>({schema:1,sdk:1,name,color:'#334455',modelId:model.modelId,revision:model.revision,viewId:'sales',rows:[{column:'region',op:'eq',value:region}],dimensions:['region','invoice'],budget:{queries:7,exports:8}})
 const westDoc=doc('West','Synthetic West'),eastDoc={...doc('East','Synthetic East'),budget:{queries:30,exports:8}}
 for(const verb of ['review','stages','activate','suspend','rotate','erase','tokens','read','queue','export'])await call(root+'/'+west.id+'/'+verb,{},403,reader)
 for(const verb of ['usage','archive'])await call(root+'/'+west.id+'/'+verb,undefined,403,reader)
 const stage=async(t,document)=>{
  const reviewed=await admin('/'+t.id+'/review',{document},200)
  await admin('/'+t.id+'/stages',{document,reviewedDigest:'synthetic-bifocal-invalid'},409)
  return admin('/'+t.id+'/stages',{document,reviewedDigest:reviewed.reviewedDigest})
 }
 await admin('/'+west.id+'/review',{document:{...westDoc,rows:[]}},400)
 await admin('/'+west.id+'/review',{document:{...westDoc,sdk:2}},400)
 const w1=await stage(west,westDoc),e1=await stage(east,eastDoc)
 assert.equal(w1.preview.totals.revenue.value,'150.00');assert.equal(w1.preview.matchingRows,2)
 assert.equal(e1.preview.totals.revenue.value,'200.00');assert.equal(e1.preview.matchingRows,1)
 assert.equal((await admin('/'+west.id)).published,null,'A staged preview never publishes')
 const activate=(t,s)=>admin('/'+t.id+'/activate',{version:s.version,previousGeneration:s.previousGeneration,reviewedDigest:s.reviewedDigest},200)
 const token=async(t,action='read',ttlSeconds=300)=>admin('/'+t.id+'/tokens',{audience:origin,action,ttlSeconds})
 await token(west).then(()=>assert.fail('Draft token issued'),error=>assert.match(String(error),/403/))
 let ws=await activate(west,w1),es=await activate(east,e1)
 await admin('/'+west.id+'/tokens',{audience:'https://foreign.example.test',action:'read',ttlSeconds:300},400)
 await admin('/'+west.id+'/tokens',{audience:origin,action:'read',ttlSeconds:301},400)
 const invoke=async(t,action='read',data={groupBy:['region']},status=200,issued)=>{
  const credentials=issued??await token(t,action==='queue'?'queue':action==='read'?'read':'export')
  return call(root+'/'+t.id+'/'+action,data,status,owner,{Authorization:'Bearer '+credentials.token})
 }
 await admin('/'+west.id+'/read',{},403)
 const anonymous=(await import('@playwright/test')).request
 const visitor=await anonymous.newContext()
 try {await call(root+'/'+west.id+'/read',{},401,{request:visitor},{Authorization:'Bearer '+(await token(west)).token})}finally{await visitor.dispose()}
 const swapped=await token(west)
 await invoke(east,'read',{},403,swapped)
 const forged={...swapped,token:swapped.token.slice(0,-4)+'aaaa'}
 await invoke(west,'read',{},403,forged)
 await invoke(west,'export',{},403,swapped)
 const first=await invoke(west,'read',{groupBy:['region']},200,swapped)
 assert.deepEqual(first.result.rows,[{dimensions:['West'],values:{revenue:{state:'value',value:'150.00'}}}]);assert.equal(first.result.matchingRows,2)
 await invoke(west,'read',{},409,swapped)
 const eastFirst=await invoke(east),westCached=await invoke(west)
 assert.equal(eastFirst.result.totals.revenue.value,'200.00');assert.equal(eastFirst.cached,false)
 assert.equal(westCached.result.totals.revenue.value,'150.00');assert.equal(westCached.cached,true)
 assert.equal(westCached.result.name,'Synthetic West');assert.equal(eastFirst.result.name,'Synthetic East')
 const drilled=await invoke(west,'read',{groupBy:['invoice'],filters:[{column:'invoice',op:'eq',value:'2'}]})
 assert.deepEqual(drilled.result.rows,[{dimensions:['2'],values:{revenue:{state:'value',value:'50.00'}}}])
 const empty=await invoke(west,'read',{groupBy:['region'],filters:[{column:'region',op:'eq',value:'East'}]})
 assert.deepEqual(empty.result.rows,[]);assert.equal(empty.result.matchingRows,0)
 await invoke(west,'read',{groupBy:['salary']},403)
 await invoke(west,'read',{dataset},400)
 const expiry=await token(west,'read',1);await new Promise(resolve=>setTimeout(resolve,1100));await invoke(west,'read',{},403,expiry)
 const exported=await invoke(west,'export')
 assert.equal(exported.result.totals.revenue.value,'150.00');assert.ok(!JSON.stringify(exported).includes('East'))
 const queue=await invoke(west,'queue',{},201),eastQueue=await invoke(east,'queue',{},201)
 const old=await token(west),rotated=await admin('/'+west.id+'/rotate',{previousGeneration:ws.generation},200);ws=rotated
 await invoke(west,'read',{},403,old)
 await invoke(west,'jobs/'+queue.id+'/run',{},404)
 const afterRotate=await invoke(west);assert.equal(afterRotate.cached,false);assert.equal(afterRotate.result.totals.revenue.value,'150.00')
 // Quotas include cached reads and survive rotation; another tenant stays usable.
 await invoke(west);await invoke(west)
 await invoke(west,'read',{},429)
 assert.equal((await invoke(east)).result.totals.revenue.value,'200.00')
 const usage=await admin('/'+west.id+'/usage');assert.equal(usage.queries,7);assert.equal(usage.exports,2);assert.equal(usage.costEstimate,'unavailable')
 const queuedAgain=await invoke(west,'queue',{},201),suspendToken=await token(west,'export')
 ws=await admin('/'+west.id+'/suspend',{previousGeneration:ws.generation},200)
 await invoke(west,'jobs/'+queuedAgain.id+'/run',{},403,suspendToken)
 await admin('/'+west.id+'/tokens',{audience:origin,action:'read',ttlSeconds:300},403)
 assert.equal((await invoke(east,'jobs/'+eastQueue.id+'/run',{})).result.totals.revenue.value,'200.00')
 // A new reviewed release stages without changing current host semantics; rollback is explicit.
 const e2=await stage(east,{...eastDoc,name:'Synthetic East version two'})
 assert.equal((await invoke(east)).result.name,'Synthetic East')
 es=await activate(east,e2);assert.equal((await invoke(east)).result.name,'Synthetic East version two')
 const rollback=await admin('/'+east.id+'/releases/1');es=await activate(east,rollback)
 assert.equal((await invoke(east)).result.name,'Synthetic East')
 const westArchive=await admin('/'+west.id+'/archive'),eastArchive=await admin('/'+east.id+'/archive')
 assert.equal(westArchive.tenantId,west.id);assert.equal(westArchive.releases.length,1);assert.equal(westArchive.releases[0].document.document.name,'Synthetic West')
 assert.ok(!JSON.stringify(westArchive).includes('Synthetic East'));assert.equal(eastArchive.releases.length,2)
 await admin('/'+west.id+'/erase',{previousGeneration:ws.generation,confirmTenant:east.id},400)
 await admin('/'+west.id+'/erase',{previousGeneration:ws.generation,confirmTenant:west.id},200)
 await admin('/'+west.id,undefined,404);await admin('/'+west.id+'/archive',undefined,404)
 const preserved=await admin('/'+east.id+'/archive');assert.deepEqual(preserved.releases,eastArchive.releases);assert.ok(eastArchive.events.every(event=>preserved.events.some(retained=>JSON.stringify(retained)===JSON.stringify(event))))
 assert.equal((await admin('')).tenants.some(t=>t.id===west.id),false)
 assert.equal((await invoke(east)).result.totals.revenue.value,'200.00')
 // A changed source invalidates even a warm cache; later release cannot revive the old snapshot.
 const beforeSourceChange=await token(east)
 await upload(dataset,'invoice,region,revenue\n1,West,$900.00\n2,West,$50.00\n3,East,$999.00\n',true)
 await invoke(east,'read',{},409,beforeSourceChange)
 await admin('/'+east.id+'/tokens',{audience:origin,action:'read',ttlSeconds:300},409)
 await upload(dataset,'invoice,region,revenue\n1,West,$100.00\n2,West,$50.00\n3,East,$200.00\n',true)
 await admin('/'+east.id+'/tokens',{audience:origin,action:'read',ttlSeconds:300},409)
 const refreshed=await stage(east,eastDoc);es=await activate(east,refreshed)
 assert.equal((await invoke(east)).result.totals.revenue.value,'200.00')
 const fixed=await call('/api/operator/models',{definition:{views:[{id:'sales',kind:'portal',query,rowRules:[{column:'region',op:'eq',value:'West'}]}],quality:[]}}),fixedBranch='/api/operator/models/'+fixed.modelId+'/branches/'+fixed.branchId
 const fixedReview=await call(fixedBranch+'/validate',{},200)
 await call(fixedBranch+'/approve',{digest:fixedReview.digest},200);await call(fixedBranch+'/promote',{environment:'staging',digest:fixedReview.digest},200);await call(fixedBranch+'/promote',{environment:'production',digest:fixedReview.digest},200)
 const inherited=await admin('/'+east.id+'/review',{document:{...eastDoc,modelId:fixed.modelId,revision:fixed.revision}},200)
 assert.equal(inherited.preview.matchingRows,0);assert.equal(inherited.preview.totals.revenue.value,null,'Tenant rows cannot widen a published model rule')
 // Historical source erasure must preserve an admitted export of the current release.
 const currentDataset='synthetic-bifocal-portal-current'
 await upload(currentDataset,'invoice,region,revenue\n4,East,$321.00\n')
 const currentModel=await call('/api/operator/models',{definition:{views:[{id:'sales',kind:'portal',query:{...query,dataset:currentDataset},rowRules:[]}],quality:[]}}),currentBranch='/api/operator/models/'+currentModel.modelId+'/branches/'+currentModel.branchId
 const currentReview=await call(currentBranch+'/validate',{},200)
 await call(currentBranch+'/approve',{digest:currentReview.digest},200)
 await call(currentBranch+'/promote',{environment:'staging',digest:currentReview.digest},200)
 await call(currentBranch+'/promote',{environment:'production',digest:currentReview.digest},200)
 const currentDoc={...eastDoc,modelId:currentModel.modelId,revision:currentModel.revision}
 es=await activate(east,await stage(east,currentDoc))
 const currentQueue=await invoke(east,'queue',{},201),currentToken=await token(east,'export')
 const currentUsage=await admin('/'+east.id+'/usage')
 const affected=await admin('',{}),affectedState=await activate(affected,await stage(affected,eastDoc))
 const affectedQueue=await invoke(affected,'queue',{},201),affectedToken=await token(affected,'export')
 const source=await call('/api/operator/datasets/'+dataset)
 await call('/api/operator/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200)
 assert.deepEqual((await admin('/'+affected.id+'/archive')).releases,[],'Source erasure removes retained tenant definitions that contain source-derived row rules')
 assert.equal((await admin('/'+affected.id)).status,'suspended')
 await invoke(affected,'jobs/'+affectedQueue.id+'/run',{},403,affectedToken)
 await admin('/'+affected.id+'/tokens',{audience:origin,action:'read',ttlSeconds:300},403)
 assert.equal((await admin('/'+east.id)).status,'active')
 const currentReleases=(await admin('/'+east.id+'/archive')).releases
 assert.deepEqual(currentReleases.map(r=>r.version),[es.published])
 assert.deepEqual(await admin('/'+east.id+'/usage'),currentUsage,'Historical erasure preserves current export reservations')
 assert.equal((await invoke(east,'jobs/'+currentQueue.id+'/run',{},200,currentToken)).result.totals.revenue.value,'321.00','Current source export survives historical source erasure')
 assert.deepEqual(await admin('/'+east.id+'/usage'),currentUsage,'Processing an admitted export never charges twice')
 console.log('Portal tenants: owner-only reviewed release, exact isolated totals, scoped drill and export, signed audience and action and expiry and replay fences, per-tenant cache and quotas, atomic suspension and rotation, queued export cancellation, staged rollback and tenant erasure passed')
}

/** Prepare live preview authority for the supported installation archive door. */
export async function preparePortalRestore({origin,cookie,model}) {
 const root='/api/operator/portal/tenants',headers={cookie,Origin:origin,'content-type':'application'+'/json'}
 const call=async(path,data,status=data===undefined?200:201)=>{const r=await fetch(origin+root+path,{method:data===undefined?'GET':'POST',headers,...data===undefined?{}:{body:JSON.stringify(data)}});assert.equal(r.status,status,await r.clone().text());return r.json()}
 const tenant=await call('',{}),document={schema:1,sdk:1,name:'Synthetic retained portal',color:'#334455',modelId:model.modelId,revision:model.revision,viewId:'sales',rows:[{column:'region',op:'eq',value:'West'}],dimensions:['region'],budget:{queries:10,exports:10}}
 const review=await call('/'+tenant.id+'/review',{document},200),stage=await call('/'+tenant.id+'/stages',{document,reviewedDigest:review.reviewedDigest})
 const state=await call('/'+tenant.id+'/activate',{version:stage.version,previousGeneration:stage.previousGeneration,reviewedDigest:stage.reviewedDigest},200)
 const token=async action=>call('/'+tenant.id+'/tokens',{audience:origin,action,ttlSeconds:300})
 const invoke=async(action,issued,status=200)=>{const r=await fetch(origin+root+'/'+tenant.id+'/'+action,{method:'POST',headers:{...headers,Authorization:'Bearer '+issued.token},body:'{}'});assert.equal(r.status,status,await r.clone().text());return r.json()}
 assert.equal((await invoke('read',await token('read'))).result.totals.revenue.value,'1.01')
 const job=await invoke('queue',await token('queue'),201),issued=await token('export')
 return {id:tenant.id,state,job,issued,releases:(await call('/'+tenant.id+'/archive')).releases,usage:await call('/'+tenant.id+'/usage')}
}

/** Deterministic real public suspension after computation, before final response. */
export async function provePortalBoundary({origin,context}) {
 const {prepareMachineRestore}=await import('./machine-doors.mjs')
 const cookie=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ')
 const machine=await prepareMachineRestore({origin,cookie}),fixture=await preparePortalRestore({origin,cookie,model:machine.portalModel})
 const path='/api/operator/portal/tenants/'+fixture.id
 const armed=await context.request.post(origin+'/__machine-boundary',{data:{path:path+'/suspend',cookie,body:{previousGeneration:fixture.state.generation}}})
 assert.equal(armed.status(),200)
 const response=await context.request.post(origin+path+'/jobs/'+fixture.job.id+'/run',{headers:{Origin:origin,Authorization:'Bearer '+fixture.issued.token},data:{}})
 assert.equal(response.status(),409,'An already computed export is refused after current suspension')
 const body=await response.json();assert.equal(body.error,'portal_state_changed');assert.equal(body.result,undefined)
 const state=await context.request.get(origin+path);assert.equal((await state.json()).status,'suspended')
 const tokens=await context.request.post(origin+path+'/tokens',{headers:{Origin:origin},data:{audience:origin,action:'read',ttlSeconds:300}});assert.equal(tokens.status(),403)
 const usage=await context.request.get(origin+path+'/usage');assert.deepEqual(await usage.json(),fixture.usage)
 console.log('Portal boundary: authenticated suspension before final response refuses computed export and retains its single reservation')
}
