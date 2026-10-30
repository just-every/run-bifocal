import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let worker, browser, context, origin, persist, query, snapshot, chartUrl, page
const dataset='synthetic-bifocal-charts', headers=()=>({Origin:origin})
const data='id,region,amount,quality\n1,West,100.10,value\n2,East,-20.02,value\n3,South,,value\n4,North,0.00,value\n5,Unknown,,unknown\n6,Restricted,10.00,suppressed\n7,Pending,5.00,incomplete\n8,<script>synthetic-bifocal-7</script>,2.00,value\n'
async function call(path, body, expected=200, method=body===undefined?'GET':'POST') {
 const response=await context.request.fetch(origin+'/api/operator'+path,{method,headers:headers(),...(body===undefined?{}:{data:body})})
 assert.equal(response.status(),expected,await response.text());return response.json()
}
async function importData(csv, catchup=false) {
 const input={version:1,datasetId:dataset,filename:'synthetic-bifocal-11.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:'id',formulaTreatment:'literal-text',columns:{id:'number',region:'text',amount:'money',quality:'text'},data:csv}
 const bytes=Buffer.from(JSON.stringify(input)), hash=createHash('sha256').update(bytes).digest('hex')
 const post=(action,body)=>context.request.post(origin+'/api/operator/import/'+action,{headers:{...headers(),'X-Import-Dataset':dataset},data:body})
 const upload=await post('uploads',{name:'synthetic-bifocal-11.json',bundleSha256:hash,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash,base64:bytes.toString('base64')})
 assert.equal(upload.status(),200,await upload.text())
 const planned=await post('plan',{uploadId:(await upload.json()).uploadId,...(catchup?{catchup:true}:{})})
 assert.equal(planned.status(),200,await planned.text())
 const plan=await planned.json()
 for(let i=0;i<20;i++) {
  const response=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})
  assert.equal(response.status(),200,await response.text())
  if((await response.json()).job.state==='completed')return
 }
 assert.fail('Import did not complete')
}
before(async()=>{
 const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
 origin=`http://127.0.0.1:${port}`;persist=await mkdtemp(join(tmpdir(),'bifocal-charts-'))
<<<<<<< HEAD
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json'],{stdio:'pipe',maxBuffer:16*1024*1024,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
=======
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json'],{stdio:['ignore','inherit','inherit'],env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
>>>>>>> 555f02d (Stream migration progress in native verification journeys)
 const setup='synthetic-bifocal-12'.repeat(3),installation=createHash('sha256').update('synthetic-bifocal-13').digest('hex')
 worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--inspector-port','0','--local','--persist-to',persist,'--ip','127.0.0.1','--config','dist/server/wrangler.json','--port',String(port),'--var',`AUTH_ORIGIN:${origin}`,'--var','AUTH_LOCAL:true','--var','OWNER_EMAIL:synthetic-bifocal-11@example.test','--var','MAIL_FROM:synthetic-bifocal-12@example.test','--var',`SESSION_SECRET:${'synthetic-bifocal-14'.repeat(3)}`,'--var',`SETUP_TOKEN:${setup}`,'--var',`INSTALLATION_KEY:${installation}`],{stdio:['ignore','pipe','pipe']})
 let output='';worker.stdout.on('data',chunk=>output+=chunk);worker.stderr.on('data',chunk=>output+=chunk)
 let ready=false
 for(let i=0;i<120;i++){if(worker.exitCode!==null)throw Error(output);try{ready=(await fetch(origin+'/health')).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,250))}
 assert.ok(ready,output)
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--use-mock-keychain','--password-store=basic','--no-sandbox']});context=await browser.newContext();page=await context.newPage()
 const bootstrap=await context.request.post(origin+'/auth/bootstrap',{headers:headers(),data:{token:setup,displayName:'Synthetic chart owner',returnTo:'/app'},maxRedirects:0});assert.equal(bootstrap.status(),303)
 await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])
 await call('/calendars',{id:'synthetic-bifocal-chart-year',previousVersion:null,definition:{name:'Calendar year',kind:'fiscal',startMonth:1}},201)
 await importData(data)
 query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'amount',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD',stateColumn:'quality'}],context:{modelVersion:'synthetic-bifocal-15',metricVersion:'synthetic-bifocal-16',accountingBasis:'accrual',calendar:{id:'synthetic-bifocal-chart-year',version:1},rounding:'half-even'}}
 snapshot=await call('/queries/run',query,201);chartUrl='/api/operator/charts/'+snapshot.queryId
 if(process.env.BIFOCAL_PROOF_DIR)await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true})
}, {timeout:120000})
after(async()=>{if(browser)await browser.close();if(worker){worker.kill('SIGTERM');await new Promise(resolve=>worker.exitCode!==null?resolve():worker.once('exit',resolve))}if(persist)await rm(persist,{recursive:true,force:true})})

