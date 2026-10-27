import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {proveRetainedExports} from './retained-export.mjs'
import {proveDashboardAuthoring} from './dashboard-authoring.mjs'

/** Ordered multi-answer definitions use the actual retained board surfaces. */
export async function proveBoardTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf}){
 const dataset='synthetic-bifocal-board-tools',csv='invoice,region,revenue\n1,West,$10.01\n2,East,$20.02\n3,West,-$0.03\n'
 await upload(dataset,csv)
 const rules=[['synthetic-bifocal-board-identity',{name:'Board invoice identity',kind:'unique',column:'invoice'}],['synthetic-bifocal-board-freshness',{name:'Board source freshness',kind:'freshness',maxAgeSeconds:3600}]]
 for(const [id,definition] of rules)await call('/quality/rules',{id,dataset,definition})
 const runQuality=async()=>{for(const [id] of rules)assert.equal((await call('/quality/rules/'+id+'/run',{})).result.state,'passed')}
 const base=JSON.parse(await readFile(join(directory,'metric-export.native.json'),'utf8')).definition.query
 const all={...base,dataset,groupBy:[],filters:[]},west={...all,filters:[{column:'region',op:'eq',value:'West'}]}
 const retainedIds=[]
 for(const kind of ['dashboard','report']){
  await runQuality()
  const document={version:1,title:'Regional '+kind+' from git',cards:[all,west]},file=join(directory,kind+'-board.native.json'),plan=join(directory,kind+'-board.plan.json'),exported=join(directory,kind+'-board-export.native.json')
  await writeFile(file,JSON.stringify(document))
  let review=await cli(kind+'-import',['--file',file,'--plan-file',plan]);assert.deepEqual(review.answers.map(answer=>answer.totals.revenue.value),['30.00','9.98'])
  const created=await cli(kind+'-import',['--file',file,'--approve',review.digest]);assert.equal(created.cards.length,2)
  retainedIds.push(...created.cards.map(card=>card.queryId))
  await proveBoardQuality({origin,context,page,call,upload,proveScreen,dataset,csv,all,kind,created,rules,runQuality})
  review=await cli(kind+'-import',['--file',file,'--plan-file',join(directory,kind+'-board-quality-repaired.plan.json')])
  await proveRetainedExports({origin,context,snapshotId:created.cards[0].queryId,summary:[['30.00']],underlying:[['1','West','10.01'],['2','East','20.02'],['3','West','-0.03']]})
  await proveRetainedExports({origin,context,snapshotId:created.cards[1].queryId,summary:[['9.98']],underlying:[['1','West','10.01'],['3','West','-0.03']]})
  await cli(kind+'-export',['--id',created.id,'--output',exported]);assert.deepEqual(JSON.parse(await readFile(exported,'utf8')),document)
  await page.goto(origin+'/app/'+kind+'s/'+created.id);await page.getByRole('heading',{name:document.title,exact:true}).waitFor();assert.match(await page.locator('#board-cards').innerText(),/30\.00/);assert.match(await page.locator('#board-cards').innerText(),/9\.98/);await proveScreen('native-multi-answer-'+kind)
  for(const scope of ['summary','underlying'])for(const format of ['CSV','XLSX'])assert.equal(await page.getByRole('button',{name:'Export '+scope+' '+format,exact:true}).count(),2)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const download=page.waitForEvent('download');await page.getByRole('button',{name:width===1440?'Export underlying CSV':'Export underlying XLSX',exact:true}).last().click();assert.match((await download).suggestedFilename(),/retained-underlying\.(csv|xlsx)$/);await page.getByRole('status').filter({hasText:'Export complete: 2'}).waitFor();await proveScreen('native-'+kind+'-retained-export')}
  const config=(digest)=>({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{['bifocal_'+kind+'_snapshot']:{main:{document:JSON.stringify(document),...(digest?{review_digest:digest}:{})}}}})
  const terraform=(args,ok=true)=>tfRun([args[0],'-state='+kind+'-board.tfstate',...args.slice(1)],ok)
  await writeFile(tf,JSON.stringify(config()));await terraform(['import','-input=false','-no-color','bifocal_'+kind+'_snapshot.main',created.id]);await terraform(['plan','-input=false','-no-color','-detailed-exitcode'])
  let state=JSON.parse(await readFile(join(directory,kind+'-board.tfstate'),'utf8'));assert.deepEqual(state.resources[0].instances[0].attributes.query_ids,created.cards.map(c=>c.queryId));assert.equal(state.resources[0].instances[0].attributes.query_id,'')
  await terraform(['destroy','-auto-approve','-input=false','-no-color']);assert.equal((await call('/'+kind+'s/'+created.id)).id,created.id)
  await writeFile(tf,JSON.stringify(config(review.digest)));await terraform(['plan','-input=false','-no-color','-out='+kind+'-board-stale.tfplan'])
  await upload(dataset,csv.replace('$10.01','$11.01'),true)
  const before=await call('/queries');await terraform(['apply','-input=false','-no-color',kind+'-board-stale.tfplan'],false);assert.deepEqual(await call('/queries'),before,'A stale multi-answer plan commits none of its answers')
  const current=await cli(kind+'-import',['--file',file,'--plan-file',join(directory,kind+'-board-current.plan.json')]);await writeFile(tf,JSON.stringify(config(current.digest)));await terraform(['plan','-input=false','-no-color','-out='+kind+'-board-current.tfplan']);await terraform(['apply','-input=false','-no-color',kind+'-board-current.tfplan'])
  state=JSON.parse(await readFile(join(directory,kind+'-board.tfstate'),'utf8'));const native=await call('/'+kind+'s/'+state.resources[0].instances[0].attributes.id);assert.deepEqual(native.cards.map(c=>c.answer.totals.revenue.value),['31.00','10.98'])
  assert.deepEqual((await call('/'+kind+'s/'+created.id)).cards.map(c=>c.answer.totals.revenue.value),['30.00','9.98'])
  await proveRetainedExports({origin,context,snapshotId:created.cards[0].queryId,summary:[['30.00']],underlying:[['1','West','10.01'],['2','East','20.02'],['3','West','-0.03']]})
  const portable=await readFile(exported,'utf8'),stateText=await readFile(join(directory,kind+'-board.tfstate'),'utf8')
  for(const text of [portable,stateText]){for(const cookie of await context.cookies())if(cookie.value)assert.ok(!text.includes(cookie.value));assert.ok(!text.includes('securityScope'));assert.ok(!text.includes('value_json'));assert.ok(!text.includes('answer_json'))}
  await terraform(['destroy','-auto-approve','-input=false','-no-color'])
  await upload(dataset,csv,true)
 }
 await proveDashboardAuthoring({origin,context,page,upload,proveScreen,cli,tfRun,directory,tf})
 const source=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision})
 for(const id of retainedIds)assert.equal((await context.request.post(origin+'/api/operator/queries/'+id+'/export',{headers:{Origin:origin},data:{scope:'summary',format:'csv'}})).status(),404)
 console.log('Multi-answer native boards: real CLI and Terraform ordered definitions, atomic source drift refusal, exact values and retained history passed')
}

