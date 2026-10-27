import assert from 'node:assert/strict'

/** Native imported answers retain their original audience throughout collaboration. */
export async function proveCollaboration({origin,owner,reader,readerId,page,upload,proveScreen}) {
 const headers={Origin:origin},api='/api/operator'
 const call=async(context,path,data,expected=data===undefined?200:201)=>{
  const response=await context.request.fetch(origin+api+path,{method:data===undefined?'GET':'POST',headers,...data===undefined?{}:{data}})
  assert.equal(response.status(),expected,await response.text())
  return response.json()
 }
 const resolve=(context,subject,expected=200)=>call(context,'/collaboration/resolve',subject,expected)
 const dataset='synthetic-bifocal-2801',calendar='synthetic-bifocal-2802',west='synthetic-bifocal-2803',east='synthetic-bifocal-2804'
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

 // A mention never broadens the audience of an owner-created snapshot or dashboard.
 const owned=await call(owner,'/queries/run',query),dashboard=await call(owner,'/dashboards',{queryId:owned.queryId,title:'synthetic-bifocal-2811'})
 const dashboardSubject={kind:'dashboard',id:dashboard.id},ownerSubject={kind:'answer',id:owned.queryId}
 for(const privateSubject of [ownerSubject,dashboardSubject]){
  await resolve(reader,privateSubject,404)
  assert.ok(!(await resolve(owner,privateSubject)).members.some(member=>member.id===readerId))
  await call(owner,'/collaboration/comments',{...privateSubject,body:'synthetic-bifocal-2812',point:null,mentions:[readerId]},403)
  await call(owner,'/collaboration/links',{...privateSubject,recipientId:readerId,expiresAt:new Date(Date.now()+60000).toISOString(),public:false},403)
 }
 const dashboardComment=await call(owner,'/collaboration/comments',{...dashboardSubject,body:'synthetic-bifocal-2813',point:null,mentions:[]})
 assert.ok((await resolve(owner,dashboardSubject)).comments.some(comment=>comment.id===dashboardComment.id))
 await call(reader,'/collaboration/comments',{...dashboardSubject,body:'synthetic-bifocal-2814',point:null,mentions:[]},404)
 await page.goto(origin+'/app/collaboration/dashboard/'+dashboard.id)
 await page.locator('#collaboration-comments').getByText('synthetic-bifocal-2813',{exact:false}).waitFor()
 await proveScreen('collaboration-private-dashboard-thread')

 const notificationsBefore=await call(reader,'/collaboration/notifications')
 const pointComment=await call(owner,'/collaboration/comments',{...subject,body:'synthetic-bifocal-2815',point:0,mentions:[]})
 const point= (await resolve(reader,subject)).comments.find(comment=>comment.id===pointComment.id)
 assert.equal(point.body,'synthetic-bifocal-2815')
 assert.equal(point.point,0)
 assert.ok(point.authorId&&Number.isFinite(Date.parse(point.createdAt)))
 await page.goto(origin+'/app/collaboration/answer/'+subject.id)
 await page.getByLabel('Comment',{exact:true}).fill('synthetic-bifocal-2816')
 await page.getByLabel('Mention a permitted member',{exact:true}).selectOption(readerId)
 const [posted]=await Promise.all([page.waitForResponse(response=>response.url()===origin+api+'/collaboration/comments'&&response.request().method()==='POST'),page.getByRole('button',{name:'Post comment',exact:true}).click()])
 assert.ok(posted.ok()||posted.status()===303)
 await page.locator('#collaboration-comments').getByText('synthetic-bifocal-2816',{exact:false}).waitFor()
 await proveScreen('collaboration-revenue-spike-mention')
 const mentioned=(await resolve(reader,subject)).comments.find(comment=>comment.body==='synthetic-bifocal-2816')
 assert.ok(mentioned)
 const oldIds=new Set(notificationsBefore.notifications.map(notification=>notification.id))
 const notifications=(await call(reader,'/collaboration/notifications')).notifications.filter(notification=>!oldIds.has(notification.id))
 assert.ok(notifications.length>0,'A currently permitted mention creates a private notification')
 for(const notification of notifications){
  assert.deepEqual(Object.keys(notification).sort(),['createdAt','href','id'],'Notifications carry a private link without comment bodies or source rows')
  assert.ok(notification.href.startsWith('/app/'))
  assert.equal((await reader.request.get(origin+notification.href)).status(),200)
 }

 // The browser creates a recipient-bound link. Possession alone grants nothing.
 await page.getByLabel('Link recipient',{exact:true}).selectOption(readerId)
 await page.getByLabel('Expires in minutes',{exact:true}).fill('5')
 await page.getByRole('button',{name:'Create authenticated link',exact:true}).click()
 const linkLocator=page.locator('#collaboration-links a[href^="/app/shared/"]').first()
 await linkLocator.waitFor()
 const href=await linkLocator.getAttribute('href'),linkId=href.split('/').at(-1)
 assert.equal((await reader.request.get(origin+href)).status(),200)
 await call(reader,'/collaboration/links/'+linkId)
 await call(owner,'/collaboration/links/'+linkId,undefined,403)
 assert.equal((await owner.request.get(origin+href)).status(),403)
 assert.equal((await fetch(origin+href)).status,401)
 const permittedUnfurl=await call(reader,'/collaboration/links/'+linkId+'/unfurl')
 assert.equal(permittedUnfurl.title,original.subject.title)
 assert.equal(permittedUnfurl.href,href)
 assert.ok(!JSON.stringify(permittedUnfurl).includes('synthetic-bifocal-2815'))
 const generic=await call(owner,'/collaboration/links/'+linkId+'/unfurl')
 assert.notEqual(generic.title,original.subject.title)
 assert.ok(!JSON.stringify(generic).includes(original.subject.title))
 await proveScreen('collaboration-recipient-link-review')
 await page.getByRole('button',{name:'Revoke link',exact:true}).first().click()
 await call(reader,'/collaboration/links/'+linkId,undefined,403)
 assert.equal((await reader.request.get(origin+href)).status(),403)
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

 await proveMetricAnnotations({owner,reader,call,resolve,query,timezone:owned.context.timezone})
 console.log('Collaboration: native scoped answers, data-point comments, permitted mentions, private notification links, dashboard threads, recipient binding, expiry, revocation and metric revision annotations passed at 1440 and 390')
}

