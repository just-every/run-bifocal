import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
const require=createRequire(join(process.cwd(),'package.json'))
const {request}=require('@playwright/test')
const socket=createServer()
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve))
const port=socket.address().port
await new Promise(resolve=>socket.close(resolve))
const persist=await mkdtemp(join(tmpdir(),'bifocal-leaf-'))
const origin='http://127.0.0.1:'+port, token='synthetic-bifocal-1'.repeat(3)
const config=['--local','--persist-to',persist,'--config','dist/server/wrangler.json']
const cli='node_modules/wrangler/bin/wrangler.js'
let output='',worker,context
try{
 execFileSync(process.execPath,[cli,'d1','migrations','apply','foundation',...config],{stdio:'pipe',maxBuffer:32*1024*1024,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
 worker=spawn(process.execPath,[cli,'dev',...config,'--ip','127.0.0.1','--inspector-port','0','--port',String(port),'--var','AUTH_ORIGIN:'+origin,'--var','AUTH_LOCAL:true','--var','OWNER_EMAIL:synthetic-bifocal-1@example.test','--var','SESSION_SECRET:'+'synthetic-bifocal-2'.repeat(3),'--var','SETUP_TOKEN:'+token,'--var','INSTALLATION_KEY:'+createHash('sha256').update('synthetic-bifocal-6').digest('hex')],{stdio:['ignore','pipe','pipe']})
 worker.stdout.on('data',chunk=>output+=chunk)
 worker.stderr.on('data',chunk=>output+=chunk)
 for(let i=0;i<120;i++){try{if((await fetch(origin+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 context=await request.newContext()
 const bootstrap=await context.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token,displayName:'Synthetic owner',returnTo:'/app'},maxRedirects:0})
 assert.equal(bootstrap.status(),303)
 assert.equal((await context.get(origin+'/auth/session')).status(),200)
 for(const dataset of ['synthetic-bifocal-sales','synthetic-bifocal-legacy']){
  const data={confirmDataset:dataset,reviewedDatasetRevision:'synthetic-revision',previousRevision:null,legalHold:true,minimumRetainUntil:null}
  const response=await context.put(origin+'/api/operator/retention/'+dataset,{headers:{Origin:origin,Authorization:'Bearer synthetic-bifocal-1'},data})
  console.log(JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dataset,status:response.status(),body:await response.text()}))
  assert.equal(response.status(),401,'A machine bearer with owner cookies cannot approve protection')
 }
 console.log('Leaf authority requests passed')
}finally{
 await context?.dispose()
 if(worker){worker.kill('SIGTERM');await new Promise(resolve=>worker.exitCode!==null?resolve():worker.once('exit',resolve))}
 console.log(output.split('\n').filter(line=>/Error|error|retention|401|500|ReferenceError|TypeError/.test(line)).join('\n'))
 await rm(persist,{recursive:true,force:true})
}