/** Every actual board position retains its independently checked answer. */
async function proveBoardQuality({origin,context,page,call,upload,proveScreen,dataset,csv,all,kind,created,rules,runQuality}) {
 const baseline=await call('/'+kind+'s/'+created.id)
 assert.equal(baseline.cards.length,2)
 assert.deepEqual(baseline.cards.map(card=>card.quality.state),['healthy','healthy'])
 assert.deepEqual(baseline.cards.map(card=>card.quality.lastGood.answer.totals.revenue.value),['30.00','9.98'])
 for(const card of baseline.cards){assert.equal(card.quality.lastGood.queryId,card.queryId);assert.equal(card.quality.lastGood.createdAt,card.createdAt);assert.ok(Number.isFinite(Date.parse(card.quality.lastGood.checkedAt)))}
 const unrelated=await call('/queries/run',{...all,semantic:undefined,measures:[{id:'rows',op:'count',unit:'count',scale:0}]})
 const impact=await call('/quality/impact/'+dataset+'?column=revenue')
 assert.deepEqual(impact.cards.filter(card=>card.id===created.id).sort((a,b)=>a.position-b.position).map(card=>({position:card.position,snapshot:card.snapshot_id})),created.cards.map((card,position)=>({position,snapshot:card.queryId})))
 assert.ok(!impact.queries.includes(unrelated.queryId),'Dropping revenue does not affect a query that only counts rows')
 const lookup='synthetic-bifocal-board-lookup-'+kind
 await upload(lookup,'invoice,region\n1,Pacific\n2,Atlantic\n3,Pacific\n')
 const joined=await call('/queries/run',{...all,semantic:undefined,joins:[{dataset:lookup,as:'labels',left:'base.invoice',right:'invoice',duplicates:'reject'}],filters:[{column:'labels.region',op:'eq',value:'Pacific'}]})
 const rightImpact=await call('/quality/impact/'+lookup+'?column=region')
 assert.deepEqual(rightImpact.queries,[joined.queryId]);assert.deepEqual(rightImpact.answers[0].columns,[{dataset,columns:['invoice','revenue']},{dataset:lookup,columns:['invoice','region']}].sort((a,b)=>a.dataset.localeCompare(b.dataset)))
 const leftImpact=await call('/quality/impact/'+dataset+'?column=region')
 assert.ok(!leftImpact.queries.includes(joined.queryId),'A joined region must not be attributed to the base region column')
 const lookSource=await call('/datasets/'+lookup);await call('/datasets/'+lookup+'/erase',{confirmDataset:lookup,reviewedRevision:lookSource.revision})
 const failedCsv=csv.replace('2,East','1,East')
 await upload(dataset,failedCsv,true,{lineage:{kind:'revenue-table',link:'https://warehouse.example.com/source',description:'Reviewed stale board source',from:'2026-01-01',to:'2027-01-01',timezone:'America/New_York',observedAt:'2000-01-01T00:00:00.000Z',schema:'invoice,region,revenue'}})
 const unknown=await call('/'+kind+'s/'+created.id)
 assert.deepEqual(unknown.cards.map(card=>card.quality.state),['unknown','unknown'])
 assert.deepEqual(unknown.cards.map(card=>card.answer),baseline.cards.map(card=>card.answer))
 await page.goto(origin+'/app/'+kind+'s/'+created.id);await page.getByRole('heading',{name:created.title,exact:true}).waitFor();assert.equal(await page.locator('#board-cards .quality-notice').filter({hasText:'Quality unknown'}).count(),2);await proveScreen('quality-multi-'+kind+'-unknown')
 const runs=[]
 for(const [id] of rules)runs.push(await call('/quality/rules/'+id+'/run',{}))
 assert.deepEqual(runs.map(run=>run.result.state),['failed','failed']);assert.deepEqual(runs[0].result.failingRowNumbers,[2])
 const failed=await call('/'+kind+'s/'+created.id)
 assert.deepEqual(failed.cards.map(card=>card.quality.state),['at risk','at risk'])
 for(const card of failed.cards){assert.deepEqual(card.quality.tests.map(test=>({rule:test.ruleId,run:test.runId,state:test.state})),rules.map(([id],i)=>({rule:id,run:runs[i].id,state:'failed'})).sort((a,b)=>a.rule.localeCompare(b.rule)));assert.deepEqual(card.quality.lastGood,baseline.cards.find(original=>original.queryId===card.queryId).quality.lastGood);assert.deepEqual(card.quality.lineage,[{dataset,columns:['invoice','region','revenue']}])}
 await page.reload();await page.getByRole('heading',{name:created.title,exact:true}).waitFor()
 assert.equal(await page.locator('#board-cards .quality-notice').filter({hasText:'Quality at risk'}).count(),2)
 assert.equal(await page.getByRole('link',{name:'Board invoice identity · failed',exact:true}).count(),2)
 assert.equal(await page.getByRole('link',{name:'Retained last-good result',exact:true}).count(),2)
 await proveScreen('quality-multi-'+kind+'-failed')
 await page.getByRole('link',{name:'Board invoice identity · failed',exact:true}).first().click();await page.locator('#run-'+runs[0].id).waitFor();assert.match(await page.locator('#run-'+runs[0].id).innerText(),/Board invoice identity/)
 const outsider=await page.context().browser().newContext();try{const denied=await outsider.request.get(origin+'/api/operator/'+kind+'s/'+created.id);assert.equal(denied.status(),401);assert.ok(!(await denied.text()).includes('failingRowNumbers'))}finally{await outsider.close()}
 await upload(dataset,csv,true);await runQuality()
 const repaired=await call('/'+kind+'s/'+created.id)
 assert.deepEqual(repaired.cards.map(card=>card.quality.state),['healthy','healthy']);assert.deepEqual(repaired.cards.map(card=>card.answer),baseline.cards.map(card=>card.answer));assert.deepEqual(repaired.cards.map(card=>card.quality.lastGood),baseline.cards.map(card=>card.quality.lastGood))
 await page.goto(origin+'/app/'+kind+'s/'+created.id);await page.getByRole('heading',{name:created.title,exact:true}).waitFor();assert.equal(await page.locator('#board-cards .quality-notice').filter({hasText:'Quality healthy'}).count(),2);await proveScreen('quality-multi-'+kind+'-repaired')
}
