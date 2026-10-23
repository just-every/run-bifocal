import assert from 'node:assert/strict'

// Existing emitted-Worker journey supplies only resources created through HTTP.
export async function proveReportingApps(origin,context,page,{query,dashboard,report}) {
 const headers={Origin:origin},base='/api/operator/apps'
 const call=async(path='',data,method=data===undefined?'GET':'POST',expected=200)=>{
  const response=await context.request.fetch(origin+base+path,{method,headers,...(data===undefined?{}:{data})})
  assert.equal(response.status(),expected,await response.text());return response.json()
 }
 const item=(kind,id,label)=>({kind,id,label})
 const draft={title:'Sales review',items:[item('dashboards',dashboard.id,'Sales overview'),item('reports',report.id,'Finance detail'),item('queries',query.queryId,'Exact question')]}
 assert.equal((await fetch(origin+base)).status,401)
 assert.equal((await context.request.post(origin+base,{headers:{Origin:'https://foreign.example.test'},data:draft})).status(),401)
 await call('',{...draft,audiences:['Board']},'POST',400)
 await call('',{...draft,items:[...draft.items,draft.items[0]]},'POST',400)
 const created=await call('',draft,'POST',201),id=created.id
 let app=await call('/'+id)
 assert.deepEqual(app.draft,draft)
 await call('/'+id+'/published',undefined,'GET',404)
 await call('/'+id+'/publish',{generation:app.generation,reviewedDigest:'0'.repeat(64)},'POST',409)
 const review=await call('/'+id+'/review')
 assert.equal(review.access,'owner-only');assert.equal(review.schedules,'unavailable')
 await call('/'+id+'/publish',{generation:review.generation,reviewedDigest:review.digest})
 const first=await call('/'+id+'/published')
 assert.deepEqual(first.content,draft);assert.equal(first.ordinal,1)
 app=await call('/'+id)
 const revised={title:'Revised review',items:[draft.items[2],draft.items[0]]}
 await call('/'+id,{...revised,generation:app.generation},'PUT')
 assert.deepEqual((await call('/'+id+'/published')).content,draft,'draft edits must leave published content untouched')
 await call('/'+id,{...draft,generation:app.generation},'PUT',409)
 await call('/'+id+'/publish',{generation:review.generation,reviewedDigest:review.digest},'POST',409)
 let currentReview=await call('/'+id+'/review')
 // Browser review is explicit, labelled and stays bound to the saved draft.
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  await page.goto(origin+'/app/apps/'+id)
  await page.getByRole('status').filter({hasText:'Draft ready'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Publish reviewed version',exact:true}).isEnabled(),false)
  await page.getByRole('button',{name:'Review saved draft',exact:true}).click()
  await page.getByText('Exact review fingerprint:',{exact:false}).waitFor()
  assert.match(await page.locator('#review-content').innerText(),/Revised review/)
  assert.equal(await page.getByRole('button',{name:'Publish reviewed version',exact:true}).isEnabled(),false)
  assert.equal(await page.getByRole('checkbox').count(),1)
  await page.getByRole('checkbox').focus();await page.keyboard.press('Space')
  assert.equal(await page.getByRole('button',{name:'Publish reviewed version',exact:true}).isEnabled(),true)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`app editor overflow at ${width}`)
  // Every control has visible text; none is an icon-only action.
  assert.ok((await page.locator('button').allTextContents()).every(text=>text.trim().length>2))
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/apps-review-${width}.png`,fullPage:true})
  await page.goto(origin+'/app/apps/'+id+'/published')
  await page.getByRole('status').filter({hasText:'Published app loaded'}).waitFor()
  assert.equal(await page.locator('#reader h3').innerText(),'Sales review')
  assert.deepEqual(await page.locator('#reader a').allTextContents(),draft.items.map(i=>i.label))
  await page.getByRole('link',{name:'Finance detail',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor()
  await page.goto(origin+'/app')
  await page.getByRole('heading',{name:'Your published apps',exact:true}).waitFor()
  assert.equal(await page.getByRole('link',{name:'Sales review',exact:true}).getAttribute('href'),'/app/apps/'+id+'/published')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/apps-home-${width}.png`,fullPage:true})
 }
 // Publish through the browser's real review controls.
 await page.goto(origin+'/app/apps/'+id)
 await page.getByRole('status').filter({hasText:'Draft ready'}).waitFor()
 await page.getByRole('button',{name:'Review saved draft',exact:true}).click()
 await page.getByText('Exact review fingerprint:',{exact:false}).waitFor()
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Publish reviewed version',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Reviewed version published'}).waitFor()
 assert.deepEqual((await call('/'+id+'/published')).content,revised)
 app=await call('/'+id);assert.equal(app.versions.length,2)
 await call('/'+id+'/rollback',{generation:app.generation,versionId:first.versionId,reviewedDigest:'0'.repeat(64)},'POST',409)
 await call('/'+id+'/rollback',{generation:app.generation,versionId:first.versionId,reviewedDigest:first.digest})
 app=await call('/'+id)
 assert.deepEqual((await call('/'+id+'/published')).content,draft)
 assert.deepEqual(app.draft,revised)
 assert.deepEqual(app.history.map(event=>event.action),['draft','publish','draft','publish','rollback'])
 context.reportingApp={id,version:first.versionId}
 console.log('Reporting apps: native curated content, exact reviewed atomic publication, independent drafts, stale review refusal, home placement, rollback and 1440/390 passed')
}

export async function proveReportingAppWithdrawal(origin,context,page){
 const {id}=context.reportingApp,base='/api/operator/apps/'+id
 assert.equal((await context.request.get(origin+base+'/published')).status(),404)
 const app=await(await context.request.get(origin+base)).json()
 assert.equal(app.draft,null);assert.equal(app.publishedVersion,null);assert.equal(app.versions.length,0)
 assert.deepEqual(app.history.map(event=>event.action),['draft','publish','draft','publish','rollback'])
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  await page.goto(origin+'/app/apps/'+id+'/published')
  await page.getByRole('status').filter({hasText:'app_not_published'}).waitFor()
  assert.equal(await page.locator('#reader a').count(),0)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/apps-withdrawn-${width}.png`,fullPage:true})
 }
 console.log('Reporting app custody: source erasure withdrew every dependent draft and version while preserving redacted publication history')
}
