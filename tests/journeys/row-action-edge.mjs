import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {readdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createServer} from 'node:net'
import {DatabaseSync} from 'node:sqlite'

/** Only the four provider HTTPS edges are faked. Schemas and response shapes
 * are pinned to their public implementations in docs/ROW-ACTIONS.md. */
export async function rowActionEdge(persist) {
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
 const origin='http://127.0.0.1:'+port
 const providerOrigins=Object.fromEntries(['pegboard','orbit','happytohelp','crank'].map(name=>[name,'https://synthetic-bifocal-'+name+'.workers.dev']))
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json'],{stdio:'pipe',maxBuffer:16*1024*1024,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
 const require=createRequire(import.meta.url),wrangler=createRequire(require.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=wrangler('miniflare')
 const modules=[{type:'ESModule',path:resolve('dist/server/index.js')},...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>({type:'ESModule',path:resolve('dist/server/assets',name)}))]
 const state={phase:'success',calls:[],effects:[],expected:null,gate:null,entered:null,failures:[]}
 const mf=new Miniflare(convertV4MiniflareOptions({name:'bifocal-row-actions',host:'127.0.0.1',port,inspectorPort:0,cf:false,modulesRoot:resolve('dist/server'),modules,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(persist,'v3'),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:'synthetic-bifocal-2@example.test',SETUP_TOKEN:'synthetic-bifocal-1'.repeat(3),BIFOCAL_ACTION_ORIGINS:JSON.stringify(providerOrigins)},outboundService:async request=>{
  try {
   const phase=state.phase
   const url=new URL(request.url),name=Object.keys(providerOrigins).find(name=>providerOrigins[name]===url.origin)
   assert.ok(name,'only the deployment-approved provider installation receives bytes')
   assert.equal(url.search,'');assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-action-write')
   for(const header of ['cookie','origin','x-rer-dev-key'])assert.equal(request.headers.has(header),false,'native authority never leaves the application')
   const body=await request.json();state.calls.push({name,path:url.pathname,body})
   assert.deepEqual({name,path:url.pathname,body},state.expected,'network bytes equal the independently expected human-reviewed operation')
   const key=name==='pegboard'?body.intent:name==='orbit'?body.params.arguments.idempotency_key:request.headers.get('idempotency-key')
   assert.ok(key)
   if(name==='orbit')assert.equal(request.headers.get('mcp-protocol-version'),'2025-11-25')
   if(phase==='revoked')return Response.json({error:'scope_denied'},{status:403})
   if(phase==='redirect')return new Response(null,{status:307,headers:{location:'https://unapproved.example.com/write'}})
   if(phase==='bad-schema')return Response.json({ok:true})
   if(phase==='held')return Response.json({data:{held_for_review:true}},{status:202})
   if(phase==='policy-pending')return Response.json({jsonrpc:'2.0',id:key,result:{resultType:'input_required',requestState:'synthetic-state'}})
   state.effects.push({name,key,body})
   // A valid success arrives after the product deadline. Without a real
   // timeout the journey would incorrectly acknowledge it and fail.
   if(phase==='timeout')await new Promise(r=>setTimeout(r,11000))
   if(phase==='lost-response')throw Error('synthetic provider lost its acknowledgement after committing')
   if(state.gate){state.entered();await state.gate}
   if(name==='pegboard')return Response.json({id:'synthetic-task'})
   if(name==='happytohelp')return Response.json({data:{id:'synthetic-ticket',subject:body.subject,status_category:'new',source_ref:body.source_ref}},{status:201})
   if(name==='crank')return Response.json({id:'synthetic-run',workflow_id:phase==='wrong-workflow'?'unreviewed-workflow':'synthetic-workflow',status:phase==='waiting'?'waiting':'succeeded',business_outcome:'unverified'},{status:201})
   return Response.json({jsonrpc:'2.0',id:key,result:{resultType:'complete',isError:false,structuredContent:{id:'synthetic-deal',changed:true},content:[{type:'resource_link',uri:'orbit://records/opportunity/synthetic-deal',name:'Updated CRM record'}]}})
  } catch(error) {state.failures.push(error);throw error}
 }}))
 await mf.ready
 const dbPath=(await readdir(join(persist,'v3'),{recursive:true})).find(path=>path.endsWith('.sqlite'))
 assert.ok(dbPath)
 const inspect=sql=>{const db=new DatabaseSync(join(persist,'v3',dbPath),{readOnly:true});try{return db.prepare(sql).all().map(row=>({...row}))}finally{db.close()}}
 return {origin,providerOrigins,state,inspect,close:()=>mf.dispose()}
}
