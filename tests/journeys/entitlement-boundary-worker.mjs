// Test scheduling only: real native requests and D1 handle both operations.
import worker from '../../src/server.dev'
let pending
const statements=new WeakMap()
export default {
 async fetch(request,env,execution){
  const url=new URL(request.url)
  // Fixture writes share the live D1 owner; a second local Wrangler process
  // can contend with this Worker's SQLite store while its clock is frozen.
  if(url.pathname==='/__entitlement-fixture'&&request.method==='POST'){
   if(!env.RER_DEV_KEY||request.headers.get('x-rer-dev-key')!==env.RER_DEV_KEY)return new Response(null,{status:404})
   const input=await request.json()
   if(input.action==='clock')return Response.json(await env.DB.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS utc").first())
   if(input.action==='collision-insert'&&typeof input.operatorId==='string'){
    await env.DB.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) SELECT 'synthetic-bifocal-normalization-collision',upper(email),'Synthetic collision','member','active',1,created_at FROM oa_operators WHERE id=?").bind(input.operatorId).run()
    return Response.json({ok:true})
   }
   if(input.action==='collision-remove'){
    await env.DB.prepare("DELETE FROM oa_operators WHERE id='synthetic-bifocal-normalization-collision'").run()
    return Response.json({ok:true})
   }
   return new Response(null,{status:400})
  }
  if(url.pathname==='/__entitlement-boundary'&&request.method==='POST'){
   pending=await request.json();return Response.json({armed:true})
  }
  const wrap=(statement,query)=>{
   const proxy=new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values)=>wrap(target.bind(...values),query)
    const value=target[key];return typeof value==='function'?value.bind(target):value
   }})
   statements.set(proxy,{statement,query});return proxy
  }
  const database=new Proxy(env.DB,{get(target,key){
   if(key==='prepare')return query=>wrap(target.prepare(query),query)
   if(key==='batch')return async queries=>{
    const metadata=queries.map(query=>statements.get(query))
    if(pending&&url.pathname===pending.at&&metadata.some(q=>q?.query.startsWith(pending.before))){
     const mutation=pending;pending=null
     const response=await fetch(url.origin+mutation.path,{method:'POST',headers:{cookie:mutation.cookie,Origin:url.origin,'content-type':'application'+'/json',...mutation.headers},body:JSON.stringify(mutation.body)})
     if(![200,204].includes(response.status))throw Error('Entitlement boundary public mutation refused: '+response.status)
     await response.arrayBuffer()
    }
    return target.batch(metadata.map((value,i)=>value?.statement??queries[i]))
   }
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
  return worker.fetch(request,{...env,DB:database},execution)
 }
}
