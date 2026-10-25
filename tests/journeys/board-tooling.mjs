import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {proveRetainedExports} from './retained-export.mjs'
import {proveDashboardAuthoring} from './dashboard-authoring.mjs'

/** Ordered multi-answer definitions use the actual retained board surfaces. */
export async function proveBoardTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf}){
 const dataset='synthetic-bifocal-board-tools',csv='invoice,region,revenue\n1,West,$10.01\n2,East,$20.02\n3,West,-$0.03\n'
 await upload(dataset,csv)
 const base=JSON.parse(await readFile(join(directory,'metric-export.native.json'),'utf8')).definition.query
 const all={...base,dataset,groupBy:[],filters:[]},west={...all,filters:[{column:'region',op:'eq',value:'West'}]}
 const retainedIds=[]
 for(const kind of ['dashboard','report']){
  const document={version:1,title:'Regional '+kind+' from git',cards:[all,west]},file=join(directory,kind+'-board.native.json'),plan=join(directory,kind+'-board.plan.json'),exported=join(directory,kind+'-board-export.native.json')
  await writeFile(file,JSON.stringify(document))
  const review=await cli(kind+'-import',['--file',file,'--plan-file',plan]);assert.deepEqual(review.answers.map(answer=>answer.totals.revenue.value),['30.00','9.98'])
  const created=await cli(kind+'-import',['--file',file,'--approve',review.digest]);assert.equal(created.cards.length,2)
  retainedIds.push(...created.cards.map(card=>card.queryId))
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
