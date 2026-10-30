import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
export async function questionRuntime(edge,model){
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
 const origin='http://127.0.0.1:'+port,persist=await mkdtemp(join(tmpdir(),'bifocal-questions-')),headers={Origin:origin},setup='synthetic-bifocal-1'.repeat(3)
 const wrangler=['node_modules/wrangler/bin/wrangler.js'],config=['--config','dist/server/wrangler.json'],env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
 // Actual provider credentials stay only in the test edge. The Worker receives
 // a synthetic, ephemeral edge credential, never a live provider key.
 delete env.C21_LIVE_AI_KEY
 let output='',browser,worker
 const close=async()=>{
  await browser?.close()
  worker?.kill('SIGTERM')
  if(worker)await new Promise(resolve=>worker.exitCode!==null||worker.signalCode!==null?resolve():worker.once('exit',resolve))
  await rm(persist,{recursive:true,force:true})
  // wrangler dev keeps its scratch (.wrangler/tmp) beside the config it runs, which here is the emitted Worker; the artifact producer refuses that folder in dist/server, so leave the build output as rer build wrote it.
  await rm('dist/server/.wrangler',{recursive:true,force:true})
 }
 try{
<<<<<<< HEAD
  execFileSync(process.execPath,[...wrangler,'d1','migrations','apply','foundation','--local','--persist-to',persist,...config],{env,stdio:'pipe',maxBuffer:16*1024*1024})
=======
  execFileSync(process.execPath,[...wrangler,'d1','migrations','apply','foundation','--local','--persist-to',persist,...config],{env,stdio:['ignore','inherit','inherit']})
>>>>>>> 555f02d (Stream migration progress in native verification journeys)
  worker=spawn(process.execPath,[...wrangler,'dev','--inspector-port','0','--local','--persist-to',persist,'--ip','127.0.0.1',...config,'--port',String(port),'--var',`AUTH_ORIGIN:${origin}`,'--var','AUTH_LOCAL:true','--var','OWNER_EMAIL:synthetic-bifocal-1@example.test','--var','MAIL_FROM:synthetic-bifocal-2@example.test','--var',`SESSION_SECRET:${'synthetic-bifocal-2'.repeat(3)}`,'--var',`SETUP_TOKEN:${setup}`,'--var',`INSTALLATION_KEY:${createHash('sha256').update('synthetic-bifocal-6').digest('hex')}`,'--var','AI_ENABLED:true','--var',`AI_MODEL:${model}`,'--var',`AI_BASE_URL:${edge.origin}/v1`,'--var',`AI_API_KEY:${edge.key}`],{env,stdio:['ignore','pipe','pipe']})
  worker.stdout.on('data',b=>output+=b);worker.stderr.on('data',b=>output+=b)
  for(let i=0;i<120;i++){if(worker.exitCode!==null)throw Error('Question Worker exited');try{if((await fetch(origin+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
  assert.equal((await fetch(origin+'/health')).status,200,output)
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  const context=await browser.newContext(),page=await context.newPage()
  const call=async(path,data,expected=data===undefined?200:201,extra={})=>{const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers:{...headers,...extra},...(data===undefined?{}:{data}),timeout:45000});assert.equal(response.status(),expected,await response.text());return response.json()}
  assert.equal((await context.request.post(origin+'/auth/bootstrap',{headers,data:{token:setup,displayName:'Synthetic owner',returnTo:'/app'},maxRedirects:0})).status(),303)
  await page.goto(origin+'/setup');await page.getByRole('checkbox').check();await Promise.all([page.waitForURL(origin+'/app'),page.getByRole('button',{name:'Finish setup'}).click()])
  const upload=async(dataset,csv,catchup=false)=>{
   const input={version:1,datasetId:dataset,filename:'synthetic-bifocal-question-source.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:null,formulaTreatment:'literal-text',data:csv},bytes=Buffer.from(JSON.stringify(input)),digest=createHash('sha256').update(bytes).digest('hex')
   const post=async(action,data)=>{const response=await context.request.post(origin+'/api/operator/import/'+action,{headers:{...headers,'X-Import-Dataset':dataset},data});assert.equal(response.status(),200,await response.text());return response.json()}
   const uploaded=await post('uploads',{name:'synthetic-bifocal-source.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')}),plan=await post('plan',{uploadId:uploaded.uploadId,...(catchup?{catchup:true}:{})})
   for(let i=0;i<20;i++){const applied=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(applied.job.state==='completed')return}
   assert.fail('Question source import did not finish')
  }
  const screen=async(name)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Question overflow '+name);assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0,'No unlabeled icon control');if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,name+'-'+width+'.png'),fullPage:true})}}}
  return {origin,context,page,call,upload,screen,close}
 }catch(error){await close();throw error}
}
