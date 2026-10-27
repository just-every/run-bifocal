import assert from 'node:assert/strict'
import {join} from 'node:path'

/** Native imported answers retain their original audience throughout collaboration. */
export async function proveCollaboration({origin,owner,reader,readerId,page,upload,proveScreen}) {
 const headers={Origin:origin},api='/api/operator'
 const call=async(context,path,data,expected=data===undefined?200:201)=>{
  const response=await context.request.fetch(origin+api+path,{method:data===undefined?'GET':'POST',headers,...data===undefined?{}:{data}})
  assert.equal(response.status(),expected,await response.text())
  return response.json()
 }
 const resolve=(context,subject,expected=200)=>call(context,'/collaboration/resolve',subject,expected)
 const dataset='synthetic-bifocal-2801',calendar='synthetic-bifocal-2802',west='West',east='East'
 await upload(dataset,`invoice,date,region,revenue\nsynthetic-bifocal-2805,10/01/2026,${west},$100.00\nsynthetic-bifocal-2806,10/02/2026,${west},$450.00\nsynthetic-bifocal-2807,10/02/2026,${east},$9000.00\n`)
 await call(owner,'/calendars',{id:calendar,previousVersion:null,definition:{name:'synthetic-bifocal-2808',kind:'fiscal',startMonth:1}})
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',sourceCurrency:'USD',scale:2}],semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'text'},{column:'date',type:'date'},{column:'region',type:'text'},{column:'revenue',type:'money'}],hierarchies:[['region','invoice']],slowlyChanging:'reject-duplicate-grain'},context:{modelVersion:'synthetic-bifocal-2809',metricVersion:'draft',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const model=await call(owner,'/models',{definition:{views:[{id:'synthetic-bifocal-2810',kind:'chart',query,rowRules:[]}],quality:[]}})
 const branch='/models/'+model.modelId+'/branches/'+model.branchId,review=await call(owner,branch+'/validate',{},200)
 await call(owner,branch+'/approve',{digest:review.digest},200)
 await call(owner,branch+'/promote',{environment:'staging',digest:review.digest},200)
 await call(owner,branch+'/promote',{environment:'production',digest:review.digest},200)
 const person=(await(await owner.request.get(origin+'/auth/operators')).json()).find(member=>member.id===readerId)
 assert.ok(person)
 const grantInput={operatorId:readerId,operatorVersion:person.version,modelId:model.modelId,revision:model.revision,viewId:'synthetic-bifocal-2810',filters:[{column:'region',op:'eq',value:west}],dimensions:['region','date'],underlying:true,summaryExport:true,underlyingExport:true,expiresAt:new Date(Date.now()+300000).toISOString()}
 const grantReview=await call(owner,'/explore/access/review',grantInput,200)
 const grant=await call(owner,'/explore/access',{...grantInput,reviewedDigest:grantReview.digest})
 const parameters={modelId:model.modelId,revision:model.revision,viewId:'synthetic-bifocal-2810',groupBy:['region'],filters:[]}
 const delegated=await call(reader,'/explore/run',{...parameters,grantId:grant.id})
 const subject={kind:'answer',id:delegated.snapshotId}
 assert.equal(delegated.answer.totals.revenue.value,'550.00')
 assert.equal(delegated.answer.filteredRows,2)
 const original=await resolve(reader,subject)
 assert.equal(original.subject.id,subject.id)
 assert.ok(original.members.some(member=>member.id===readerId))
 assert.equal((await resolve(owner,subject)).subject.id,subject.id)
 const openQuestionThread=async(target,label)=>{
  for(const width of [1440,390]){
   await target.setViewportSize({width,height:1000})
   await target.goto(origin+(target===page?'/app/queries/':'/app/questions/')+subject.id)
   await target.getByRole('status').filter({hasText:target===page?'Answer loaded':'Saved question reopened'}).waitFor()
   assert.ok(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(target===page)await proveScreen(label,{widths:[width],resize:false})
   else if(process.env.BIFOCAL_PROOF_DIR)await target.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png'),fullPage:true})
   await target.getByRole('link',{name:'Comments and sharing',exact:true}).click()
   await target.getByLabel('Comment',{exact:true}).waitFor()
   assert.ok(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  }
 }
 await openQuestionThread(page,'collaboration-owner-saved-analysis')
 const readerPage=await reader.newPage()
 try{await openQuestionThread(readerPage,'collaboration-reader-saved-analysis')}finally{await readerPage.close()}

 // A mention never broadens the audience of an owner-created snapshot or dashboard.
 const owned=await call(owner,'/queries/run',query),dashboard=await call(owner,'/dashboards',{queryId:owned.queryId,title:'October revenue overview'})
 const dashboardSubject={kind:'dashboard',id:dashboard.id},ownerSubject={kind:'answer',id:owned.queryId}
 for(const privateSubject of [ownerSubject,dashboardSubject]){
  await resolve(reader,privateSubject,404)
  assert.ok(!(await resolve(owner,privateSubject)).members.some(member=>member.id===readerId))
  await call(owner,'/collaboration/comments',{...privateSubject,body:'synthetic-bifocal-2812',point:null,mentions:[readerId]},403)
  await call(owner,'/collaboration/links',{...privateSubject,recipientId:readerId,expiresAt:new Date(Date.now()+60000).toISOString(),public:false},403)
 }
 const dashboardComment=await call(owner,'/collaboration/comments',{...dashboardSubject,body:'Renewals explain the October revenue spike.',point:null,mentions:[]})
 assert.ok((await resolve(owner,dashboardSubject)).comments.some(comment=>comment.id===dashboardComment.id))
 await call(reader,'/collaboration/comments',{...dashboardSubject,body:'synthetic-bifocal-2814',point:null,mentions:[]},404)
 await page.goto(origin+'/app/dashboards/'+dashboard.id)
 await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor()
 await proveScreen('collaboration-dashboard-source')
 await page.getByRole('link',{name:'Comments and sharing',exact:true}).click()
 await page.locator('#collaboration-comments').getByText('Renewals explain the October revenue spike.',{exact:false}).waitFor()
 await proveScreen('collaboration-private-dashboard-thread')

 const chartDocument={version:1,title:'Revenue by region',definition:query,visual:{kind:'bar',dimension:'region',measure:'revenue'}}
 const chartReview=await call(owner,'/chart-definitions/review',{document:chartDocument},200)
 const chart=await call(owner,'/chart-definitions/create',{document:chartDocument,reviewedDigest:chartReview.digest})
 const boardDocument={version:2,title:'October revenue dashboard',cards:[{key:'regions',definition:query},{key:'west',definition:{...query,filters:[{column:'region',op:'eq',value:west}]}}],layout:{desktop:[{key:'regions',x:0,y:0,w:6,h:4},{key:'west',x:6,y:0,w:6,h:4}],phone:[{key:'regions',x:0,y:0,w:1,h:4},{key:'west',x:0,y:4,w:1,h:4}]}}
 const draft=await call(owner,'/dashboard-authoring/review',{document:boardDocument},200)
 const authored=await call(owner,'/dashboard-authoring/apply',{document:boardDocument,reviewedDigest:draft.digest})
 const publication={revision:authored.revision,previousGeneration:authored.generation}
 const publicationReview=await call(owner,'/dashboard-authoring/'+authored.id+'/publication/review',{...publication,action:'publish'},200)
 await call(owner,'/dashboard-authoring/'+authored.id+'/publish',{...publication,reviewedDigest:publicationReview.digest},200)
 for(const [kind,id,path] of [['chart',chart.id,'/app/charts/'+chart.id],['authored-dashboard',authored.id,'/app/dashboard-authoring/'+authored.id+'/view']]){
  await resolve(reader,{kind,id},404)
  await call(owner,'/collaboration/comments',{kind,id,body:'Review the regional revenue split.',point:null,mentions:[]})
  await page.goto(origin+path)
  if(kind==='authored-dashboard')await page.locator('#published-dashboard [data-card-key]').first().waitFor()
  await proveScreen('collaboration-'+kind+'-source')
  await page.getByRole('link',{name:'Comments and sharing',exact:true}).click()
  await page.locator('#collaboration-comments').getByText('Review the regional revenue split.',{exact:true}).waitFor()
  await proveScreen('collaboration-'+kind+'-thread')
 }
 const notificationsBefore=await call(reader,'/collaboration/notifications')
 const pointComment=await call(owner,'/collaboration/comments',{...subject,body:'Review the two West renewals on October 2.',point:0,mentions:[]})
 const point= (await resolve(reader,subject)).comments.find(comment=>comment.id===pointComment.id)
 assert.equal(point.body,'Review the two West renewals on October 2.')
 assert.equal(point.point,0)
 assert.ok(point.authorId&&Number.isFinite(Date.parse(point.createdAt)))
 await page.goto(origin+'/app/collaboration/answer/'+subject.id)
 await page.getByLabel('Comment',{exact:true}).fill('Please confirm the regional renewal timing.')
 await page.getByLabel('Mention a permitted member',{exact:true}).selectOption(readerId)
 const [posted]=await Promise.all([page.waitForResponse(response=>response.url()===origin+api+'/collaboration/comments'&&response.request().method()==='POST'),page.getByRole('button',{name:'Post comment',exact:true}).click()])
 assert.ok(posted.ok()||posted.status()===303)
 await page.locator('#collaboration-comments').getByText('Please confirm the regional renewal timing.',{exact:false}).waitFor()
 await proveScreen('collaboration-revenue-spike-mention')
 const mentioned=(await resolve(reader,subject)).comments.find(comment=>comment.body==='Please confirm the regional renewal timing.')
 assert.ok(mentioned)
 assert.deepEqual(mentioned.mentions,[readerId])
 const oldIds=new Set(notificationsBefore.notifications.map(notification=>notification.id))
 const notifications=(await call(reader,'/collaboration/notifications')).notifications.filter(notification=>!oldIds.has(notification.id))
 assert.ok(notifications.length>0,'A currently permitted mention creates a private notification')
 for(const notification of notifications){
  assert.deepEqual(Object.keys(notification).sort(),['createdAt','href','id'],'Notifications carry a private link without comment bodies or source rows')
  assert.ok(notification.href.startsWith('/app/'))
  assert.equal((await reader.request.get(origin+notification.href)).status(),200)
 }

 // The browser creates a recipient-bound link. Possession alone grants nothing.
 await page.getByText('Authenticated links',{exact:true}).click()
 await page.getByLabel('Link recipient',{exact:true}).selectOption(readerId)
 await page.getByLabel('Expires in minutes',{exact:true}).fill('5')
 const [createdLink]=await Promise.all([page.waitForResponse(response=>response.url()===origin+api+'/collaboration/links'&&response.request().method()==='POST'),page.getByRole('button',{name:'Create authenticated link',exact:true}).click()])
 assert.equal(createdLink.status(),201)
 const created=await createdLink.json(),linkLocator=page.locator('#collaboration-links a[href="'+created.href+'"]')
 await linkLocator.waitFor()
 const href=await linkLocator.getAttribute('href'),linkId=href.split('/').at(-1)
 assert.equal((await reader.request.get(origin+href)).status(),200)
 await call(reader,'/collaboration/links/'+linkId)
 await call(owner,'/collaboration/links/'+linkId,undefined,403)
 assert.equal((await owner.request.get(origin+href)).status(),403)
 assert.equal((await owner.request.get(origin+href)).status(),403)
 const sharedPage=await reader.newPage()
 await sharedPage.goto(origin+href)
 await sharedPage.locator('#collaboration-comments').getByText('Please confirm the regional renewal timing.',{exact:true}).waitFor()
 for(const width of [1440,390]){await sharedPage.setViewportSize({width,height:1000});assert.ok(await sharedPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.BIFOCAL_PROOF_DIR)await sharedPage.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,'collaboration-recipient-shared-'+width+'.png'),fullPage:true})}
 await sharedPage.goto(origin+'/app/collaboration/notifications')
 await sharedPage.getByRole('link',{name:'Open permitted mention',exact:true}).first().waitFor()
 for(const width of [1440,390]){await sharedPage.setViewportSize({width,height:1000});assert.ok(await sharedPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.BIFOCAL_PROOF_DIR)await sharedPage.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,'collaboration-recipient-notifications-'+width+'.png'),fullPage:true})}
 await sharedPage.close()
 const permittedUnfurl=await call(reader,'/collaboration/links/'+linkId+'/unfurl')
 assert.equal(permittedUnfurl.title,original.subject.title)
 assert.equal(permittedUnfurl.href,href)
 assert.ok(!JSON.stringify(permittedUnfurl).includes('Review the two West renewals on October 2.'))
 const generic=await call(owner,'/collaboration/links/'+linkId+'/unfurl')
 assert.notEqual(generic.title,original.subject.title)
 assert.ok(!JSON.stringify(generic).includes(original.subject.title))
 assert.deepEqual(await call(owner,'/collaboration/links/'+linkId+'/unfurl'),generic)
 await call(owner,'/collaboration/links',{...subject,recipientId:readerId,expiresAt:new Date(Date.now()+60000).toISOString(),public:true},403)
 await proveScreen('collaboration-recipient-link-review')
 const [revoked]=await Promise.all([page.waitForResponse(response=>response.url().endsWith('/links/'+linkId+'/revoke')),linkLocator.locator('..').getByRole('button',{name:'Revoke link',exact:true}).click()])
 assert.equal(revoked.status(),200)
 await call(reader,'/collaboration/links/'+linkId,undefined,403)
 assert.equal((await reader.request.get(origin+href)).status(),403)
 const deniedPage=await reader.newPage()
 const denied=await deniedPage.goto(origin+href);assert.equal(denied.status(),403)
 await deniedPage.getByRole('heading',{name:'Collaboration access unavailable',exact:true}).waitFor()
 for(const width of [1440,390]){await deniedPage.setViewportSize({width,height:1000});assert.ok(await deniedPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(!(await deniedPage.locator('main').innerText()).includes('Please confirm'));if(process.env.BIFOCAL_PROOF_DIR)await deniedPage.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,'collaboration-revoked-'+width+'.png'),fullPage:true})}
 await deniedPage.close()
 assert.deepEqual(await call(reader,'/collaboration/links/'+linkId+'/unfurl'),generic)
 // Revoking a link leaves the recipient's independent, active answer authority intact.
 assert.ok((await resolve(reader,subject)).comments.some(comment=>comment.id===mentioned.id))

 const expiring=await call(owner,'/collaboration/links',{...subject,recipientId:readerId,expiresAt:new Date(Date.now()+2500).toISOString(),public:false})
 await call(reader,'/collaboration/links/'+expiring.id)
 await new Promise(done=>setTimeout(done,Math.max(0,Date.parse(expiring.expiresAt)-Date.now()+100)))
 await call(reader,'/collaboration/links/'+expiring.id,undefined,403)
 assert.equal((await reader.request.get(origin+expiring.href)).status(),403)
 assert.deepEqual(await call(reader,'/collaboration/links/'+expiring.id+'/unfurl'),generic)

 const retained=await call(owner,'/collaboration/links',{...subject,recipientId:readerId,expiresAt:new Date(Date.now()+60000).toISOString(),public:false})
 await call(owner,'/explore/access/'+grant.id+'/revoke',{},200)
 await resolve(reader,subject,403)
 await call(reader,'/collaboration/comments',{...subject,body:'synthetic-bifocal-2817',point:null,mentions:[]},403)
 await call(owner,'/collaboration/comments',{...subject,body:'synthetic-bifocal-2818',point:null,mentions:[readerId]},403)
 await call(owner,'/collaboration/links',{...subject,recipientId:readerId,expiresAt:new Date(Date.now()+60000).toISOString(),public:false},403)
 await call(reader,'/collaboration/links/'+retained.id,undefined,403)
 assert.deepEqual(await call(reader,'/collaboration/links/'+retained.id+'/unfurl'),generic)
 assert.equal((await reader.request.get(origin+retained.href)).status(),403)
 assert.equal((await reader.request.get(origin+'/app/collaboration/answer/'+subject.id)).status(),403)
 for(const scope of ['summary','underlying'])await call(reader,'/explore/'+subject.id+'/export',{scope,format:'csv'},403)
 const removed=new Set(notifications.map(notification=>notification.id))
 assert.ok((await call(reader,'/collaboration/notifications')).notifications.every(notification=>!removed.has(notification.id)))
 assert.ok((await resolve(owner,subject)).comments.some(comment=>comment.id===pointComment.id),'Owner retains the discussion after delegated authority is withdrawn')

 const metricCharts=await proveMetricAnnotations({origin,owner,reader,page,proveScreen,call,resolve,query,timezone:owned.context.timezone})
 const source=await call(owner,'/datasets/'+dataset)
 const erased=await call(owner,'/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200)
 for(const store of ['bf_collaboration_comments','bf_collaboration_links','bf_collaboration_notifications','bf_collaboration_annotations'])assert.ok(erased.stores.some(entry=>entry.store===store&&entry.rows>0),'Erasure accounts for '+store)
 await resolve(owner,dashboardSubject,404)
 await resolve(owner,ownerSubject,404)
 for(const id of metricCharts){await call(owner,'/charts/'+id,undefined,404);assert.equal((await owner.request.get(origin+'/app/charts/'+id)).status(),404)}
 assert.deepEqual(await call(reader,'/collaboration/links/'+retained.id+'/unfurl'),generic)
 console.log('Collaboration: native scoped answers, data-point comments, permitted mentions, private notification links, dashboard threads, recipient binding, expiry, revocation and metric revision annotations passed at 1440 and 390')
}

