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
   await page.getByLabel('Query definition (JSON)',{exact:true}).fill(JSON.stringify(query,null,2))
   await page.getByRole('button',{name:'Run exact query',exact:true}).click()
   await page.getByRole('status').filter({hasText:'Answer loaded'}).waitFor()
   assert.match(await page.locator('#totals').innerText(),/80\.07/)
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
