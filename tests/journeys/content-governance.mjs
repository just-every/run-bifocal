import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { proveReportCustody } from './report-custody.mjs'
import { chromium } from '@playwright/test'

/** The actual local-only entry supplies native invited-member sign-in. The
 * application, sessions, grants, D1 and import door remain real throughout. */
export async function proveContentGovernance(){
 const persist=await mkdtemp(join(tmpdir(),'bifocal-content-governance-')),socket=createServer()
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
 const origin='http://127.0.0.1:'+port,varsFile=join(process.cwd(),'.dev.vars')
 const privateArchive=join(process.cwd(),'exports','synthetic-bifocal-private.json')
 let varsWritten=false,archiveWritten=false,child,browser,output=''
 const environment={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',RER_STATE_DIR:persist,RER_DEV_ORIGIN:origin,RER_DEV_KEY:'synthetic-bifocal-4'.repeat(3)}
 try{
  await writeFile(varsFile,`AUTH_ORIGIN=${origin}\nAUTH_LOCAL=true\nOWNER_EMAIL=synthetic-bifocal-1@example.test\nSESSION_SECRET=${'synthetic-bifocal-2'.repeat(3)}\nSETUP_TOKEN=${'synthetic-bifocal-3'.repeat(3)}\nINSTALLATION_KEY=${createHash('sha256').update('synthetic-bifocal-6').digest('hex')}\nMAIL_PROVIDER=development\nMAIL_FROM=synthetic-bifocal-2@example.test\n`,{flag:'wx',mode:0o600});varsWritten=true
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config','wrangler.jsonc'],{stdio:'pipe',env:environment})
  child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{env:environment,stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
  let ready=false
  for(let attempt=0;attempt<120;attempt++){
   assert.equal(child.exitCode,null,'native local entry remains running')
   try{ready=(await fetch(origin+'/health')).ok}catch{}
   if(ready)break;await new Promise(resolve=>setTimeout(resolve,250))
  }
  assert.ok(ready,'native local entry starts')
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  const owner=await browser.newContext(),reader=await browser.newContext()
  for(const context of [owner,reader])assert.equal((await context.request.post(origin+'/__dev/key',{headers:{Origin:origin},data:{key:environment.RER_DEV_KEY}})).status(),204)
  const bootstrap=await owner.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:'synthetic-bifocal-3'.repeat(3),displayName:'Synthetic content owner',returnTo:'/app'},maxRedirects:0})
  assert.equal(bootstrap.status(),303,await bootstrap.text())
  const page=await owner.newPage();await page.goto(origin+'/setup')
  if(new URL(page.url()).pathname==='/setup'){await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])}
  await mkdir(join(process.cwd(),'exports'),{recursive:true});await writeFile(privateArchive,'synthetic-bifocal-private-archive',{flag:'wx',mode:0o600});archiveWritten=true
  for(const path of ['/exports/synthetic-bifocal-private.json','/@fs'+privateArchive,'/.dev.vars']){const response=await owner.request.get(origin+path);assert.ok([403,404].includes(response.status()),'private installation files stay unreadable');assert.ok(!(await response.text()).includes('synthetic-bifocal-private-archive'))}
  const ownerSessionCheck=await owner.request.get(origin+'/auth/session');assert.equal(ownerSessionCheck.status(),200,await ownerSessionCheck.text())
  assert.equal((await owner.request.post(origin+'/auth/invite',{headers:{Origin:origin},data:{email:'synthetic-bifocal-reader@example.test',displayName:'Synthetic reader',role:'member'}})).status(),202)
  const people=await(await owner.request.get(origin+'/auth/operators')).json(),target=people.find(person=>person.email==='synthetic-bifocal-reader@example.test')
  assert.ok(target?.signInUrl);await reader.request.get(new URL(target.signInUrl,origin).href)
  const readerSession=await(await reader.request.get(origin+'/auth/session')).json(),ownerSession=await(await owner.request.get(origin+'/auth/session')).json()
  assert.equal(readerSession.operator.role,'member')
  const fixtures=await importDataset(origin,owner)
  await proveCatalog(origin,owner,reader,readerSession.operator.id,ownerSession.operator.id,fixtures)
  // The reader's same native session must still be unable to read source rows.
  assert.equal((await reader.request.get(origin+'/api/operator/datasets/'+fixtures.dataset)).status(),401)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/people')
   await page.getByRole('heading',{name:'Invite a person',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/catalog-native-membership-'+width+'.png',fullPage:true})
  }
  await owner.close();await reader.close()
 }catch(error){console.error(output.split('\n').filter(line=>/error|exception|body|promise/i.test(line)).join('\n'));throw error}
 finally{
  await browser?.close()
  if(child){child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null||child.signalCode!==null?resolve():child.once('exit',resolve))}
  if(varsWritten)await rm(varsFile)
  if(archiveWritten)await rm(privateArchive)
  await rm(persist,{recursive:true,force:true})
 }
}