test('native chart families retain exact scoped values, missing states and accessible labelled graphics',{timeout:120000},async()=>{
 const catalog=await call('/charts')
 const counts=await call('/queries/run',{...query,measures:[{id:'records',op:'count',unit:'count',scale:0}]},201)
 for(const type of catalog.types)for(const width of [1440]) {
  const partToWhole=['pie','donut'].includes(type),expectedSnapshot=partToWhole?counts:snapshot,baseUrl=partToWhole?'/api/operator/charts/'+counts.queryId:chartUrl
  const path=baseUrl+'/'+type+'.svg?width='+width, response=await context.request.get(origin+path)
  assert.equal(response.status(),200,await response.text());assert.equal(response.headers()['cache-control'],'no-store');assert.match(response.headers()['content-security-policy'],/sandbox/)
  await page.setViewportSize({width,height:1000});await page.goto(origin+path)
  assert.equal(await page.locator('parsererror').count(),0)
  assert.equal(await page.locator('script').count(),0)
  assert.equal(await page.locator('svg').getAttribute('aria-labelledby'),'chart-title chart-description')
  const metadata=JSON.parse(await page.locator('metadata').textContent())
  assert.equal(metadata.digest,expectedSnapshot.digest);assert.deepEqual(metadata.filters,[]);assert.deepEqual(metadata.sources,expectedSnapshot.answer.sourceWatermarks)
  assert.deepEqual(metadata.rows.map(row=>row.value),expectedSnapshot.answer.rows.map(row=>row.values[partToWhole?'records':'amount']))
  if(partToWhole){assert.equal(metadata.rows.find(row=>row.label==='West').formatted,'1');assert.equal(await page.locator('pattern').count(),8)}else {
  assert.equal(metadata.rows.find(row=>row.label==='West').formatted,'USD 100.10')
  assert.equal(metadata.rows.find(row=>row.label==='East').formatted,'USD -20.02')
  for(const [region,state] of [['South','null'],['North','value'],['Unknown','unknown'],['Restricted','suppressed'],['Pending','incomplete']])assert.equal(metadata.rows.find(row=>row.label===region).value.state,state)
  assert.match(await page.locator('svg').textContent(),/USD 100\.10/)
  }
  assert.equal(await page.locator('a, image, foreignObject').count(),0)
  assert.equal(await page.getByRole('table',{name:'Exact chart values'}).getByRole('row').count(),8)
  if(['vertical-bar','horizontal-bar'].includes(type)){
   const dimension=type==='vertical-bar'?'height':'width'
   const west=await page.locator('g[aria-label="West: USD 100.10"] rect').getAttribute(dimension),east=await page.locator('g[aria-label="East: USD -20.02"] rect').getAttribute(dimension)
   assert.ok(Math.abs(Number(west)/Number(east)-5)<1e-9,'mark lengths preserve the independently known five-to-one value ratio')
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'chart overflows viewport')
  assert.ok(await page.locator('g[tabindex="0"]').count()>0)
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('tabindex')),'0')
  const outside=await page.locator('text').evaluateAll(nodes=>nodes.filter(node=>{const b=node.getBBox(),v=node.ownerSVGElement.viewBox.baseVal;return b.x<0||b.y<0||b.x+b.width>v.width||b.y+b.height>v.height}).map(node=>node.textContent))
  assert.deepEqual(outside,[],`clipped text for ${type} at ${width}`)
  if(process.env.BIFOCAL_PROOF_DIR)for(const proofWidth of [1440,390]){await page.setViewportSize({width:proofWidth,height:1000});await page.goto(origin+baseUrl+'/'+type+'.svg?width='+proofWidth);await page.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,`chart-${type}-${proofWidth}.png`),fullPage:false})}
 }
 // Filters are applied by the query engine before geometry and retained verbatim.
 const filtered=await call('/queries/run',{...query,filters:[{column:'region',op:'eq',value:'West'}]},201)
 const scoped=await call('/charts/'+filtered.queryId+'/line.json?scale=log')
 assert.deepEqual(scoped.rows.map(row=>row.value.value),['100.10']);assert.deepEqual(scoped.filters,filtered.definition.filters)
 const empty=await call('/queries/run',{...query,filters:[{column:'region',op:'eq',value:'No matching region'}]},201)
 for(const width of [1440]) {
  await page.setViewportSize({width,height:1000})
  for(const [name,id,type,suffix] of [['positive-log',filtered.queryId,'line','&scale=log'],['numeric-kpi',filtered.queryId,'kpi',''],['empty',empty.queryId,'line','']]) {
   const address=origin+'/api/operator/charts/'+id+'/'+type+'.svg?width='+width+suffix
   const response=await context.request.get(address);assert.equal(response.status(),200);assert.ok(!(await response.text()).match(/NaN|Infinity/))
   await page.goto(address)
   if(name==='empty'){assert.match(await page.locator('svg').textContent(),/No groups match/);assert.equal(await page.getByRole('row').count(),0)}
   else {assert.match(await page.locator('svg').textContent(),/USD 100\.10/);assert.equal(await page.getByRole('row').count(),1)}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(process.env.BIFOCAL_PROOF_DIR)for(const proofWidth of [1440,390]){await page.setViewportSize({width:proofWidth,height:1000});await page.goto(origin+'/api/operator/charts/'+id+'/'+type+'.svg?width='+proofWidth+suffix);await page.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,`chart-${name}-${proofWidth}.png`)})}
  }
 }
 const line=await(await context.request.get(origin+chartUrl+'/line.svg')).text()
 assert.equal((line.match(/<path /g)||[]).length,2,'non-numeric states split the two numeric runs')
})

