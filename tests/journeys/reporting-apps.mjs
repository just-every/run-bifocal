import assert from 'node:assert/strict'
import {proveAppReader} from './reporting-app-reader.mjs'
import {join} from 'node:path'

/** Curated reporting apps through the real owner, member and import doors. */
export async function proveReportingApps({origin,browser,owner,page,devKey,upload}) {
 const headers={Origin:origin}
 const call=async(context,path,data,expected=data===undefined?200:201,method=data===undefined?'GET':'POST')=>{
  const response=await context.request.fetch(origin+'/api/operator'+path,{method,headers,...data===undefined?{}:{data}});assert.equal(response.status(),expected,await response.text());return response.json()
 }
 const screen=async(target,label)=>{for(const width of [1440,390]){await target.setViewportSize({width,height:1000});assert.ok(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflows at '+width);assert.equal(await target.locator('button').evaluateAll(buttons=>buttons.filter(button=>!button.textContent.trim()).length),0);if(process.env.BIFOCAL_PROOF_DIR)await target.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,label+'-'+width+'.png'),fullPage:true})}}
 const members={}
 const invite=async(name,email)=>{
  const context=await browser.newContext();assert.equal((await context.request.post(origin+'/__dev/key',{headers,data:{key:devKey}})).status(),204)
  assert.equal((await owner.request.post(origin+'/auth/invite',{headers,data:{email,displayName:name,role:'member'}})).status(),202)
  const person=async()=>(await(await owner.request.get(origin+'/auth/operators')).json()).find(p=>p.email===email)
  await context.request.get(new URL((await person()).signInUrl,origin).href)
  return members[name]={context,email,person,page:await context.newPage()}
 }
 const [alice,bob,carol,dave,erin,uninvited]=await Promise.all([['Alice Sales','synthetic-bifocal-app-alice@example.test'],['Bob Finance','synthetic-bifocal-app-bob@example.test'],['Carol Board','synthetic-bifocal-app-carol@example.test'],['Dave Both','synthetic-bifocal-app-dave@example.test'],['Erin Analyst','synthetic-bifocal-app-erin@example.test'],['Uma Uninvited','synthetic-bifocal-app-uma@example.test']].map(([name,email])=>invite(name,email)))
 // Source rows, one calendar, and the retained content an app can package.
 const dataset='synthetic-bifocal-app-sales'
 await upload(dataset,'invoice,region,date,revenue\n1,West,03/05/2026,$100.00\n2,West,03/06/2026,$50.00\n3,East,03/05/2026,$200.00\n4,North,03/07/2026,$25.00\n')
 assert.equal((await owner.request.post(origin+'/api/operator/calendars',{headers,data:{id:'synthetic-bifocal-app-calendar',previousVersion:null,definition:{name:'App year',kind:'fiscal',startMonth:1}}})).status(),201)
 const query=(filters=[],groupBy=['region'])=>({version:1,dataset,joins:[],filters,groupBy,measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'}],semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'number'},{column:'region',type:'text'}],hierarchies:[['region']],slowlyChanging:'reject-duplicate-grain'},context:{modelVersion:'synthetic-bifocal-app-v1',metricVersion:'synthetic-bifocal-app-v1',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-app-calendar',version:1},rounding:'half-even'}})
 const answer=await call(owner,'/queries/run',query()),report=await call(owner,'/reports',{queryId:answer.queryId,title:'Finance close report'}),artifact=await call(owner,'/dashboards',{queryId:answer.queryId,title:'Board summary'})
 const authored=title=>({version:2,title,interactions:{dimensions:['region']},cards:[{key:'by-region',definition:query()},{key:'total',definition:query([],[])}],layout:{desktop:[{key:'by-region',x:0,y:0,w:6,h:4},{key:'total',x:6,y:0,w:6,h:4}],phone:[{key:'by-region',x:0,y:0,w:1,h:4},{key:'total',x:0,y:4,w:1,h:4}]}})
 const draftReview=await call(owner,'/dashboard-authoring/review',{document:authored('Pipeline overview'),id:null,previousRevision:null},200)
 const dashboard=await call(owner,'/dashboard-authoring/apply',{document:authored('Pipeline overview'),id:null,previousRevision:null,reviewedDigest:draftReview.digest})
 const publication=await call(owner,'/dashboard-authoring/'+dashboard.id+'/publication/review',{revision:1,previousGeneration:0,action:'publish'},200)
 await call(owner,'/dashboard-authoring/'+dashboard.id+'/publish',{revision:1,previousGeneration:0,reviewedDigest:publication.digest},200)
 const metricDefinition={name:'App revenue',description:'USD revenue',grain:'invoice',unit:'money',timezone:'America'+'/'+'New_York',accountingBasis:'accrual',query:query([],[])}
 const metric=await call(owner,'/metrics',{id:'synthetic-bifocal-app-revenue',definition:metricDefinition})
 await call(owner,'/metrics/synthetic-bifocal-app-revenue/approve',{revision:1,digest:metric.digest,confirm:'approve',annotation:'App revenue review'},200)
 await call(owner,'/goals',{id:'synthetic-bifocal-app-goal',metricId:'synthetic-bifocal-app-revenue',title:'Annual revenue',from:'2026-01-01',to:'2027-01-01',dateColumn:'date',target:'1000.00',currency:'USD',maxAgeSeconds:86400})
 // Native app: all four content kinds, an unrestricted audience and refused rule violations.
 const native={version:1,title:'Operating review',expiresAt:new Date(Date.now()+6*86400000).toISOString(),pages:[{key:'pipeline',title:'Pipeline',kind:'dashboard',ref:dashboard.id},{key:'close',title:'Close',kind:'report',ref:report.id},{key:'detail',title:'Detail',kind:'question',ref:answer.queryId},{key:'goal',title:'Revenue goal',kind:'scorecard',ref:'synthetic-bifocal-app-goal'}],audiences:[{key:'analysts',name:'Analysts',landing:'pipeline',pages:['pipeline','close','detail','goal'],rows:[],columns:null}]}
 const nativeApp=await call(owner,'/apps',{document:native})
 await call(owner,'/apps',{document:{...native,audiences:[{...native.audiences[0],rows:[{column:'region',op:'between',value:'x'}]}]}},400)
 await call(alice.context,'/apps',{document:native},403)
 const restricted={...native,audiences:[...native.audiences,{key:'west',name:'West team',landing:'pipeline',pages:['pipeline','goal'],rows:[{column:'region',op:'eq',value:'West'}],columns:['region']}]}
 const restrictedDraft=await call(owner,'/apps/'+nativeApp.id+'/draft',{previousRevision:1,document:restricted})
 const refused=await call(owner,'/apps/'+nativeApp.id+'/publication/review',{draftRevision:restrictedDraft.draftRevision},200)
 assert.deepEqual(refused.issues.map(i=>i.error).sort(),['audience_column_not_permitted','scorecard_row_scope_unsupported'],'Column and scorecard row rules refuse publication')
 await call(owner,'/apps/'+nativeApp.id+'/publication/publish',{draftRevision:restrictedDraft.draftRevision,reviewedDigest:refused.reviewDigest},409)
 const analysts=await call(owner,'/apps/'+nativeApp.id+'/draft',{previousRevision:2,document:native}),nativeReview=await call(owner,'/apps/'+nativeApp.id+'/publication/review',{draftRevision:analysts.draftRevision},200)
 assert.equal(nativeReview.issues.length,0)
 await call(owner,'/apps/'+nativeApp.id+'/publication/publish',{draftRevision:analysts.draftRevision,reviewedDigest:'0'.repeat(64)},409)
 await call(owner,'/apps/'+nativeApp.id+'/publication/publish',{draftRevision:analysts.draftRevision,reviewedDigest:nativeReview.reviewDigest})
 const erinPerson=await erin.person()
 await call(owner,'/apps/'+nativeApp.id+'/members',{audience:'analysts',operatorId:erinPerson.id,operatorVersion:erinPerson.version,enabled:true},200,'PUT')
 const nativeView=await call(erin.context,'/apps/'+nativeApp.id),read=key=>call(erin.context,'/apps/'+nativeApp.id+'/audiences/analysts/pages/'+key)
 assert.deepEqual(nativeView.audiences[0].pages.map(p=>p.kind),['dashboard','report','question','scorecard'])
 const total=content=>content.cards[0].totals.revenue.value
 assert.equal((await read('pipeline')).cards.find(c=>c.label==='total').totals.revenue.value,'375.00');assert.equal(total(await read('close')),'375.00');assert.equal(total(await read('detail')),'375.00')
 const goal=await read('goal');assert.equal(goal.target.amount,'1000.00');assert.equal(goal.cards[0].totals.revenue.value,'375.00')
 // A copied owner query cannot remove a published model's fixed row rules.
 const model=await call(owner,'/models',{definition:{views:[{id:'sales',kind:'chart',query:query(),rowRules:[{column:'region',op:'eq',value:'West'}]}],quality:[]}}),modelBranch='/models/'+model.modelId+'/branches/'+model.branchId,modelReview=await call(owner,modelBranch+'/validate',{},200)
 assert.equal(modelReview.compatible,true)
 await call(owner,modelBranch+'/approve',{digest:modelReview.digest},200);await call(owner,modelBranch+'/promote',{environment:'staging',digest:modelReview.digest},200);await call(owner,modelBranch+'/promote',{environment:'production',digest:modelReview.digest},200)
 const copied=await call(owner,'/queries/run',{...query(),context:{...query().context,modelVersion:model.revision}})
 const modelDocument={...native,title:'Model restriction review',pages:[{key:'bounded',title:'Bounded question',kind:'question',ref:copied.queryId}],audiences:[{key:'east',name:'East only',landing:'bounded',pages:['bounded'],rows:[{column:'region',op:'eq',value:'East'}],columns:null}]}
 const boundedApp=await call(owner,'/apps',{document:modelDocument}),boundedReview=await call(owner,'/apps/'+boundedApp.id+'/publication/review',{draftRevision:1},200)
 assert.equal(boundedReview.preview[0].filteredRows,0,'Audience and published-model row rules intersect before aggregation')
 await call(owner,'/apps/'+boundedApp.id+'/publication/publish',{draftRevision:1,reviewedDigest:boundedReview.reviewDigest})
 await call(owner,'/apps/'+boundedApp.id+'/members',{audience:'east',operatorId:erinPerson.id,operatorVersion:erinPerson.version,enabled:true},200,'PUT')
 assert.equal((await call(erin.context,'/apps/'+boundedApp.id+'/audiences/east/pages/bounded')).cards[0].filteredRows,0)
 // A later author edit and a later dataset revision never rewrite the published version's frozen content.
 const revised=authored('Changed after publication');revised.cards=[{key:'changed-a',definition:query()},{key:'changed-b',definition:query([],[])}];revised.layout.desktop=revised.layout.desktop.map((p,i)=>({...p,key:['changed-a','changed-b'][i]}));revised.layout.phone=revised.layout.phone.map((p,i)=>({...p,key:['changed-a','changed-b'][i]}))
 const revisedReview=await call(owner,'/dashboard-authoring/review',{document:revised,id:dashboard.id,previousRevision:1},200)
 await call(owner,'/dashboard-authoring/apply',{document:revised,id:dashboard.id,previousRevision:1,reviewedDigest:revisedReview.digest})
 assert.deepEqual((await read('pipeline')).cards.map(c=>c.label),['by-region','total'])
 // Power BI app import with Sales, Finance and Board audiences, driven through the owner screens.
 const alicePerson=await alice.person(),bobPerson=await bob.person(),carolPerson=await carol.person(),davePerson=await dave.person()
 const powerBi={format:'power-bi-app',version:1,app:{id:'synthetic-bifocal-pbi-app',name:'Regional performance',description:'Synthetic Power BI app export'},
  content:[{id:'r-pipeline',type:'dashboard',name:'Pipeline overview'},{id:'r-detail',type:'report',name:'Sales detail'},{id:'r-finance',type:'report',name:'Finance close report'},{id:'r-board',type:'dashboard',name:'Board summary'}],
  rowRoles:[{name:'West sales',rules:[{table:'Sales',column:'region',operator:'=',value:'West'}]},{name:'East finance',rules:[{table:'Sales',column:'region',operator:'=',value:'East'}]}],
  audiences:[{name:'Sales',members:[alice,dave].map(m=>({identifier:m.email,principalType:'User'})).concat([{identifier:'synthetic-bifocal-app-ghost@example.test',principalType:'User'}]),content:['r-pipeline','r-detail'],rowRole:'West sales'},
   {name:'Finance',members:[bob,dave].map(m=>({identifier:m.email,principalType:'User'})),content:['r-finance','r-detail'],landing:'r-finance',rowRole:'East finance'},
   {name:'Board',members:[{identifier:carol.email,principalType:'User'},{identifier:'synthetic-bifocal-app-group@example.test',principalType:'Group'}],content:['r-board']}]}
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/apps');await page.getByRole('heading',{name:'Reporting apps',exact:true}).waitFor()}
 await screen(page,'apps-owner-list')
 await page.getByLabel('Power BI app export (JSON)',{exact:true}).setInputFiles({name:'synthetic-bifocal-power-bi-app.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(powerBi))})
 await page.getByRole('button',{name:'Review import',exact:true}).click()
 await page.getByText('Regional performance · 3 audiences · 4 content items',{exact:false}).waitFor()
 await screen(page,'apps-import-review')
 await page.getByLabel('I reviewed this exact plan and its fingerprint',{exact:true}).check()
 await page.getByRole('button',{name:'Apply import',exact:true}).click()
 await page.getByRole('heading',{name:'Map content and people',exact:true}).waitFor()
 for(const [name,type,id,kind] of [['Pipeline overview','dashboard',dashboard.id,'dashboard'],['Sales detail','report',answer.queryId,'question'],['Finance close report','report',report.id,'report'],['Board summary','dashboard',artifact.id,'dashboard']]){
  await page.getByLabel(`${name} (${type}) Bifocal content ID`,{exact:true}).fill(id);await page.getByLabel('Content kind for '+name,{exact:true}).selectOption(kind)
 }
 await page.getByLabel('Bifocal column for Sales.region',{exact:true}).fill('region')
 await screen(page,'apps-import-mapping')
 assert.ok(await page.getByLabel(/synthetic-bifocal-app-group@example.test is unmapped/).isDisabled(),'Group principals stay unmapped')
 await page.getByRole('button',{name:'Review mapping',exact:true}).click()
 await page.getByText('mapped readers 5',{exact:false}).waitFor()
 await page.getByLabel('I reviewed this exact draft and its identity mappings',{exact:true}).check()
 await Promise.all([page.waitForURL(/\/app\/apps\/[a-f0-9-]{36}$/),page.getByRole('button',{name:'Create draft app',exact:true}).click()])
 const appId=new URL(page.url()).pathname.split('/').at(-1);await page.getByRole('heading',{name:'Regional performance',exact:true}).waitFor()
 const detail=await call(owner,'/apps/'+appId);assert.equal(detail.publishedVersion,null)
 assert.equal((await call(alice.context,'/apps/'+appId,undefined,404)).error,'app_not_found','Mapped members stay inactive until publication')
 assert.deepEqual((await call(alice.context,'/apps/home')).apps,[])
 await screen(page,'apps-draft')
 await page.getByRole('button',{name:'Review publication',exact:true}).click()
 await page.getByText('No issues found.',{exact:true}).waitFor();await screen(page,'apps-publish-review')
 await page.getByLabel('I reviewed this exact version, its audiences and their row scope',{exact:true}).check()
 await Promise.all([page.waitForURL(origin+'/app/apps/'+appId),page.getByRole('button',{name:'Publish version 1',exact:true}).click()])
 await page.getByText('Published version 1',{exact:false}).first().waitFor();await screen(page,'apps-published')
 assert.equal((await owner.request.post(origin+'/api/operator/apps/'+appId+'/publication/review',{headers:{Origin:'https://foreign.example.test'},data:{draftRevision:1}})).status(),401)
 assert.equal((await fetch(origin+'/api/operator/apps/home')).status,401)
 // Later author publication and restoration leave the app's exact pinned revision alone.
 const laterReview=await call(owner,'/dashboard-authoring/'+dashboard.id+'/publication/review',{revision:2,previousGeneration:1,action:'publish'},200)
 await call(owner,'/dashboard-authoring/'+dashboard.id+'/publish',{revision:2,previousGeneration:1,reviewedDigest:laterReview.digest},200)
 const pinned=await call(alice.context,'/apps/'+appId+'/audiences/sales/pages/page-1/dashboard/run',{selection:{}},200)
 assert.deepEqual(pinned.cards.map(card=>card.key),['by-region','total']);assert.equal(pinned.cards.find(card=>card.key==='total').answer.totals.revenue.value,'150.00')
 const authorBack=await call(owner,'/dashboard-authoring/'+dashboard.id+'/publication/review',{revision:1,previousGeneration:2,action:'rollback'},200)
 await call(owner,'/dashboard-authoring/'+dashboard.id+'/rollback',{revision:1,previousGeneration:2,reviewedDigest:authorBack.digest},200)
 // Each audience sees only its own navigation and rows; the dual member sees the union; others see nothing.
 const nav=async member=>(await call(member.context,'/apps/'+appId)).audiences
 const page_=(member,audience,key)=>call(member.context,'/apps/'+appId+'/audiences/'+audience+'/pages/'+key)
 assert.deepEqual((await nav(alice)).map(a=>a.name),['Sales']);assert.deepEqual((await nav(bob)).map(a=>a.name),['Finance']);assert.deepEqual((await nav(carol)).map(a=>a.name),['Board'])
 assert.deepEqual((await nav(dave)).map(a=>a.name),['Sales','Finance'])
 assert.equal((await call(uninvited.context,'/apps/'+appId,undefined,404)).error,'app_not_found');assert.deepEqual((await call(uninvited.context,'/apps/home')).apps,[])
 const west=await page_(alice,'sales','page-1');assert.deepEqual(west.cards.find(c=>c.label==='by-region').rows.map(r=>[r.dimensions[0],r.values.revenue.value]),[['West','150.00']]);assert.equal(west.cards.find(c=>c.label==='total').totals.revenue.value,'150.00')
 assert.equal((await page_(bob,'finance','page-3')).cards[0].totals.revenue.value,'200.00');assert.equal((await page_(carol,'board','page-4')).cards[0].totals.revenue.value,'375.00')
 assert.equal((await page_(dave,'sales','page-2')).cards[0].totals.revenue.value,'150.00');assert.equal((await page_(dave,'finance','page-2')).cards[0].totals.revenue.value,'200.00','The same page shows each audience its own rows')
 for(const [member,audience,key] of [[alice,'finance','page-3'],[alice,'board','page-4'],[bob,'sales','page-1'],[carol,'sales','page-1'],[uninvited,'sales','page-1']])assert.equal((await call(member.context,'/apps/'+appId+'/audiences/'+audience+'/pages/'+key,undefined,member===uninvited?404:404)).error,member===uninvited?'app_not_found':'app_page_not_found')
 for(const member of [alice,bob,carol,dave]){const text=await(await member.context.request.get(origin+'/app/apps/'+appId)).text();if(member!==dave&&member!==bob)assert.ok(!text.includes('Finance close report'),'Hidden page names are not rendered');assert.ok(text.includes('Regional performance'))}
 assert.equal((await alice.context.request.get(origin+'/api/operator/datasets/'+dataset)).status(),401,'Audience reading never opens source rows')
 assert.equal((await uninvited.context.request.get(origin+'/app/apps/'+appId)).status(),404)
 // Pushed home placement and the reader screens.
 for(const [member,name] of [[alice,'Sales'],[bob,'Finance'],[carol,'Board'],[dave,'Sales, Finance']]){const text=await(await member.context.request.get(origin+'/app')).text();assert.ok(text.includes('Your apps')&&text.includes('Regional performance')&&text.includes(name),'Entitled apps are placed on home')}
 assert.ok(!(await(await uninvited.context.request.get(origin+'/app')).text()).includes('Your apps'))
 await dave.page.goto(origin+'/app');await dave.page.getByRole('heading',{name:'Your apps'}).waitFor();await screen(dave.page,'apps-home-placement')
 await dave.page.goto(origin+'/app/apps/'+appId+'/finance/page-2');await dave.page.getByRole('heading',{name:'Sales detail',exact:true}).waitFor();await screen(dave.page,'apps-reader-finance-rows')
 await alice.page.goto(origin+'/app/apps/'+appId+'/sales/page-1');await alice.page.getByRole('heading',{name:'Pipeline overview',exact:true}).waitFor();await alice.page.getByRole('table',{name:'Exact by-region results',exact:true}).waitFor();await screen(alice.page,'apps-reader-sales')
 const appReader='/apps/'+appId+'/audiences/sales/pages/page-1/dashboard'
 const scoped=await call(alice.context,appReader+'/run',{selection:{}},200)
 assert.equal(scoped.cards.find(c=>c.key==='total').answer.totals.revenue.value,'150.00')
 assert.equal(JSON.stringify(scoped).includes('ownerId'),false);assert.equal(JSON.stringify(scoped).includes('dataset'),false)
 const narrowed=await call(alice.context,appReader+'/run',{selection:{filters:[{column:'region',op:'eq',value:'East'}]}},200)
 assert.equal(narrowed.cards.find(c=>c.key==='total').status,'empty','App reader choices intersect audience rules')
 await call(alice.context,appReader+'/reader-bookmarks',{name:'My narrowed view',previousRevision:null,selection:{filters:[{column:'region',op:'eq',value:'East'}]}})
 assert.deepEqual((await call(dave.context,appReader+'/reader-bookmarks')).bookmarks,[],'Personal reader states are private to the actual audience member')
 assert.equal((await call(dave.context,appReader+'/run',{selection:{}},200)).cards.find(c=>c.key==='total').answer.totals.revenue.value,'150.00','Another viewer reopens unchanged shared defaults')
 await call(uninvited.context,appReader+'/run',{selection:{}},404)

 await uninvited.page.goto(origin+'/app/apps/'+appId);await uninvited.page.getByRole('heading',{name:'App unavailable'}).waitFor();await screen(uninvited.page,'apps-uninvited')
 // Subscription access follows audience membership.
 const subscription=await call(bob.context,'/apps/'+appId+'/subscriptions',{audience:'finance',pageKey:'page-3'});assert.equal(subscription.delivery,'inactive')
 assert.equal((await call(bob.context,'/apps/'+appId+'/subscriptions/'+subscription.id+'/preview',{},200)).delivered,false)
 await bob.page.goto(origin+'/app/apps/'+appId+'/finance/page-3');await bob.page.getByRole('button',{name:'Preview next delivery',exact:true}).click();await bob.page.getByText('Nothing was sent',{exact:false}).waitFor();await screen(bob.page,'apps-subscription')
 const bobDetail=await call(owner,'/apps/'+appId);assert.equal(bobDetail.members.filter(m=>m.audience==='finance').length,2)
 // Draft edits leave readers alone; publish version two; remove a member; roll back.
 const draft=detail.draft.document;draft.pages[0].title='Pipeline overview (revised)'
 const saved=await call(owner,'/apps/'+appId+'/draft',{previousRevision:1,document:draft});await call(owner,'/apps/'+appId+'/draft',{previousRevision:1,document:draft},409)
 assert.equal((await call(alice.context,'/apps/'+appId)).audiences[0].pages[0].title,'Pipeline overview','An unpublished draft never changes readers')
 const review2=await call(owner,'/apps/'+appId+'/publication/review',{draftRevision:saved.draftRevision},200);assert.equal(review2.version,2)
 await call(owner,'/apps/'+appId+'/publication/publish',{draftRevision:saved.draftRevision,reviewedDigest:review2.reviewDigest})
 assert.equal((await call(alice.context,'/apps/'+appId)).audiences[0].pages[0].title,'Pipeline overview (revised)')
 await call(owner,'/apps/'+appId+'/members',{audience:'finance',operatorId:davePerson.id,operatorVersion:davePerson.version,enabled:false},200,'PUT')
 assert.deepEqual((await nav(dave)).map(a=>a.name),['Sales']);await call(dave.context,'/apps/'+appId+'/audiences/finance/pages/page-2',undefined,404)
 await call(owner,'/apps/'+appId+'/rollback/review',{version:2,previousPublished:2},409)
 const back=await call(owner,'/apps/'+appId+'/rollback/review',{version:1,previousPublished:2},200)
 await call(owner,'/apps/'+appId+'/rollback/apply',{version:1,previousPublished:2,reviewedDigest:'0'.repeat(64)},409)
 await page.goto(origin+'/app/apps/'+appId);await page.getByRole('button',{name:'Review restore of version 1',exact:true}).click();await page.locator('#app-restore-result').getByText(/^Version 3 · fingerprint/).waitFor();await screen(page,'apps-restore-review')
 await page.getByLabel('I reviewed this exact version, its audiences and their row scope',{exact:true}).check()
 await Promise.all([page.waitForURL(origin+'/app/apps/'+appId),page.getByRole('button',{name:'Restore version 1 as version 3',exact:true}).click()])
 assert.equal((await call(alice.context,'/apps/'+appId)).audiences[0].pages[0].title,'Pipeline overview');assert.deepEqual((await nav(dave)).map(a=>a.name),['Sales'],'Rollback never revives a removed member')
 const history=await call(owner,'/apps/'+appId);assert.deepEqual(history.versions.map(v=>[v.version,v.action,v.restores]),[[3,'rollback',1],[2,'publish',null],[1,'publish',null]]);assert.equal(history.publishedVersion,3)
 assert.equal(back.version,3)
 await page.getByText('Version 3 · current',{exact:false}).waitFor();await screen(page,'apps-version-history')
 // Removing a reader or audience ends their home entry, saved link, subscription and preview.
 const bobBefore=await bob.person()
 await call(owner,'/apps/'+appId+'/members',{audience:'finance',operatorId:bobBefore.id,operatorVersion:bobBefore.version,enabled:false},200,'PUT')
 await call(bob.context,'/apps/'+appId,undefined,404);await call(bob.context,'/apps/'+appId+'/audiences/finance/pages/page-3',undefined,404);await call(bob.context,'/apps/'+appId+'/subscriptions/'+subscription.id+'/preview',{},404)
 assert.ok(!(await(await bob.context.request.get(origin+'/app')).text()).includes('Your apps'));assert.equal((await bob.context.request.get(origin+'/app/apps/'+appId+'/finance/page-3')).status(),404)
 assert.ok((await call(owner,'/apps/'+appId)).subscriptions.some(s=>s.id===subscription.id&&s.endedReason==='audience-removed'))
 // Membership deactivation ends access and reactivation never revives it.
 assert.equal((await owner.request.post(origin+'/auth/operator/status',{headers,data:{operatorId:(await carol.person()).id,status:'inactive'}})).status(),200)
 assert.equal((await carol.context.request.get(origin+'/api/operator/apps/home')).status(),401)
 assert.equal((await owner.request.post(origin+'/auth/operator/status',{headers,data:{operatorId:carolPerson.id,status:'active'}})).status(),200)
 await carol.context.request.get(new URL((await carol.person()).signInUrl,origin).href);assert.deepEqual((await call(carol.context,'/apps/home')).apps,[],'Reactivation never revives audience access')
 // Regrant a live Finance reader and subscription before removing the audience itself.
 await call(owner,'/apps/'+appId+'/members',{audience:'finance',operatorId:bobBefore.id,operatorVersion:bobBefore.version,enabled:true},200,'PUT')
 const renewedSubscription=await call(bob.context,'/apps/'+appId+'/subscriptions',{audience:'finance',pageKey:'page-3'})
 assert.equal((await nav(bob))[0].name,'Finance')
 // Removing the Finance audience in a new published version ends its readers; the imported original is erasable.
 const current=await call(owner,'/apps/'+appId),trimmed=structuredClone(current.draft.document);trimmed.audiences=trimmed.audiences.filter(a=>a.key!=='finance');trimmed.pages=trimmed.pages.filter(p=>trimmed.audiences.some(a=>a.pages.includes(p.key)))
 const trimmedDraft=await call(owner,'/apps/'+appId+'/draft',{previousRevision:current.draft.revision,document:trimmed}),trimmedReview=await call(owner,'/apps/'+appId+'/publication/review',{draftRevision:trimmedDraft.draftRevision},200)
 await call(owner,'/apps/'+appId+'/publication/publish',{draftRevision:trimmedDraft.draftRevision,reviewedDigest:trimmedReview.reviewDigest})
 await call(bob.context,'/apps/'+appId,undefined,404)
 await call(bob.context,'/apps/'+appId+'/subscriptions/'+renewedSubscription.id+'/preview',{},404)
 assert.ok((await call(owner,'/apps/'+appId)).subscriptions.some(row=>row.id===renewedSubscription.id&&row.endedReason==='removed-from-version'))
 const returnAudience=await call(owner,'/apps/'+appId+'/rollback/review',{version:3,previousPublished:4},200)
 await call(owner,'/apps/'+appId+'/rollback/apply',{version:3,previousPublished:4,reviewedDigest:returnAudience.reviewDigest})
 assert.deepEqual((await call(bob.context,'/apps/home')).apps,[],'Restoring an audience never restores its removed membership')
 const imported=await call(owner,'/app-imports/power-bi-app');assert.equal(imported.active,false);assert.equal(JSON.stringify(imported).includes('token'),false)
 await call(owner,'/app-imports/power-bi-app/erase',{confirmImport:'power-bi-app',reviewedRevision:imported.revision},200)
 await proveAppReader({origin,call,owner,alice,dave,bob,authored,expiresAt:native.expiresAt,screen})
 // Source changes invalidate discovery and every analytical door permanently, even after data restoration.
 const sourceCsv='invoice,region,date,revenue\n1,West,03/05/2026,$100.00\n2,West,03/06/2026,$50.00\n3,East,03/05/2026,$200.00\n4,North,03/07/2026,$25.00\n'
 const aliceSubscription=await call(alice.context,'/apps/'+appId+'/subscriptions',{audience:'sales',pageKey:'page-1'})
 await upload(dataset,sourceCsv.replace('$100.00','$101.00'),true)
 assert.deepEqual((await call(alice.context,'/apps/home')).apps,[])
 await call(alice.context,'/apps/'+appId+'/audiences/sales/pages/page-1',undefined,404)
 await call(alice.context,'/apps/'+appId+'/subscriptions/'+aliceSubscription.id+'/preview',{},404)
 await upload(dataset,sourceCsv,true)
 assert.deepEqual((await call(alice.context,'/apps/home')).apps,[],'Restoring the source never revives publication authority')
 await alice.page.goto(origin+'/app/apps/'+appId+'/sales/page-1');await alice.page.getByRole('heading',{name:'App unavailable'}).waitFor();await screen(alice.page,'apps-source-withdrawn')
 const fresh=await call(owner,'/apps/'+appId),freshReview=await call(owner,'/apps/'+appId+'/publication/review',{draftRevision:fresh.draft.revision},200)
 await call(owner,'/apps/'+appId+'/publication/publish',{draftRevision:fresh.draft.revision,reviewedDigest:freshReview.reviewDigest})
 assert.equal((await page_(alice,'sales','page-1')).cards.find(c=>c.label==='total').totals.revenue.value,'150.00')
 const expired=structuredClone(fresh.draft.document);expired.expiresAt=new Date(Date.now()-86400000).toISOString()
 const expiredDraft=await call(owner,'/apps/'+appId+'/draft',{previousRevision:fresh.draft.revision,document:expired}),expiredReview=await call(owner,'/apps/'+appId+'/publication/review',{draftRevision:expiredDraft.draftRevision},200)
 await call(owner,'/apps/'+appId+'/publication/publish',{draftRevision:expiredDraft.draftRevision,reviewedDigest:expiredReview.reviewDigest},409)
 assert.equal((await nav(alice))[0].name,'Sales','Refused expiry does not change the live publication')
 for(const member of Object.values(members))await member.context.close()
 console.log('Reporting apps: Power BI import, audience navigation and row scope, atomic versions, rollback, home placement and membership fences passed at 1440 and 390')
}
