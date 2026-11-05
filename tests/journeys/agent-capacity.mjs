import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {request as httpRequest} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import initializeAgent from '../agent-initialize.mjs'
import {autonomousPolicy} from '../../src/modules/agent-door/conformance/crypto.mjs'

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const minute=()=>Math.floor(Date.now()/60000)

/** Seed qualification through the emitted production Worker, public native
 * review doors and persistent D1. No shared harness or clock is replaced. */
export async function proveAgentCapacity() {
 const socket=createServer()
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve))
 const port=socket.address().port
 await new Promise(resolve=>socket.close(resolve))
 const origin=`http://127.0.0.1:${port}`,persist=await mkdtemp(join(tmpdir(),'bifocal-agent-capacity-'))
 const config='dist/server/wrangler.json',setup='synthetic-bifocal-1'.repeat(3)
 const email=['synthetic-bifocal-1','example.test'].join('@')
 const installationKey=createHash('sha256').update('synthetic-bifocal-2').digest('hex')
 let worker,browser,context
 const stop=async()=>{
  if(!worker || worker.exitCode!==null || worker.signalCode!==null)return
  const done=new Promise(resolve=>worker.once('exit',resolve))
  worker.kill('SIGTERM')
  await done
 }
 const start=async()=>{
  worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--inspector-port','0','--local','--persist-to',persist,'--ip','127.0.0.1','--config',config,'--port',String(port),
   '--var',`AUTH_ORIGIN:${origin}`,'--var','AUTH_LOCAL:true','--var',`OWNER_EMAIL:${email}`,'--var',`MAIL_FROM:${email}`,
   '--var',`SESSION_SECRET:${'synthetic-bifocal-3'.repeat(3)}`,'--var',`SETUP_TOKEN:${setup}`,'--var',`INSTALLATION_KEY:${installationKey}`],
   {stdio:['ignore','ignore','ignore'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
  for(let i=0;i<120;i++){
   assert.equal(worker.exitCode,null,'Capacity Worker must remain running')
   try{const r=await fetch(origin+'/health');await r.arrayBuffer();if(r.ok)return}catch{}
   await wait(250)
  }
  assert.fail('Capacity Worker readiness timed out')
 }
 try {
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config',config],
   {stdio:'pipe',maxBuffer:16*1024*1024,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
  await start()
  browser=await chromium.launch({headless:true,...(process.env.BIFOCAL_CHROMIUM?{executablePath:process.env.BIFOCAL_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  context=await browser.newContext({viewport:{width:1440,height:1000}})
  const bootstrap=await context.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:setup,displayName:'Synthetic capacity owner',returnTo:'/app'},maxRedirects:0})
  assert.equal(bootstrap.status(),303)
  const page=await context.newPage()
  await page.goto(origin+'/setup');await page.getByRole('checkbox').check()
  await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])
  const cookie=(await context.cookies(origin)).map(c=>c.name+'='+c.value).join('; ')
  const human=(absolute,init={})=>fetch(absolute,{...init,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application'+'/json',...init.headers}})
  await initializeAgent({agentId:'synthetic-bifocal-'+randomUUID(),origin,request:human})
  const admin=async(path,data,method=data===undefined?'GET':'POST',expected=200)=>{
   const response=await human(origin+path,{method,...(data===undefined?{}:{body:JSON.stringify(data)})})
   assert.equal(response.status,expected,`Capacity owner door ${path}`)
   return response.json()
  }
  const credentials=()=>admin('/api/operator/credentials')
  const template=JSON.parse((await credentials()).credentials[0].definition_json)
  const issue=async label=>{
   const {sources:_sources,...scope}=template
   const input={...scope,purpose:'Synthetic capacity '+label,maxOperations:2}
   const review=await admin('/api/operator/credentials/review',input)
   return admin('/api/operator/credentials',{...input,reviewedDigest:review.digest},'POST',201)
  }
  const first=await issue('first'),second=await issue('second')
  await admin('/agents/api/policy',{document:autonomousPolicy()},'PUT')
  let rpcId=0
  const rpc=(method,params={})=>JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})
  const mcp=async(path,key,method,params={})=>{
   const headers={'MCP-Protocol-Version':'2025-11-25','Content-Type':'application'+'/json',Origin:origin,...(key?{Authorization:'Bearer '+key.token}:{})}
   const response=await fetch(origin+path,{method:'POST',headers,body:rpc(method,params)})
   return {status:response.status,retryAfter:response.headers.get('retry-after'),body:await response.json()}
  }
  const query={modelId:first.scope.modelId,revision:first.scope.revision,viewId:first.scope.viewId,groupBy:['region'],filters:[]}
  const status=(path,key)=>mcp(path,key,'tools'+'/call',{name:'bifocal.analytics.status',arguments:{}})
  const read=(path,key)=>mcp(path,key,'tools'+'/call',{name:'bifocal.analytics.query',arguments:query})
  const succeeded=response=>{
   assert.equal(response.status,200)
   assert.equal(response.body.result?.isError,false,'Authorized tool must execute: '+(response.body.result?._meta?.['com.runeditrun/error']?.code??'missing result'))
   assert.ok(response.body.result.structuredContent,'Authorized tool returns its actual result')
  }
  const noResult=response=>{
   assert.equal(response.body.result,undefined,'Capacity refusal carries no private result')
   const text=JSON.stringify(response.body)
   for(const privateValue of [first.id,second.id,first.scope.modelId,'West','East','9.98',first.token,second.token])assert.ok(!text.includes(privateValue),'Refusal excludes private data and credentials')
  }
  const limited=response=>{
   assert.equal(response.status,429)
   assert.equal(response.body.error?.data?.code,'rate_limited')
   assert.ok(/^\d+$/.test(response.retryAfter??'') && Number(response.retryAfter)>0,'429 needs a positive Retry-After')
   noResult(response)
  }
  const used=async key=>{
   const row=(await credentials()).credentials.find(row=>row.id===key.id)
   assert.ok(row,'Owner can still inspect the credential')
   return row.used_operations
  }
  const advertised=(await mcp('/mcp',null,'server'+'/discover')).body.result._meta['com.runeditrun/limits']
  assert.deepEqual((await mcp('/api/v1/mcp',null,'server'+'/discover')).body.result._meta['com.runeditrun/limits'],advertised)
  assert.ok(Number.isSafeInteger(advertised.requestsPerMinute) && advertised.requestsPerMinute>1)
  assert.ok(Number.isSafeInteger(advertised.maxBodyBytes) && advertised.maxBodyBytes>0)
  const proof=process.env.BIFOCAL_PROOF_DIR
  if(proof)await mkdir(proof,{recursive:true})
  const screen=async name=>{
   // Assertions run at desktop width; these are the two landing proof views.
   if(proof)for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready)
    await page.screenshot({path:join(proof,`${name}-${width}.png`),fullPage:true})
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  // A real timing requirement: enter a fresh minute rather than substituting a
  // test clock or assuming that execution starts away from a boundary.
  console.log('Capacity fixture: reviewed native credentials and owner-selected policy ready; waiting for a fresh real minute.')
  await wait(60000-Date.now()%60000+100)
  const window=minute(),split=Math.floor(advertised.requestsPerMinute/2)
  const fill=async(path,count)=>{
   // Complete each authorized status call before the next: the shared policy
   // decision lock is a separate concurrency guard, not the minute counter.
   for(let i=0;i<count;i++)succeeded(await status(path,first))
  }
  await fill('/mcp',split)
  await fill('/api/v1/mcp',advertised.requestsPerMinute-split)
  limited(await status('/mcp',first));limited(await read('/api/v1/mcp',first))
  assert.equal(minute(),window,'Saturation must finish in the measured real minute')
  assert.equal(await used(first),0,'Status and capacity refusals consume no native data-read allowance')
  console.log('PROBE BASE-AGENT-011 capacity: advertised limit split across both MCP aliases -> 429, positive Retry-After, no private result and zero native reads.')
  await stop();await start()
  limited(await status('/api/v1/mcp',first));limited(await read('/mcp',first))
  assert.equal(minute(),window,'Restart proof must remain in the saturated minute')
  console.log('PROBE BASE-AGENT-011 restart: production Worker restart with the same D1 -> both aliases retain the overrun.')
  const independent=await read('/mcp',second);succeeded(independent)
  assert.equal(independent.body.result.structuredContent.totals.revenue.value,'9.98')
  assert.equal(await used(second),1);assert.equal(await used(first),0)
  console.log('PROBE BASE-AGENT-011 independent: separately reviewed second credential -> exact West USD 9.98 while the first remains limited.')
  // Both an explicit length and a chunked body are valid query calls padded
  // beyond the advertised bytes. Removing the size guard would execute them.
  const normal=rpc('tools'+'/call',{name:'bifocal.analytics.query',arguments:query})
  const oversized=normal+' '.repeat(advertised.maxBodyBytes-Buffer.byteLength(normal)+1)
  for(const path of ['/mcp','/api/v1/mcp']){
   // Read the early HTTP response even when the Worker cancels the remaining
   // upload. Fetch can reject the upload write instead of exposing that 413.
   const refusal=await new Promise((resolve,reject)=>{
    let responding=false
    const upload=httpRequest(origin+path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+second.token,'Content-Type':'application'+'/json','MCP-Protocol-Version':'2025-11-25',...(path==='/mcp'?{'Content-Length':Buffer.byteLength(oversized)}:{'Transfer-Encoding':'chunked'})}},response=>{
     responding=true
     let text=''
     response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk})
     response.once('error',reject)
     response.once('end',()=>{try{assert.equal(response.statusCode,413,'Oversized public request '+path+': '+text.slice(0,80));resolve({status:response.statusCode,body:JSON.parse(text)})}catch(error){reject(error)}})
    })
    upload.once('error',error=>{if(!responding)reject(error)})
    upload.end(oversized)
   })
   assert.equal(refusal.status,413);noResult(refusal)
  }
  assert.equal(await used(second),1,'Oversized valid reads never execute or consume an allowance')
  console.log('PROBE BASE-AGENT-011 body: oversized valid query, fixed length and streamed -> 413 without execution or native allowance consumption.')
  await page.goto(origin+'/app/settings')
  await page.getByLabel('Your name').fill('Synthetic capacity owner updated')
  await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Save name',exact:true}).click()])
  assert.equal(await page.getByLabel('Your name').inputValue(),'Synthetic capacity owner updated')
  await screen('agent-capacity-owner-settings')
  await page.goto(origin+'/app/settings/credentials')
  assert.ok(await page.getByRole('heading',{name:'Machine credentials',exact:true}).isVisible())
  await screen('agent-capacity-credentials')
  await page.goto(origin+'/agents')
  assert.equal(await page.getByRole('button',{name:'Pause agents',exact:true}).count(),1)
  await screen('agent-capacity-saturated')
  await page.getByRole('button',{name:'Pause agents',exact:true}).click()
  await page.getByRole('button',{name:'Resume agents',exact:true}).waitFor()
  assert.equal((await admin('/agents/api/state')).paused.local,true)
  const paused=await read('/api/v1/mcp',second)
  assert.equal(paused.body.result?._meta?.['com.runeditrun/error']?.code,'agents_paused')
  assert.equal(paused.body.result.structuredContent,undefined)
  const resume=await fetch(origin+'/agents/api/pause',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+second.token,'Content-Type':'application'+'/json'},body:JSON.stringify({paused:false})})
  assert.equal(resume.status,403);await resume.arrayBuffer()
  assert.equal((await admin('/agents/api/state')).paused.local,true)
  await screen('agent-capacity-paused')
  // The saturated minute must still be active after human administration.
  assert.equal(minute(),window,'Owner administration proof must run during overrun')
  const remaining=(window+1)*60000-Date.now()+100
  if(remaining>0)await wait(remaining)
  const resetPaused=await status('/mcp',first)
  assert.equal(resetPaused.body.result?._meta?.['com.runeditrun/error']?.code,'agents_paused','Minute recovery must not clear human Pause')
  assert.equal(resetPaused.body.result.structuredContent,undefined)
  assert.equal(await used(first),0);assert.equal(await used(second),1)
  await page.getByRole('button',{name:'Resume agents',exact:true}).click()
  await page.getByRole('button',{name:'Pause agents',exact:true}).waitFor()
  assert.equal((await admin('/agents/api/state')).paused.local,false)
  for(const path of ['/mcp','/api/v1/mcp']){
   const recovered=await read(path,first);succeeded(recovered)
   assert.equal(recovered.body.result.structuredContent.totals.revenue.value,'9.98')
   assert.equal(recovered.body.result.structuredContent.totalRows,1)
   assert.ok(!JSON.stringify(recovered.body).includes('East'))
  }
  assert.equal(await used(first),2,'Only the two recovered reads consume the native allowance')
  const exhausted=await read('/mcp',first)
  assert.equal(exhausted.body.result?.isError,true,'Native read allowance remains enforced after capacity recovery')
  assert.equal(exhausted.body.result.structuredContent,undefined)
  await screen('agent-capacity-resumed')
  console.log('PROBE BASE-AGENT-011 owner and Pause: signed-in Settings save and Pause remain usable during overrun; machine resume is refused; minute reset retains Pause; human resume restores both aliases with exactly two native reads.')
 } finally {
  try{await context?.close();await browser?.close()}finally{await stop();await rm(persist,{recursive:true,force:true})}
 }
}