test('chart door refuses unsupported semantics and unauthorized access without retaining a copy',async()=>{
 for(const [suffix,status,error] of [
  ['/state-map.svg',422,'chart_type_not_supported'],['/pie.svg',422,'chart_part_to_whole_requires_complete_nonnegative_values'],['/donut.svg',422,'chart_part_to_whole_requires_complete_nonnegative_values'],['/line.png',404,'chart_not_found'],['/line.svg?measure=absent',422,'chart_measure_not_found'],['/line.svg?scale=log',422,'chart_log_requires_positive_values'],['/area.svg?scale=log',422,'chart_log_requires_line'],['/line.svg?scale=symlog',422,'chart_scale_not_supported'],['/line.svg?measure=amount&measure=amount',400,'chart_option_not_supported'],['/line.svg?url=https%3A%2F%2Fexample.test',400,'chart_option_not_supported'],['/line.svg?width=1',422,'chart_width_out_of_range']]) {
  const response=await context.request.get(origin+chartUrl+suffix);assert.equal(response.status(),status,await response.text());assert.equal((await response.json()).error,error)
 }
 assert.equal((await context.request.get(origin+chartUrl+'/line.svg',{headers:{Cookie:''}})).status(),401)
 assert.equal((await context.request.get(origin+chartUrl+'/line.svg',{headers:{'sec-fetch-site':'cross-site'}})).status(),401)
 assert.equal((await context.request.post(origin+chartUrl+'/line.svg',{headers:headers(),data:{}})).status(),405)
 const head=await context.request.head(origin+chartUrl+'/line.svg');assert.equal(head.status(),200);assert.equal((await head.body()).length,0)
 const distinct=await call('/queries/run',{...query,measures:[{id:'regions',op:'count-distinct',column:'region',unit:'count',scale:0}]},201)
 const nonadditive=await context.request.get(origin+'/api/operator/charts/'+distinct.queryId+'/pie.svg');assert.equal(nonadditive.status(),422);assert.equal((await nonadditive.json()).error,'chart_part_to_whole_requires_additive_measure')
 // No silent truncation of large results.
 const many='id,region,amount,quality\n'+Array.from({length:41},(_,i)=>`${i},Region ${i},1.00,value`).join('\n')+'\n'
 await importData(many,true);const large=await call('/queries/run',query,201)
 const limit=await context.request.get(origin+'/api/operator/charts/'+large.queryId+'/table.json');assert.equal(limit.status(),422);assert.equal((await limit.json()).error,'chart_group_limit_40')
})

test('source changes preserve retained chart values and erasure or revoked sessions withdraw the door',async()=>{
 const retained=await call('/charts/'+snapshot.queryId+'/vertical-bar.json');assert.equal(retained.rows.find(row=>row.label==='West').value.value,'100.10')
 const current=await call('/datasets/'+dataset)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:current.revision})
 for(const format of ['svg','json'])assert.equal((await context.request.get(origin+chartUrl+'/line.'+format)).status(),404)
 const cookie=(await context.cookies()).map(item=>item.name+'='+item.value).join('; ')
 assert.equal((await context.request.post(origin+'/auth/signout',{headers:headers(),form:{},maxRedirects:0})).status(),303)
 assert.equal((await fetch(origin+chartUrl+'/line.svg',{headers:{cookie}})).status,401)
})
