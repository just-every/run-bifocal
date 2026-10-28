import assert from 'node:assert/strict'
export async function proveExactBrowser(origin, page, query, phase, artifact) {
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000})
  const shot=async state=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`answer ${state} overflow ${width}`)
   if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/answers-${state}-${width}.png`,fullPage:true})
  }
  if(phase==='create') {
   await page.goto(origin+'/app/queries')
   await page.getByText('New exact answer',{exact:true}).click()
   await page.getByLabel('Query definition (JSON)',{exact:true}).fill(JSON.stringify(query,null,2))
   const runResponse=page.waitForResponse(response=>response.url()===origin+'/api/operator/queries/run'&&response.request().method()==='POST')
   await page.getByRole('button',{name:'Run exact query',exact:true}).click()
   const answer=await(await runResponse).json();assert.equal(answer.cache.status,'hit')
   await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor()
   assert.match(await page.locator('#totals').innerText(),/80\.07/)
   const cacheNote=page.locator('#cache-note');assert.equal(await cacheNote.isVisible(),true)
   assert.match(await cacheNote.innerText(),/hit/i);assert.match(await cacheNote.innerText(),/age/i)
   assert.ok(Number.isSafeInteger(answer.cache.ageMs)&&answer.cache.ageMs>=0)
   assert.ok(Number.isFinite(Date.parse(answer.cache.createdAt)))
   assert.deepEqual(JSON.parse(await page.locator('#context').textContent()).sources,answer.answer.sourceWatermarks)
   await page.getByText('Definition',{exact:true}).click()
   for(const source of answer.answer.sourceWatermarks){
    assert.ok((await page.locator('#snapshot-note').innerText()).includes(source.dataset))
    assert.ok((await page.locator('#definition-facts').innerText()).includes(String(source.revision).slice(0,12)))
   }
   await shot('query')
   await page.getByLabel('Saved result title',{exact:true}).fill('West margin, reviewed snapshot')
   for(const kind of ['dashboard','report']) {
    await page.getByRole('button',{name:'Save '+kind,exact:true}).click()
    await page.getByRole('status').filter({hasText:`Saved ${kind}`}).waitFor()
    const link=page.getByRole('link',{name:'Open saved '+kind,exact:true})
    const href=await link.getAttribute('href');assert.match(href,new RegExp('/app/'+kind+'s/'))
    // Open the saved result as a real read-only document, then return to the
    // authored answer without rerunning against live inputs.
    const savedPage=await page.context().newPage()
    try { await savedPage.setViewportSize({width,height:1000});await savedPage.goto(origin+href);await savedPage.getByRole('status').filter({hasText:'Answer loaded'}).waitFor();assert.match(await savedPage.locator('#totals').innerText(),/80\.07/);if(process.env.BIFOCAL_PROOF_DIR)await savedPage.screenshot({path:`${process.env.BIFOCAL_PROOF_DIR}/answers-${kind}-${width}.png`,fullPage:true}) }finally{await savedPage.close()}
   }
   await page.getByRole('button',{name:'Reproduce snapshot',exact:true}).click()
   await page.getByRole('status').filter({hasText:'Snapshot reproduced exactly'}).waitFor()
   assert.match(await cacheNote.innerText(),/hit/i)
   assert.deepEqual(JSON.parse(await page.locator('#context').textContent()).sources,answer.answer.sourceWatermarks)
  } else {
   const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/operator/reports/'+artifact))
   await page.goto(origin+'/app/reports/'+artifact)
   assert.equal((await responsePromise).status(),phase==='erased'?404:200)
   if(phase==='erased'){await page.getByRole('alert').waitFor();assert.equal(await page.locator('#answer').isHidden(),true)}else await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor()
   if(phase==='changed')assert.match(await page.locator('#totals').innerText(),/80\.07/)
   await shot(phase==='changed'?'historical-report':'erased-report')
  }
 }
}
