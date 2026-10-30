import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {request} from '@playwright/test'
import {rowActionEdge} from './row-action-edge.mjs'

/** Public native HTTP journeys; the built product, migrations, sessions,
 * reviewed file import, input store, approval and receipt persistence are real. */
export async function proveRowActions() {
 const persist=await mkdtemp(join(tmpdir(),'bifocal-row-actions-')),edge=await rowActionEdge(persist),owner=await request.newContext()
 const {origin,providerOrigins,state}=edge,root=origin+'/api/operator',headers={Origin:origin},bearer='synthetic-bifocal-action-write'
 const call=async(path,data,status=200,extra={})=>{
  const r=await owner.fetch(root+path,{method:data===undefined?'GET':'POST',headers:{...headers,...extra},...(data===undefined?{}:{data})})
  const raw=await r.text();assert.equal(r.status(),status,path+' '+raw);assert.ok(!raw.includes(bearer),'no credential response');return JSON.parse(raw)
 }
 try {
  const bootstrap=await owner.post(origin+'/auth/bootstrap',{headers,data:{token:'synthetic-bifocal-1'.repeat(3),displayName:'Synthetic action owner',returnTo:'/app'},maxRedirects:0})
  assert.equal(bootstrap.status(),303)
  const dataset='synthetic-bifocal-action-source'
  const upload=async(amount='100.00')=>{
   const bytes=Buffer.from(JSON.stringify({version:1,datasetId:dataset,filename:'synthetic.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:'id',formulaTreatment:'literal-text',data:`id,region,amount\naccount-1,West,$${amount}\naccount-2,East,$250.00\n`})),digest=createHash('sha256').update(bytes).digest('hex')
   const extra={'X-Import-Dataset':dataset},uploaded=await call('/import/uploads',{name:'synthetic.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:digest,base64:bytes.toString('base64')},200,extra)
   const plan=await call('/import/plan',{uploadId:uploaded.uploadId,...amount!=='100.00'?{catchup:true}:{}},200,extra)
   for(let n=0;n<20;n++)if((await call('/import/apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},200,extra)).job.state==='completed')return call('/datasets/'+dataset)
   assert.fail('reviewed action source import did not complete')
  }
  const source=await upload(),definition={id:'synthetic-action-input',name:'Overdue accounts',dataset,sourceRevision:source.revision,keyColumn:'id',regionColumn:'region',region:'West',observedColumn:'amount'}
  const review=await call('/inputs/review',definition),table=await call('/inputs',{...definition,reviewedDigest:review.digest},201)
  const inputs={rowKey:'account-1',previousVersion:0,schemaRevision:table.schemaRevision,adjustment:'0.00',note:'Reviewed overdue account',effectiveOn:'2026-10-01',active:true}
  await call('/inputs/'+table.id+'/rows',inputs)
  const configs={
   pegboard:{scope:'task_create',target:'synthetic-project',fields:['title','description'],payload:{title:'Follow up overdue account',description:'Reviewed account-1 context'}},
   orbit:{scope:'records:write',target:'synthetic-deal',fields:['title','stage_id'],payload:{title:'Overdue follow-up',stage_id:'synthetic-stage'},providerRevision:7},
   happytohelp:{scope:'conversations:create',target:'bifocal',fields:['requester','subject','body'],payload:{requester:{external_id:'account-1'},subject:'Overdue account support',body:'Reviewed support request'}},
   crank:{scope:'execution',target:'synthetic-follow-up',fields:['account','note'],payload:{account:'account-1',note:'Reviewed workflow context'}}
  }
  const base=(g,name,ref)=>({grantId:g.id,rowKey:'account-1',inputVersion:1,schemaRevision:table.schemaRevision,payload:configs[name].payload,requestRef:ref,accessToken:bearer,...name==='orbit'?{providerRevision:7}:{}})
  const expected=(name,body)=>{
   const c=configs[name],key=body.requestRef
   const wire={pegboard:{path:'/api/v1/public/tasks',body:{projectId:c.target,...c.payload,kind:'task',intent:key}},orbit:{path:'/mcp',body:{jsonrpc:'2.0',id:key,method:'tools/call',params:{name:'orbit.records.update',arguments:{kind:'opportunity',id:c.target,fields:c.payload,expected_revision:7,idempotency_key:key}}}},happytohelp:{path:'/api/v1/conversations',body:{...c.payload,source_ref:{product:c.target,ref:key}}},crank:{path:'/api/crank/agent-tasks',body:{task_id:key,actions:[{step_id:c.target,input:c.payload}]}}}[name]
   state.expected={name,...wire}
  }
  const grants={}
  for(const [name,c] of Object.entries(configs)) {
   const plan={tableId:table.id,provider:name,origin:providerOrigins[name],target:c.target,...name==='crank'?{workflowId:'synthetic-workflow'}:{},fields:c.fields,scope:c.scope,expiresAt:new Date(Date.now()+3600000).toISOString(),accessToken:bearer}
   await call('/row-actions/grants/review',{...plan,scope:'read'},403)
   await call('/row-actions/grants/review',{...plan,origin:'https://unapproved.example.com'},409)
   const preview=await call('/row-actions/grants/review',plan)
   await call('/row-actions/grants',{...plan,reviewedDigest:preview.digest},409)
   await call('/row-actions/grants',{...plan,target:'another-target',reviewedDigest:preview.digest,confirm:true},409)
   const grant=await call('/row-actions/grants',{...plan,reviewedDigest:preview.digest,confirm:true},201);grants[name]=grant
   const action=base(grant,name,'synthetic-'+name+'-once'),before=state.calls.length
   await call('/row-actions/send',{...action,confirm:true,reviewedDigest:'unreviewed'},409)
   await call('/row-actions/review',action,401,{Origin:'https://foreign.example.test'})
   await call('/row-actions/review',action,401,{Authorization:'Bearer synthetic-machine-read-credential'})
   assert.equal((await fetch(root+'/row-actions/review',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(action)})).status,401)
   await call('/row-actions/review',{...action,rowKey:'account-2'},403)
   await call('/row-actions/review',{...action,accessToken:'synthetic-different-write-token'},403)
   const approved=await call('/row-actions/review',action)
   await call('/row-actions/send',{...action,confirm:false,reviewedDigest:approved.digest},409)
   const changed=structuredClone(action),field=Object.keys(changed.payload).find(key=>typeof changed.payload[key]==='string');changed.payload[field]+=' changed'
   await call('/row-actions/send',{...changed,confirm:true,reviewedDigest:approved.digest},409)
   await call('/row-actions/review',{...action,schemaRevision:'changed-schema'},409)
   assert.equal(approved.state,'review');assert.equal(approved.source.revision,source.revision);assert.equal(approved.source.rowKey,'account-1')
   assert.deepEqual(approved.providerTarget,{target:c.target,...name==='crank'?{workflowId:'synthetic-workflow'}:{}})
   expected(name,action);assert.deepEqual(approved.payload,state.expected.body);assert.equal(approved.destination,providerOrigins[name]+state.expected.path)
   await call('/row-actions/send',{...action,payload:{...action.payload,unexpected:'extra disclosure'},confirm:true,reviewedDigest:approved.digest},400)
   await call('/row-actions/send',{...action,grantId:grants.pegboard.id,requestRef:'changed-ref',confirm:true,reviewedDigest:approved.digest},name==='pegboard'?409:400)
   assert.equal(state.calls.length,before,'review and every refusal perform no outbound action')
   let entered;const started=new Promise(r=>entered=r);let release;state.gate=new Promise(r=>release=r);state.entered=entered
   const send={...action,reviewedDigest:approved.digest,confirm:true}
   const first=call('/row-actions/send',send);await started
   const overlap=await call('/row-actions/send',send);assert.equal(overlap.state,'unresolved');assert.equal(state.calls.length,before+1)
   release();const receipt=await first;state.gate=null
   assert.equal(receipt.state,'acknowledged');assert.ok(receipt.approvedBy);assert.ok(receipt.approvedAt);assert.ok(receipt.settledAt)
   const links={pegboard:providerOrigins.pegboard+'/api/v1/public/tasks/synthetic-task',orbit:'orbit://records/opportunity/synthetic-deal',happytohelp:providerOrigins.happytohelp+'/api/v1/conversations/synthetic-ticket',crank:providerOrigins.crank+'/api/crank/agent-tasks/synthetic-run'}
   assert.equal(receipt.sourceLink,links[name]);assert.deepEqual(await call('/row-actions/send',send),receipt)
   assert.deepEqual(await call('/row-actions/receipts/'+receipt.id),receipt)
   assert.equal(state.calls.length,before+1);assert.equal(state.effects.filter(e=>e.key===action.requestRef).length,1)
   // Provider revocation is a definite refusal, with no receiver effect.
   const refused=base(grant,name,'synthetic-'+name+'-provider-revoked'),rp=await call('/row-actions/review',refused)
   expected(name,refused);state.phase='revoked'
   const denied=await call('/row-actions/send',{...refused,reviewedDigest:rp.digest,confirm:true})
   assert.equal(denied.state,'rejected');assert.equal(denied.sourceLink,null);assert.equal(state.effects.filter(e=>e.key===refused.requestRef).length,0)
   state.phase='success'
   console.log('BIF-030 outbound '+name+': exact approval, provider schema, linked result, one concurrent/replayed effect, current scope and revocation passed')
  }
  for(const [name,phase] of [...Object.keys(configs).flatMap(name=>[[name,'lost-response'],[name,'timeout']]),['pegboard','redirect'],['pegboard','bad-schema'],['happytohelp','held'],['orbit','policy-pending'],['crank','waiting'],['crank','wrong-workflow']]) {
   console.log('Testing outbound outcome: '+name+' '+phase)
   const action=base(grants[name],name,'synthetic-'+name+'-'+phase),review=await call('/row-actions/review',action),before=state.calls.length
   expected(name,action);state.phase=phase
   const receipt=await call('/row-actions/send',{...action,reviewedDigest:review.digest,confirm:true})
   assert.equal(receipt.state,'unresolved',phase+' never claims completion')
   state.phase='success';assert.deepEqual(await call('/row-actions/send',{...action,reviewedDigest:review.digest,confirm:true}),receipt)
   assert.equal(state.calls.length,before+1,phase+' never retries or follows a redirect')
  }
  // A native input edit spends the earlier exact review, even with the same source.
  const stale=base(grants.pegboard,'pegboard','synthetic-stale-input'),staleReview=await call('/row-actions/review',stale)
  await call('/inputs/'+table.id+'/rows',{...inputs,previousVersion:1,note:'Changed after outbound review'})
  const before=state.calls.length
  await call('/row-actions/send',{...stale,reviewedDigest:staleReview.digest,confirm:true},409)
  const pending=[]
  for(const [name,g] of Object.entries(grants)) {
   const action={...base(g,name,'synthetic-'+name+'-local-revoked'),inputVersion:2},review=await call('/row-actions/review',action)
   pending.push({g,action,review})
  }
  const changedSource=await upload('101.00')
  for(const {g,action,review} of pending) {
   await call('/row-actions/send',{...action,reviewedDigest:review.digest,confirm:true},409)
   await call('/row-actions/grants/'+g.id+'/revoke',{confirm:true})
   await call('/row-actions/send',{...action,reviewedDigest:review.digest,confirm:true},403)
   await call('/row-actions/receipts/'+review.id,undefined,403)
  }
  assert.equal(state.calls.length,before,'changed input and revoked grants send nothing')
  // Independent persisted-store inspection: only hashes, identifiers and bounded
  // receipts remain; no action text or access token is copied into the journal.
  const persisted=JSON.stringify(edge.inspect('SELECT * FROM bf_action_receipts'))+JSON.stringify(edge.inspect('SELECT * FROM bf_action_grants'))
  for(const secret of [bearer,'Reviewed account-1 context','Reviewed support request','Reviewed workflow context'])assert.ok(!persisted.includes(secret))
  await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:changedSource.revision})
  assert.equal(edge.inspect('SELECT count(*) AS n FROM bf_action_grants')[0].n,0)
  const erased=edge.inspect('SELECT state,source_link,outcome FROM bf_action_receipts')
  assert.ok(erased.length>0);assert.ok(erased.every(row=>row.state==='erased'&&row.source_link===null&&row.outcome===null))
  assert.equal(state.calls.length,before,'source erasure sends no outbound deletion')
  // Lost-response is an intentional transport failure, not a hidden assertion.
  assert.deepEqual(state.failures.map(e=>e.message),Array(4).fill('synthetic provider lost its acknowledgement after committing'))
  console.log('BIF-030 outbound guards: lost response, timeout, redirect, malformed success, held/pending/waiting, changed input, revoked local grants and payload-free receipts passed')
 } catch(error) {console.error(error);throw error} finally {await owner.dispose();await edge.close();await rm(persist,{recursive:true,force:true})}
}