export async function importDataset(origin,owner,replace=false){
 const dataset='synthetic-bifocal-catalog',input={version:1,datasetId:dataset,filename:'synthetic-bifocal-91.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:'id',formulaTreatment:'literal-text',data:replace?'id,region,revenue,net_revenue,opening_customers,cancelled_customers\n1,West,$999.00,$900.00,100,5\n':'id,region,revenue,net_revenue,opening_customers,cancelled_customers\n1,West,$100.00,$90.00,100,5\n2,East,$200.00,$180.00,100,8\n'}
 const bytes=Buffer.from(JSON.stringify(input)),hash=createHash('sha256').update(bytes).digest('hex'),headers={Origin:origin,'X-Import-Dataset':dataset}
 const post=async(action,data)=>{const response=await owner.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(response.status(),200,await response.text());return response.json()}
 const upload=await post('uploads',{name:'synthetic-bifocal-91.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')})
 const plan=await post('plan',{uploadId:upload.uploadId,...replace?{catchup:true}:{}})
 let applied=false
 for(let attempt=0;attempt<20;attempt++){const result=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(result.job.state==='completed'){applied=true;break}}
 assert.ok(applied)
 return {dataset,replace:()=>importDataset(origin,owner,true),revision:(await(await owner.request.get(origin+'/api/operator/datasets/'+dataset)).json()).revision}
}

