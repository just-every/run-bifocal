import assert from 'node:assert/strict'

/** The receiving app door carries region and fiscal context without borrowing
 * the owner's authoring transport, source-record authority or personal states. */
export async function proveAppReader({origin,call,owner,alice,dave,bob,authored,expiresAt,screen}) {
 const save=async document=>{const review=await call(owner,'/dashboard-authoring/review',{document},200),draft=await call(owner,'/dashboard-authoring/apply',{document,reviewedDigest:review.digest}),publication=await call(owner,'/dashboard-authoring/'+draft.id+'/publication/review',{revision:1,previousGeneration:0,action:'publish'},200);await call(owner,'/dashboard-authoring/'+draft.id+'/publish',{revision:1,previousGeneration:0,reviewedDigest:publication.digest},200);return draft}
 const document=title=>{const doc=authored(title);for(const card of doc.cards)card.definition.fiscal={column:'date',asOf:'2026-03-07',window:'year-to-date'};doc.interactions.fiscalParameters=[{id:'period',label:'Fiscal period',cards:doc.cards.map(card=>card.key),default:{asOf:'2026-03-07',window:'year-to-date'}}];return doc}
 const target=await save(document('Private authored destination')),sourceDocument=document('Private authored source')
 sourceDocument.interactions.actions=[{id:'drill',label:'Open regional detail',card:'by-region',kind:'dashboard',target:target.id,bindings:[{source:'region',target:'region'}],fiscalBindings:[{source:'period',target:'period'}]},{id:'tooltip',label:'Show regional tooltip',card:'by-region',kind:'tooltip',target:target.id,bindings:[{source:'region',target:'region'}],fiscalBindings:[{source:'period',target:'period'}]}]
 const source=await save(sourceDocument),app=await call(owner,'/apps',{document:{version:1,title:'Audience operating review',expiresAt,pages:[{key:'review',title:'Operating review',kind:'dashboard',ref:source.id},{key:'detail',title:'Regional detail',kind:'dashboard',ref:target.id}],audiences:[{key:'sales',name:'Sales',landing:'review',pages:['review','detail'],rows:[{column:'region',op:'eq',value:'West'}],columns:null}]}}),review=await call(owner,'/apps/'+app.id+'/publication/review',{draftRevision:1},200)
 await call(owner,'/apps/'+app.id+'/publication/publish',{draftRevision:1,reviewedDigest:review.reviewDigest})
 for(const person of [alice,dave]){const member=await person.person();await call(owner,'/apps/'+app.id+'/members',{audience:'sales',operatorId:member.id,operatorVersion:member.version,enabled:true},200,'PUT')}
 const endpoint='/apps/'+app.id+'/audiences/sales/pages/review/dashboard',selection={filters:[{column:'region',op:'eq',value:'West'}],fiscal:{period:{asOf:'2026-03-07',window:'quarter-to-date'}}}
 const tooltip=await call(alice.context,endpoint+'/action',{selection,actionId:'tooltip'},200)
 assert.equal(tooltip.cards.find(card=>card.key==='total').answer.totals.revenue.value,'150.00');assert.equal(tooltip.title,'Regional detail');assert.equal(JSON.stringify(tooltip).includes('Private authored'),false)
 const drill=await call(alice.context,endpoint+'/action',{selection,actionId:'drill'}),targetEndpoint='/apps/'+app.id+'/audiences/sales/pages/detail/dashboard'
 const inherited=await call(alice.context,targetEndpoint+'/run',{selection:{},contextId:drill.contextId},200)
 assert.equal(inherited.cards.find(card=>card.key==='total').answer.totals.revenue.value,'150.00');assert.equal(inherited.inherited.fiscal.period.window,'quarter-to-date')
 const narrowed=await call(alice.context,targetEndpoint+'/run',{selection:{filters:[{column:'region',op:'eq',value:'East'}]},contextId:drill.contextId},200)
 assert.equal(narrowed.cards.find(card=>card.key==='total').status,'empty')
 await call(dave.context,targetEndpoint+'/run',{selection:{},contextId:drill.contextId},404)
 await call(bob.context,endpoint+'/action',{selection,actionId:'tooltip'},404)
 await alice.page.goto(origin+drill.location);await alice.page.getByRole('table',{name:'Exact by-region results',exact:true}).waitFor();assert.match(await alice.page.locator('#dashboard-reader-context').innerText(),/Inherited region = West/);await screen(alice.page,'apps-scoped-drillthrough')
 await alice.page.goto(origin+'/app/apps/'+app.id+'/sales/review');await alice.page.getByRole('table',{name:'Exact by-region results',exact:true}).waitFor();await alice.page.getByText('Filters and parameters',{exact:true}).click();await alice.page.getByLabel('Filter value',{exact:true}).fill('West');await alice.page.getByRole('button',{name:'Apply filter',exact:true}).click();await alice.page.waitForFunction(()=>document.querySelector('#dashboard-reader-context')?.textContent.includes('West'))
 await alice.page.getByRole('button',{name:'Show regional tooltip',exact:true}).click();await alice.page.getByRole('dialog').getByRole('table',{name:'Tooltip by-region',exact:true}).waitFor();await screen(alice.page,'apps-allowed-tooltip');await alice.page.getByRole('button',{name:'Close tooltip',exact:true}).click()
}