async function proveMetricAnnotations({origin,owner,reader,page,proveScreen,call,resolve,query,timezone}) {
 const metricId='synthetic-bifocal-2820',definition={name:'Certified revenue',description:'synthetic-bifocal-2822',grain:'invoice',unit:'money',timezone,accountingBasis:'accrual',query:{...query,groupBy:[]}}
 const metric=await call(owner,'/metrics',{id:metricId,definition})
 await call(owner,'/metrics/'+metricId+'/approve',{revision:1,digest:metric.digest,confirm:'approve',annotation:'synthetic-bifocal-2823'},200)
 const annotation=await call(owner,'/collaboration/annotations',{metricId,revision:1,body:'October 2 renewal recognised in revenue.',point:'2026-10-02'})
 await page.goto(origin+'/app/metrics/'+metricId)
 await page.getByRole('link',{name:'Comments and sharing',exact:true}).waitFor()
 await proveScreen('collaboration-certified-metric-source')
 await page.getByRole('link',{name:'Comments and sharing',exact:true}).click()
 await page.locator('#collaboration-annotations').getByText('October 2 renewal recognised in revenue.',{exact:false}).waitFor()
 await proveScreen('collaboration-certified-revenue-spike-annotation')
 await call(reader,'/collaboration/annotations',{metricId,revision:1,body:'synthetic-bifocal-2825',point:'2026-10-02'},403)
 const seriesPath='/metrics/'+metricId+'/series-',seriesInput={title:'Certified daily revenue',dateColumn:'date',revision:1}
 await call(reader,seriesPath+'review',seriesInput,401)
 await call(owner,seriesPath+'review',{...seriesInput,dateColumn:'region'},400)
 await call(owner,seriesPath+'review',{...seriesInput,revision:2},409)
 const seriesReview=await call(owner,seriesPath+'review',seriesInput,200)
 assert.deepEqual(seriesReview.answer.rows.map(row=>[row.dimensions[0],row.values.revenue.value]),[['2026-10-01','100.00'],['2026-10-02','9450.00']])
 assert.equal(seriesReview.answer.totals.revenue.value,'9550.00')
 await call(owner,seriesPath+'create',{...seriesInput,title:'Changed after review',reviewedDigest:seriesReview.digest},409)
 await call(owner,seriesPath+'create',seriesInput,409)
 const machineAttempt=await owner.request.post(origin+'/api/operator'+seriesPath+'create',{headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-2830'},data:{...seriesInput,reviewedDigest:seriesReview.digest}})
 assert.equal(machineAttempt.status(),403)
 // The first chart is authored through the installed metric review form.
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(origin+'/app/metrics/'+metricId)
 await page.getByLabel('Chart title',{exact:true}).fill('Certified daily revenue')
 await page.getByLabel('Date column',{exact:true}).fill('date')
 await page.getByRole('button',{name:'Review date series',exact:true}).click()
 await page.getByRole('heading',{name:'Review certified metric chart',exact:true}).waitFor()
 await proveScreen('collaboration-metric-series-review')
 await page.getByRole('button',{name:'Create reviewed chart',exact:true}).click()
 await page.waitForURL(/\/app\/charts\/[a-f0-9-]{36}$/)
 const firstChartId=new URL(page.url()).pathname.split('/').at(-1)
 const secondChart=await call(owner,seriesPath+'create',{...seriesInput,reviewedDigest:seriesReview.digest})
 for(const id of [firstChartId,secondChart.id]){
  const chart=await call(owner,'/charts/'+id)
  assert.deepEqual(chart.context.metric,{id:metricId,revision:1,digest:metric.digest})
  assert.deepEqual(chart.annotations.map(item=>[item.id,item.point,item.body]),[[annotation.id,'2026-10-02','October 2 renewal recognised in revenue.']])
  assert.deepEqual((await resolve(owner,{kind:'chart',id})).annotations.map(item=>item.id),[annotation.id])
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(origin+'/app/charts/'+id)
  const point=page.locator('.native-chart li').filter({hasText:'2026-10-02'})
  assert.equal(await point.locator('.metric-annotation').innerText(),'October 2 renewal recognised in revenue. · Metric revision 1')
  assert.ok((await point.innerText()).includes('USD 9450.00'))
  assert.equal(await page.locator('.native-chart li').filter({hasText:'2026-10-01'}).locator('.metric-annotation').count(),0)
  assert.equal((await reader.request.get(origin+'/api/operator/charts/'+id)).status(),401)
 }
 await proveScreen('collaboration-metric-series-chart')
 const first=await call(owner,'/metrics/'+metricId+'/run',{}),second=await call(owner,'/metrics/'+metricId+'/run',{})
 assert.equal(first.answer.totals.revenue.value,'9550.00')
 assert.equal(second.answer.totals.revenue.value,first.answer.totals.revenue.value)
 for(const answer of [first,second]){
  const annotations=(await resolve(owner,{kind:'answer',id:answer.queryId})).annotations
  assert.ok(annotations.some(item=>item.id===annotation.id&&item.body==='October 2 renewal recognised in revenue.'&&item.point==='2026-10-02'),'A dated annotation follows its exact certified metric revision into another answer')
 }
 const proposed=await call(owner,'/metrics/'+metricId+'/propose',{previousRevision:1,definition:{...definition,description:'synthetic-bifocal-2826'}})
 await call(owner,'/metrics/'+metricId+'/approve',{revision:2,digest:proposed.digest,confirm:'approve',annotation:'synthetic-bifocal-2827'},200)
 await call(owner,seriesPath+'create',{...seriesInput,reviewedDigest:seriesReview.digest},409)
 const nextInput={...seriesInput,revision:2},nextReview=await call(owner,seriesPath+'review',nextInput,200)
 const nextChart=await call(owner,seriesPath+'create',{...nextInput,reviewedDigest:nextReview.digest})
 assert.deepEqual((await call(owner,'/charts/'+nextChart.id)).annotations,[])
 assert.deepEqual((await call(owner,'/charts/'+firstChartId)).annotations.map(item=>item.id),[annotation.id])
 const revised=await call(owner,'/metrics/'+metricId+'/run',{})
 assert.equal(revised.context.metric.revision,2)
 assert.ok(!(await resolve(owner,{kind:'answer',id:revised.queryId})).annotations.some(item=>item.id===annotation.id),'A prior revision annotation never silently moves to a new definition')
 assert.ok((await resolve(owner,{kind:'answer',id:first.queryId})).annotations.some(item=>item.id===annotation.id),'The retained prior answer keeps its original metric annotation')
 return [firstChartId,secondChart.id,nextChart.id]
}