async function proveMetricAnnotations({owner,reader,call,resolve,query,timezone}) {
 const metricId='synthetic-bifocal-2820',definition={name:'synthetic-bifocal-2821',description:'synthetic-bifocal-2822',grain:'invoice',unit:'money',timezone,accountingBasis:'accrual',query:{...query,groupBy:[]}}
 const metric=await call(owner,'/metrics',{id:metricId,definition})
 await call(owner,'/metrics/'+metricId+'/approve',{revision:1,digest:metric.digest,confirm:'approve',annotation:'synthetic-bifocal-2823'},200)
 const annotation=await call(owner,'/collaboration/annotations',{metricId,revision:1,body:'synthetic-bifocal-2824',point:'2026-10-02'})
 await call(reader,'/collaboration/annotations',{metricId,revision:1,body:'synthetic-bifocal-2825',point:'2026-10-02'},403)
 const first=await call(owner,'/metrics/'+metricId+'/run',{}),second=await call(owner,'/metrics/'+metricId+'/run',{})
 assert.equal(first.answer.totals.revenue.value,'9550.00')
 assert.equal(second.answer.totals.revenue.value,first.answer.totals.revenue.value)
 for(const answer of [first,second]){
  const annotations=(await resolve(owner,{kind:'answer',id:answer.queryId})).annotations
  assert.ok(annotations.some(item=>item.id===annotation.id&&item.body==='synthetic-bifocal-2824'&&item.point==='2026-10-02'),'A dated annotation follows its exact certified metric revision into another answer')
 }
 const proposed=await call(owner,'/metrics/'+metricId+'/propose',{previousRevision:1,definition:{...definition,description:'synthetic-bifocal-2826'}})
 await call(owner,'/metrics/'+metricId+'/approve',{revision:2,digest:proposed.digest,confirm:'approve',annotation:'synthetic-bifocal-2827'},200)
 const revised=await call(owner,'/metrics/'+metricId+'/run',{})
 assert.equal(revised.context.metric.revision,2)
 assert.ok(!(await resolve(owner,{kind:'answer',id:revised.queryId})).annotations.some(item=>item.id===annotation.id),'A prior revision annotation never silently moves to a new definition')
 assert.ok((await resolve(owner,{kind:'answer',id:first.queryId})).annotations.some(item=>item.id===annotation.id),'The retained prior answer keeps its original metric annotation')
}
