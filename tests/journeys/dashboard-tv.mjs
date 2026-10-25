import assert from 'node:assert/strict'

/** A live owner TV view refreshes real sources without rewriting retained cards. */
export async function proveDashboardTv({origin,context,page,call,upload,proveScreen}) {
 const fresh='synthetic-bifocal-tv-fresh',old='synthetic-bifocal-tv-old'
 const csv=value=>'invoice,region,revenue\n1,West,$'+value+'\n'
 const lineage={kind:'revenue-table',link:'https://example.com/revenue',description:'Explicit historical ledger extract',from:'2000-01-01',to:'2000-02-01',timezone:'UTC',observedAt:'2000-02-01T00:00:00.000Z',schema:'Invoice revenue'}
 await upload(fresh,csv('10.01'));await upload(old,csv('20.02'),false,{lineage})
 const query=dataset=>({version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'money',scale:2,sourceCurrency:'USD'}],context:{modelVersion:'synthetic-bifocal-tv-model',metricVersion:'synthetic-bifocal-tv-metric',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-july',version:1},rounding:'half-even'}})
 const empty={...query(fresh),filters:[{column:'region',op:'eq',value:'North'}]}
 const retained=[]
 for(const definition of [query(fresh),query(old),empty])retained.push(await call('/queries/run',definition))
 const dashboard=await call('/dashboards',{queryIds:retained.map(item=>item.queryId),title:'Regional operations TV'})
 const endpoint='/dashboards/'+dashboard.id+'/refresh'
 const refresh=()=>call(endpoint,{maxAgeSeconds:3600},200)
 let result=await refresh();assert.deepEqual(result.cards.map(card=>card.status),['fresh','stale','empty']);assert.equal(result.cards[1].observedAt,lineage.observedAt)
 assert.equal(result.cards[0].answer.totals.revenue.value,'10.01');assert.equal(result.cards[2].answer.filteredRows,0)
 const single=await call('/dashboards',{queryId:retained[0].queryId,title:'One exact owner tile'});assert.equal((await call('/dashboards/'+single.id+'/refresh',{maxAgeSeconds:3600},200)).cards.length,1)
 assert.equal((await fetch(origin+'/api/operator'+endpoint,{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({maxAgeSeconds:3600})})).status,401)
 await call(endpoint,{maxAgeSeconds:3600},401,{Origin:'https://synthetic-bifocal.invalid'})
 const initialQueries=await call('/queries')
 await page.goto(origin+'/app/dashboards/'+dashboard.id)
 await page.getByRole('link',{name:'Open dashboard TV',exact:true}).click()
 await page.getByRole('heading',{name:'Regional operations TV',exact:true}).waitFor()
 await page.getByLabel('Maximum source age (seconds)',{exact:true}).fill('3600')
 const loading=await page.getByRole('button',{name:'Refresh now',exact:true}).evaluate(button=>{button.click();return [...document.querySelectorAll('section[data-tile-id]')].map(tile=>tile.dataset.state)})
 assert.deepEqual(loading,['loading','loading','loading'])
 await page.locator('[data-tile-id="'+retained[0].queryId+'"][data-state="fresh"]').waitFor()
 await page.locator('[data-tile-id="'+retained[1].queryId+'"][data-state="stale"]').waitFor()
 await page.locator('[data-tile-id="'+retained[2].queryId+'"][data-state="empty"]').waitFor()
 await proveScreen('dashboard-tv-fresh-stale-empty')
 await upload(fresh,csv('11.01'),true)
 await upload(old,'invoice,region,revenue\n1,West,unavailable\n',true,{columns:{invoice:'number',region:'text',revenue:'text'},lineage})
 result=await refresh();assert.deepEqual(result.cards.map(card=>card.status),['fresh','failed','empty']);assert.equal(result.cards[0].answer.totals.revenue.value,'11.01');assert.equal(result.cards[1].answer,undefined);assert.equal(result.cards[1].withdraw,false)
 await page.getByRole('button',{name:'Refresh now',exact:true}).click()
 const failed=page.locator('[data-tile-id="'+retained[1].queryId+'"][data-state="failed"]')
 await failed.waitFor();assert.match(await failed.innerText(),/20\.02/);assert.match(await failed.innerText(),/Last successful|Last good/i)
 assert.match(await page.locator('[data-tile-id="'+retained[0].queryId+'"]').innerText(),/11\.01/)
 await proveScreen('dashboard-tv-partial-failure')
 await upload(old,csv('22.02'),true,{columns:{invoice:'number',region:'text',revenue:'money'},lineage})
 await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.locator('[data-tile-id="'+retained[1].queryId+'"][data-state="stale"]').waitFor();assert.match(await page.locator('[data-tile-id="'+retained[1].queryId+'"]').innerText(),/22\.02/)
 await proveScreen('dashboard-tv-recovered')
 // Browser time controls only the explicit timer; server observation dates stay real.
 await page.clock.install();await page.getByLabel('Refresh interval (seconds)',{exact:true}).fill('5')
 await Promise.all([page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.status()===200),page.getByRole('button',{name:'Start',exact:true}).click()])
 await upload(fresh,csv('12.01'),true)
 const scheduled=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.status()===200)
 await page.clock.runFor(5000);await scheduled
 await page.waitForFunction(()=>document.querySelector('[data-state="fresh"]')?.textContent.includes('12.01'))
 await page.getByRole('button',{name:'Pause',exact:true}).click();await proveScreen('dashboard-tv-auto-refresh-paused')
 await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true)
 await proveScreen('dashboard-tv-fullscreen');await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click()
 assert.deepEqual(await call('/queries'),initialQueries,'Refresh never saves answers or changes board membership')
 assert.equal((await call('/dashboards/'+dashboard.id)).cards[0].answer.totals.revenue.value,'10.01','Retained dashboard remains immutable')
 const cookies=await context.cookies();await context.clearCookies();await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#tv-cards')?.textContent.includes('12.01'));assert.equal(await page.locator('[data-tile-id]').count(),0);await proveScreen('dashboard-tv-authority-withdrawn');await context.addCookies(cookies)
 await page.goto(origin+'/app/dashboards/'+dashboard.id+'/tv');await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.locator('[data-state="fresh"]').waitFor()
 const source=await call('/datasets/'+fresh);await call('/datasets/'+fresh+'/erase',{confirmDataset:fresh,reviewedRevision:source.revision},200)
 await call(endpoint,{maxAgeSeconds:3600},404)
 await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-tile-id]').length===0);await proveScreen('dashboard-tv-source-withdrawn')
 const staleSource=await call('/datasets/'+old);await call('/datasets/'+old+'/erase',{confirmDataset:old,reviewedRevision:staleSource.revision},200)
 console.log('Dashboard TV: explicit timer, real freshness, independent failure and recovery, immutable history, fullscreen and current authority withdrawal passed')
}