async function proveCatalog(origin,owner,reader,readerId,ownerId,fixtures){
 const call=async(context,path,data,expected=data===undefined?200:201,method=data===undefined?'GET':'POST')=>{
  const response=await context.request.fetch(origin+'/api/operator/library'+path,{method,headers:{Origin:origin},...data===undefined?{}:{data}})
  assert.equal(response.status(),expected,await response.text());return response.json()
 }
 await call(reader,'/collections',{name:'Refused',parentId:null},403)
 const collection=await call(owner,'/collections',{name:'Company reporting',parentId:null})
 const folder=await call(owner,'/collections',{name:'Finance',parentId:collection.id})
 const calendarResponse=await owner.request.post(origin+'/api/operator/calendars',{headers:{Origin:origin},data:{id:'synthetic-bifocal-catalog-year',previousVersion:null,definition:{name:'Churn year',kind:'fiscal',startMonth:1}}});assert.equal(calendarResponse.status(),201,await calendarResponse.text())
 const churnQuery={version:1,dataset:fixtures.dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'churn',op:'ratio',numerator:'cancelled_customers',denominator:'opening_customers',unit:'percent',scale:2}],context:{modelVersion:'churn-model-v1',metricVersion:'draft',accountingBasis:'not-applicable',calendar:{id:'synthetic-bifocal-catalog-year',version:1},rounding:'half-even'}}
 const entry={kind:'metric',title:'Certified churn',description:'Human-reviewed churn definition for company reporting.',tags:['retention','finance'],definition:{query:churnQuery},sourceLinks:['https://example.test/reports/churn'],verified:true,collectionId:folder.id,sourceDatasets:[fixtures.dataset]}
 const metric=await call(owner,'/items',entry)
 const duplicate=await call(owner,'/items',{...entry,title:'Churn duplicate',verified:false})
 const question=await call(owner,'/items',{...entry,kind:'question',title:'Churn question',verified:false,definition:{question:'What changed in churn?'},sourceLinks:['/app/queries']})
 const unopened=await call(owner,'/items',{...entry,kind:'dashboard',title:'Churn unopened dashboard',verified:false,definition:{layout:'monthly'},sourceLinks:['/app/queries']})
 const privateColumn=await call(owner,'/items',{...entry,kind:'source-column',title:'Private salary column',description:'Private compensation',verified:false,definition:{column:'salary'},sourceLinks:['/app/import']})
 assert.equal((await call(reader,'/search?q=churn')).total,0)
 for(const item of [metric,duplicate,question,unopened])await call(owner,'/items/'+item.id+'/grants',{readerId,enabled:true},200,'PUT')
 const search=await call(reader,'/search?q=churn')
 assert.equal(search.items[0].id,metric.id);assert.equal(search.total,4)
 assert.ok(search.items.every(item=>item.id!==privateColumn.id&&item.collectionId===null))
 assert.deepEqual(await call(reader,'/search?q=salary'),{items:[],total:0,suggestions:[],nextOffset:null})
 await call(reader,'/items/'+privateColumn.id,undefined,404)
 assert.equal((await call(reader,'/collections')).collections.length,0)
 await call(owner,'/collections/'+folder.id+'/grants',{readerId,enabled:true},200,'PUT')
 const sharedFolders=(await call(reader,'/collections')).collections
 assert.equal(sharedFolders.length,1);assert.equal(sharedFolders[0].name,'Finance');assert.equal(sharedFolders[0].parent_id,null)
 await call(owner,'/items/'+question.id,{...entry,kind:'question',title:'Churn question revised',verified:false,definition:{question:'What changed in churn?'},sourceLinks:['/app/queries'],sourceDatasets:[],previousVersion:1},200,'PUT')
 await call(owner,'/items/'+question.id,{...entry,previousVersion:1},409,'PUT')
 assert.ok((await call(reader,'/search?q=revised')).items.some(i=>i.id===question.id))
 await call(reader,'/items/'+metric.id+'/favourite',{favourite:true},200,'PUT')
 const original=await call(reader,'/items/'+metric.id)
 assert.equal(original.favourite,true);assert.deepEqual(original.sourceLinks,entry.sourceLinks)
 assert.equal((await call(owner,'/search?favourites=true')).total,0,'favourites are private to their reader')
 await call(owner,'/hygiene',undefined,409)
 const policy=await call(owner,'/privacy',{previousVersion:0,usageEnabled:true,detail:'owner-only',consent:true},200,'PUT')
 await call(reader,'/hygiene',undefined,403)
 const events=Array.from({length:90},(_,day)=>({id:'synthetic-bifocal-usage-'+day,itemId:metric.id,readerId,tenant:day%2?'company-west':'company-east',openedAt:new Date(Date.now()-(day+.25)*86400000).toISOString()}))
 await call(owner,'/usage/import',{policyVersion:policy.version,events})
 await call(owner,'/usage/import',{policyVersion:policy.version,events})
 await call(owner,'/usage/import',{policyVersion:policy.version,events:[{...events[0],tenant:'different'}]},409)
 await call(owner,'/items/'+unopened.id+'/dependencies',{dependsOn:metric.id,enabled:true},200,'PUT')
 const before=await call(owner,'/hygiene')
 assert.equal(before.denominator.historicalOpens,90);assert.equal(before.items.find(i=>i.id===unopened.id).unused,true)
 assert.ok(before.items.find(i=>i.id===metric.id).duplicates.includes(duplicate.id))
 assert.equal(before.usage.reduce((sum,item)=>sum+item.opens,0),90)
 assert.ok(before.usage.every(item=>item.reader_id===readerId&&item.lastOpen))
 const preview=await call(owner,'/items/'+metric.id+'/archive-preview',{},200)
 assert.equal(preview.dependents[0].id,unopened.id);assert.equal(preview.ownerId,ownerId)
 await call(reader,'/items/'+metric.id+'/archive',{previousVersion:1,digest:preview.digest},403)
 await call(owner,'/items/'+metric.id+'/archive',{previousVersion:0,digest:preview.digest},409)
 await call(owner,'/items/'+metric.id+'/archive',{previousVersion:1,digest:preview.digest},200)
 assert.equal((await call(reader,'/search?q=churn')).total,3)
 const archived=await call(reader,'/items/'+metric.id)
 assert.equal(archived.archived,true);assert.match(archived.explanation,/Archived/);assert.equal(archived.favourite,true)
 const after=await call(owner,'/hygiene')
 assert.equal(after.denominator.items,before.denominator.items);assert.equal(after.denominator.historicalOpens,before.denominator.historicalOpens);assert.deepEqual(after.usage,before.usage)
 const restore=await call(owner,'/items/'+metric.id+'/archive-preview',{},200)
 await call(owner,'/items/'+metric.id+'/restore',{previousVersion:2,digest:restore.digest},200)
 const restored=await call(reader,'/items/'+metric.id)
 assert.equal(restored.archived,false);assert.equal(restored.favourite,true);assert.deepEqual(restored.sourceLinks,original.sourceLinks)
 assert.equal((await call(owner,'/items/'+metric.id+'/versions')).versions.length,3)
 await call(owner,'/items/'+metric.id+'/grants',{readerId,enabled:false},200,'PUT')
 await call(reader,'/items/'+metric.id,undefined,404)
 assert.ok(!(await call(reader,'/search?q=churn')).items.some(item=>item.id===metric.id))
 const reports=await proveReportCustody(origin,owner,reader,fixtures,null)
 const receipt=await owner.request.post(origin+'/api/operator/datasets/'+fixtures.dataset+'/erase',{headers:{Origin:origin},data:{confirmDataset:fixtures.dataset,reviewedRevision:fixtures.revision}})
 assert.equal(receipt.status(),200,await receipt.text())
 await reports.erased()
 assert.ok((await receipt.json()).stores.some(store=>store.store==='bf_catalog_items'&&store.rows===6))
 assert.equal((await call(owner,'/search?q=churn')).total,0)
 assert.equal((await call(owner,'/hygiene')).denominator.historicalOpens,0)
 const records=(await call(owner,'/audit')).records
 assert.ok(records.some(record=>record.action==='privacy-consented'));assert.ok(records.some(record=>record.action==='restore'))
 console.log('Content library: native reader grants, certified-first FTS without private names/counts, private favourites, ninety-day authorized usage, owner-only privacy, duplicate/unused/dependency review, reversible archive and source-erasure custody passed')
}
if(process.argv[1]===import.meta.filename)await proveContentGovernance()
