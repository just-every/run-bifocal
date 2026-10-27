import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const expected=[['1','12.30',true,'2026-06-01',''],['2','-2.05',false,'2026-06-02',null],['3','0.00',true,'2026-06-03','<img src=x onerror=alert(1)>']]
const fields=[{name:'id',path:'id',type:'text'},{name:'amount',path:'amount',type:'money'},{name:'active',path:'active',type:'boolean'},{name:'day',path:'day',type:'date'},{name:'note',path:'note',type:'text'}]
export async function proveWebSources(origin,context,page,state,webOrigin) {
 const post=async(path,data,status=200,headers={})=>{
  const response=await context.request.post(origin+'/api/operator/'+path,{headers:{Origin:origin,...headers},data}),text=await response.text()
  assert.equal(response.status(),status,text);assert.ok(!text.includes('synthetic-bifocal-60'),'source grant must not enter responses');return JSON.parse(text)
 }
 const read=async id=>{const response=await context.request.get(origin+'/api/operator/datasets/'+id);assert.equal(response.status(),200,await response.text());return response.json()}
 const input=(dataset,overrides={})=>({datasetId:dataset,readId:randomUUID(),endpoint:webOrigin+'/nested',format:'json',itemsPath:'data.items',fields:fields.map(field=>({...field,path:field.name==='id'?'id':'details.'+field.path})),paging:'next-link',nextPath:'next',parameter:'page',sizeParameter:'limit',pageSize:2,accessToken:'synthetic-bifocal-60',confirmRead:true,confirmSnapshot:true,...overrides})
 const preview=(dataset,overrides={},status=200)=>post('web-source/preview',input(dataset,overrides),status)
 async function apply(plan,id){const result=await post('import/apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},200,{'X-Import-Dataset':id});assert.equal(result.job.state,'completed');assert.equal((await post('import/reconcile',{planId:plan.planId},200,{'X-Import-Dataset':id})).ok,true)}
 const shot=async(name,width)=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'web '+name+' reflows at '+width)
  assert.equal(await page.locator('#web-source-form button').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim() && !node.getAttribute('aria-label')).length),0,'new controls have visible names')
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/web-${name}-${width}.png`,fullPage:true})
 }
 state.webPhase='success'
 const count=state.webCalls??0
 assert.equal((await fetch(origin+'/api/operator/web-source/config')).status,401)
 const denied=input('synthetic-bifocal-web-denied')
 await post('web-source/preview',denied,401,{Origin:'https://foreign.example.test'})
 await post('web-source/preview',{...denied,confirmRead:false},400)
 await post('web-source/preview',{...denied,confirmSnapshot:false},400)
 await preview('synthetic-bifocal-web-denied',{endpoint:webOrigin+'/nested?access_token=synthetic-bifocal-60'},403)
 await preview('synthetic-bifocal-web-denied',{endpoint:webOrigin+'/odata?$deltatoken=opaque'},409)
 await preview('synthetic-bifocal-web-denied',{endpoint:'https://127.0.0.1/private'},400)
 await preview('synthetic-bifocal-web-denied',{endpoint:'https://synthetic-bifocal-foreign.workers.dev/items'},403)
 assert.equal(state.webCalls??0,count,'refused setup never contacts a provider')
 // Public setup and shared review, apply, full replacement, Undo and erasure.
 for(const width of [1440,390]) {
  const id='synthetic-bifocal-web-'+width
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/import')
  await page.getByLabel('Dataset id',{exact:true}).fill(id);await page.getByText('Read a web source',{exact:true}).click()
  const form=page.locator('#web-source-form'),data=input(id)
  for(const name of ['endpoint','itemsPath','nextPath','parameter','sizeParameter','accessToken'])await form.locator(`[name="${name}"]`).fill(data[name])
  await form.locator('[name=pageSize]').fill('2');await form.getByLabel('Web column mapping (JSON)').fill(JSON.stringify(data.fields))
  await form.getByRole('checkbox').nth(0).check();await form.getByRole('checkbox').nth(1).check()
  assert.equal(await page.locator('#web-reconciliation-limit').isVisible(),true)
  await shot('setup',width)
  await form.getByRole('button',{name:'Preview web snapshot',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Plan ready'))
  assert.equal(await form.locator('[name=accessToken]').inputValue(),'');assert.equal(await page.locator('#sample img').count(),0)
  assert.equal(await page.locator('#source').getByText('2',{exact:true}).count(),1);await shot('review',width)
  await page.getByLabel('I reviewed this exact plan and its fingerprint').check();await page.getByRole('button',{name:'Apply import',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('completed and reconciled'))
  const original=await read(id);assert.deepEqual(original.table.rows,expected);assert.deepEqual(original.table.columns.map(field=>field.type),['text','money','boolean','date','text']);assert.equal(original.table.source.webSource.pages,2);assert.equal(original.table.source.webSource.deletionFeed,false);assert.equal(original.table.source.webSource.reconciliation,'reviewed-full-snapshot')
  await page.locator('#current').scrollIntoViewIfNeeded();await shot('current',width)
  state.webPhase='empty'
  const empty=await preview(id,{itemsPath:'items',catchup:true});assert.equal(empty.preview.rowCount,0);await apply(empty,id);assert.deepEqual((await read(id)).table.rows,[])
  await page.getByRole('button',{name:'Load dataset',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('history loaded'));await shot('empty',width)
  await page.getByRole('button',{name:'Undo import',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Import undone'));assert.deepEqual((await read(id)).table.rows,expected);await shot('undone',width)
  state.webPhase='endless'
  await form.locator('[name=accessToken]').fill(data.accessToken);for(const box of await form.getByRole('checkbox').all())await box.check()
  const started=state.webCalls;await form.getByRole('button',{name:'Preview web snapshot'}).click()
  for(let attempt=0;attempt<100 && state.webCalls<started+2;attempt++)await new Promise(resolve=>setTimeout(resolve,25))
  assert.ok(state.webCalls>=started+2,'nonterminating source actually began paging')
  try {
   const cancelResponse=page.waitForResponse(response=>response.url()===origin+'/api/operator/web-source/cancel' && response.request().method()==='POST')
   await form.getByRole('button',{name:'Cancel source read'}).click();assert.equal((await cancelResponse).status(),200)
  } finally {state.webPhase='success';state.releaseWebPage?.();state.releaseWebPage=null}
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('web_read_cancelled'))
  assert.deepEqual((await read(id)).table.rows,expected);assert.ok(state.webCalls-started<20,'cancellation stops pagination before its page bound');await shot('cancelled',width)
  state.webPhase='success'
  for(const [phase,status,error] of [['partial',502,'web_partial_response_refused'],['oversize',413,'web_response_limit'],['rate',429,'web_rate_limited'],['expired',409,'web_authorization_expired'],['schema',502,'web_missing_path'],['private-next',400,'public_https_origin_required'],['foreign-next',403,'web_destination_not_approved'],['redirect',409,'web_redirect_refused'],['repeated',409,'web_nonterminating_pagination']]) {
   state.webPhase=phase
   const before=await read(id),historyBefore=await (await context.request.get(origin+'/api/operator/import/history',{headers:{'X-Import-Dataset':id}})).json()
   const failed=await preview(id,{catchup:true},status);assert.equal(failed.error,error);assert.deepEqual(await read(id),before,'failed page sequence preserves exact last-good dataset')
   const historyAfter=await (await context.request.get(origin+'/api/operator/import/history',{headers:{'X-Import-Dataset':id}})).json();assert.deepEqual(historyAfter,historyBefore,'failed pages never stage a successful partial plan')
  }
  state.webPhase='success';await page.getByRole('button',{name:'Load dataset',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('history loaded'))
  await page.getByText('Erase this dataset and retained imports',{exact:true}).click();await page.getByLabel('Type dataset id to confirm').fill(id);await page.getByRole('button',{name:'Erase reviewed dataset'}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Dataset erased'))
  assert.equal((await context.request.get(origin+'/api/operator/datasets/'+id)).status(),404);await shot('erased',width)
 }
 for(const [name,options,wanted] of [
  ['rest',{endpoint:webOrigin+'/rest',itemsPath:'',nextPath:'',fields},expected],
  ['odata',{endpoint:webOrigin+'/odata',format:'odata',itemsPath:'value',fields},expected],
  ['xml',{endpoint:webOrigin+'/xml',format:'xml',itemsPath:'row',paging:'none',nextPath:'',fields},expected.slice(0,2)],
  ['page',{endpoint:webOrigin+'/paging',itemsPath:'items',paging:'page',fields},expected],
  ['offset',{endpoint:webOrigin+'/paging',itemsPath:'items',paging:'offset',parameter:'offset',fields},expected],
  ['cursor',{endpoint:webOrigin+'/cursor',itemsPath:'items',paging:'cursor',parameter:'after',fields},expected]
 ]) {
  const id='synthetic-bifocal-web-'+name,plan=await preview(id,options);assert.equal(plan.counts.rejected,0,JSON.stringify(plan));await apply(plan,id)
  const current=await read(id);assert.deepEqual(current.table.rows,wanted,name+' complete typed rows')
  assert.equal(current.table.source.webSource.deltaAvailable,name==='odata')
 }
 state.webPhase='active-xml';assert.equal((await preview('synthetic-bifocal-web-xml',{endpoint:webOrigin+'/xml',format:'xml',itemsPath:'row',paging:'none',nextPath:'',fields,catchup:true},502)).error,'web_active_xml_refused')
 state.webPhase='success'
 console.log('Web sources: public setup and typed full snapshots for REST, nested JSON, OData and inert XML; finite page, offset, cursor and next-link reads; complete empty replacement, Undo, cancellation, failed-page preservation, unsafe-destination and grant refusals, shared erasure and 1440/390 states passed (official-schema network edges only)')
}

// Focused invocation uses the same emitted product and network edge as Verify.
if(process.argv[1]===new URL(import.meta.url).pathname){
 const {chromium}=await import('@playwright/test'),{analyticsEdge}=await import('./analytics-edge.mjs'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const persist=await mkdtemp(join(tmpdir(),'bifocal-web-')),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 let edge
 try {
  edge=await analyticsEdge(persist)
  const context=await browser.newContext(),page=await context.newPage(),{origin,state,webOrigin}=edge
  const bootstrap=await context.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:'synthetic-bifocal-1'.repeat(3),displayName:'Web source owner',returnTo:'/app'},maxRedirects:0});assert.equal(bootstrap.status(),303,await bootstrap.text())
  await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup',exact:true}).click()])
  await proveWebSources(origin,context,page,state,webOrigin)
 } finally {if(edge)await edge.close();await browser.close();await rm(persist,{recursive:true,force:true})}
}
