import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {proveRetainedExports} from './retained-export.mjs'

/** The same versioned layouts pass through owner UI, native tools and estates. */
export async function proveDashboardAuthoring({origin,context,page,upload,proveScreen,cli,tfRun,directory,tf}) {
 const api=async(path,data,expected=data===undefined?200:201)=>{const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin},...(data===undefined?{}:{data})});assert.equal(response.status(),expected,await response.text());return response.json()}
 const dataset='synthetic-bifocal-authored-dashboard',csv='invoice,region,revenue\n1,West,$10.01\n2,East,$20.02\n'
 await upload(dataset,csv)
 const base=JSON.parse(await readFile(join(directory,'metric-export.native.json'),'utf8')).definition.query
 const all={...base,dataset,filters:[],groupBy:[]};delete all.fiscal
 const west={...all,filters:[{column:'region',op:'eq',value:'West'}]}
 const document={version:2,title:'Regional operating layout',cards:[{key:'all-regions',definition:all},{key:'west-region',definition:west}],layout:{desktop:[{key:'all-regions',x:0,y:0,w:6,h:4},{key:'west-region',x:6,y:0,w:6,h:4}],phone:[{key:'all-regions',x:0,y:0,w:1,h:4},{key:'west-region',x:0,y:4,w:1,h:4}]}}
 const file=join(directory,'authored-dashboard.native.json');let sequence=0
 const plan=async(doc,id)=>{await writeFile(file,JSON.stringify(doc));const path=join(directory,'authored-dashboard-'+sequence+++'.plan.json'),review=await cli('dashboard-definition-plan',['--file',file,'--plan-file',path,...id?['--id',id]:[]]);return {path,review}}
 const apply=review=>cli('dashboard-definition-apply',['--plan-file',review.path,'--approve',review.review.digest])
 const publish=async(id,revision,action='publish')=>{const path=join(directory,'authored-'+action+'-'+sequence+++'.plan.json'),review=await cli('dashboard-definition-'+action+'-plan',['--id',id,'--revision',String(revision),'--plan-file',path]);return cli('dashboard-definition-'+action,['--plan-file',path,'--approve',review.digest])}
 assert.equal((await fetch(origin+'/api/operator/dashboard-authoring')).status,401)
 await page.goto(origin+'/app/dashboard-authoring');await page.getByLabel('Dashboard document (JSON)',{exact:true}).fill(JSON.stringify(document))
 await Promise.all([page.waitForResponse(response=>response.url().endsWith('/dashboard-authoring/review')&&response.status()===200),page.getByRole('button',{name:'Review draft',exact:true}).click()])
 const [createdResponse]=await Promise.all([page.waitForResponse(response=>response.url().endsWith('/dashboard-authoring/apply')),page.getByRole('button',{name:'Save reviewed draft',exact:true}).click()]);assert.equal(createdResponse.status(),201);let saved=await createdResponse.json()
 const id=saved.id,read=()=>api('/dashboard-authoring/'+id),editor=origin+'/app/dashboard-authoring/'+id,reader=editor+'/view'
 assert.equal(saved.revision,1);assert.equal(saved.publishedRevision,null)
 await page.goto(editor);await page.getByRole('button',{name:'Review publication',exact:true}).click()
 await Promise.all([page.waitForResponse(response=>response.url().endsWith('/'+id+'/publish')&&response.status()===200),page.getByRole('button',{name:'Publish reviewed revision',exact:true}).click()]);saved=await read();assert.equal(saved.publishedRevision,1)
 const publishedBoard=await api('/dashboards/'+saved.published.boardId)
 await proveRetainedExports({origin,context,snapshotId:publishedBoard.cards[0].snapshotId,summary:[['30.03']],underlying:[['1','West','10.01'],['2','East','20.02']]})
 await proveRetainedExports({origin,context,snapshotId:publishedBoard.cards[1].snapshotId,summary:[['10.01']],underlying:[['1','West','10.01']]})
 const checkReading=async(label,phoneFirst)=>{
  await page.goto(reader);await page.locator('#published-dashboard [data-card-key="all-regions"]').waitFor()
  assert.match(await page.locator('#published-dashboard').innerText(),/30\.03/);assert.match(await page.locator('#published-dashboard').innerText(),/10\.01/)
  for(const scope of ['summary','underlying'])for(const format of ['CSV','XLSX'])assert.equal(await page.getByRole('button',{name:'Export '+scope+' '+format,exact:true}).count(),2)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const allBox=await page.locator('#published-dashboard [data-card-key="all-regions"]').boundingBox(),westBox=await page.locator('#published-dashboard [data-card-key="west-region"]').boundingBox()
   if(width===1440){assert.ok(allBox.x<westBox.x);assert.equal(allBox.y,westBox.y)}else assert.equal(allBox.y<westBox.y,!phoneFirst)
   if(label==='dashboard-authored-first-publication'){const download=page.waitForEvent('download');await page.getByRole('button',{name:width===1440?'Export summary CSV':'Export underlying XLSX',exact:true}).last().click();assert.match((await download).suggestedFilename(),/retained-(summary|underlying)\.(csv|xlsx)$/)}
  }
  await proveScreen(label)
 }
 await checkReading('dashboard-authored-first-publication',false)
 const exported=join(directory,'authored-dashboard-export.native.json');await cli('dashboard-definition-export',['--id',id,'--output',exported]);assert.deepEqual(JSON.parse(await readFile(exported,'utf8')),document)
 const phone=structuredClone(document);phone.layout.phone[0].y=4;phone.layout.phone[1].y=0
 const stale=await plan(phone,id)
 await page.goto(editor);await page.getByLabel('Tile 1 phone y',{exact:true}).fill('4');await page.getByLabel('Tile 2 phone y',{exact:true}).fill('0')
 await Promise.all([page.waitForResponse(response=>response.url().endsWith('/dashboard-authoring/review')&&response.status()===200),page.getByRole('button',{name:'Review draft',exact:true}).click()])
 await Promise.all([page.waitForResponse(response=>response.url().endsWith('/dashboard-authoring/apply')&&response.status()===201),page.getByRole('button',{name:'Save reviewed draft',exact:true}).click()]);saved=await read();assert.equal(saved.revision,2);assert.deepEqual(saved.definition.layout.desktop,document.layout.desktop);assert.deepEqual(saved.definition.layout.phone,phone.layout.phone)
 await cli('dashboard-definition-apply',['--plan-file',stale.path,'--approve',stale.review.digest],false);assert.deepEqual(await read(),saved)
 await checkReading('dashboard-authored-draft-keeps-published',false)
 await page.goto(editor);await proveScreen('dashboard-authored-independent-phone-draft')
 await publish(id,2);await checkReading('dashboard-authored-phone-publication',true)
 const config=(doc,digest)=>({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_dashboard_definition:{main:{document:JSON.stringify(doc),...(digest?{review_digest:digest}:{})}}}})
 const terraform=(args,ok=true)=>tfRun([args[0],'-state=authored-dashboard.tfstate',...args.slice(1)],ok)
 await writeFile(tf,JSON.stringify(config(phone)));await terraform(['import','-input=false','-no-color','bifocal_dashboard_definition.main',id]);await terraform(['plan','-input=false','-no-color','-detailed-exitcode'])
 const changed=structuredClone(phone);changed.title='Reviewed regional layout';const reviewed=await plan(changed,id)
 await writeFile(tf,JSON.stringify(config(changed,reviewed.review.digest)));await terraform(['plan','-input=false','-no-color','-out=authored-stale.tfplan'])
 await apply(reviewed);const concurrent=await read();await terraform(['apply','-input=false','-no-color','authored-stale.tfplan'],false);assert.deepEqual(await read(),concurrent)
 const updated=structuredClone(changed);updated.title='Current regional layout';const current=await plan(updated,id)
 await writeFile(tf,JSON.stringify(config(updated,current.review.digest)));await terraform(['plan','-input=false','-no-color','-out=authored-current.tfplan']);await terraform(['apply','-input=false','-no-color','authored-current.tfplan']);saved=await read();assert.equal(saved.revision,4);assert.deepEqual(saved.definition,updated)
 const state=JSON.parse(await readFile(join(directory,'authored-dashboard.tfstate'),'utf8')).resources[0].instances[0].attributes;assert.equal(state.revision,4);assert.equal(state.published_revision,2)
 await publish(id,4);await publish(id,1,'rollback');saved=await read();assert.equal(saved.publishedRevision,1);await checkReading('dashboard-authored-restored-publication',false)
 const estate={version:1,id:'synthetic-bifocal-layout-estate',name:'Authored layout estate',resources:[{key:'regional',kind:'dashboard',id,revision:2}]},estateFile=join(directory,'authored-estate.native.json'),estatePlan=join(directory,'authored-estate.plan.json')
 await writeFile(estateFile,JSON.stringify(estate));const er=await cli('environment-plan',['--file',estateFile,'--plan-file',estatePlan]);await cli('environment-apply',['--plan-file',estatePlan,'--approve',er.digest])
 const estateFlags=['--estate',estate.id],estateReview=await cli('environment-review',[...estateFlags,'--version','1']);await cli('environment-approve',[...estateFlags,'--version','1','--digest',estateReview.digest])
 await cli('environment-promote',[...estateFlags,'--version','1','--digest',estateReview.digest,'--environment','staging']);assert.equal((await read()).publishedRevision,1)
 await cli('environment-promote',[...estateFlags,'--version','1','--digest',estateReview.digest,'--environment','production']);assert.equal((await read()).publishedRevision,2);await checkReading('dashboard-authored-estate-publication',true)
 // A new native draft invalidates a saved estate plan without changing either publication.
 estate.name='Changed authored estate';await writeFile(estateFile,JSON.stringify(estate));const staleEstatePath=join(directory,'authored-estate-stale.plan.json'),se=await cli('environment-plan',['--file',estateFile,'--plan-file',staleEstatePath])
 const later=structuredClone(updated);later.title='Concurrent authored layout';await apply(await plan(later,id));const before=await cli('environment-status',estateFlags)
 await cli('environment-apply',['--plan-file',staleEstatePath,'--approve',se.digest],false);assert.deepEqual(await cli('environment-status',estateFlags),before);assert.equal((await read()).publishedRevision,2)
 const privateState=await readFile(join(directory,'authored-dashboard.tfstate'),'utf8');for(const cookie of await context.cookies())if(cookie.value)assert.ok(!privateState.includes(cookie.value));assert.ok(!privateState.includes('answer_json'))
 await terraform(['destroy','-auto-approve','-input=false','-no-color']);assert.equal((await read()).publishedRevision,2)
 const source=await api('/datasets/'+dataset);await api('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200);await api('/dashboard-authoring/'+id,undefined,404)
 console.log('Dashboard authoring: independent desktop and phone placement, reviewed versioned publication, concurrent refusal, rollback, real CLI and Terraform and estate lifecycle, immutable history and source withdrawal passed')
}
