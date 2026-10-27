// Test-only scheduler around the emitted Worker and real local D1. It inserts
// an actual authenticated public mutation immediately before a read's final
// response transaction. No application authorization or SQL result is mocked.
import worker from '../../dist/server/index.js'
import { withDevIdentity } from '../../src/modules/operator-auth/dev/index.mjs'
// The real local-only native CLI can issue a step-up-fenced native session.
// It is available only in this fixture, with this journey's synthetic secrets.
const local=withDevIdentity(worker,{config:env=>({dependencies:true,origin:env.AUTH_ORIGIN,local:true,OWNER_EMAIL:env.OWNER_EMAIL,SESSION_SECRET:env.SESSION_SECRET,INSTALLATION_KEY:env.INSTALLATION_KEY,SETUP_TOKEN:env.SETUP_TOKEN,MAIL_FROM:env.MAIL_FROM,branding:{productName:'Bifocal'}})})
let pending
const statements=new WeakMap()
export default {
 async fetch(request,env,execution){
  const url=new URL(request.url)
  if(['/auth/local/cli-session','/auth/dev/enter'].includes(url.pathname))return local.fetch(request,env,execution)
  if(url.pathname==='/__machine-boundary'&&request.method==='POST'){
   pending=await request.json()
   return Response.json({armed:true})
  }
  const wrap=(statement,query,args=[])=>{
   const proxy=new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values)=>wrap(target.bind(...values),query,values)
    const value=target[key];return typeof value==='function'?value.bind(target):value
   }})
   statements.set(proxy,{statement,query,args});return proxy
  }
  const database=new Proxy(env.DB,{get(target,key){
   if(key==='prepare')return query=>wrap(target.prepare(query),query)
   if(key==='batch')return async queries=>{
    const metadata=queries.map(query=>statements.get(query))
    if(pending&&metadata.some(q=>(q?.query.startsWith('INSERT INTO bf_machine_audit(')&&['query','definitions'].includes(q.args[4]))||(q?.query==='INSERT INTO bf_portal_audit VALUES(?,?,?,?,?,?)'&&q.args[3]==='export-completed'))){
     const mutation=pending;pending=null
     const response=await fetch(new Request(url.origin+mutation.path,{method:'POST',headers:{cookie:mutation.cookie,Origin:url.origin,'content-type':'application'+'/json'},body:JSON.stringify(mutation.body)}))
     if(response.status!==200){console.error('Boundary fixture mutation refused',response.status,await response.text());throw Error('Boundary fixture public mutation refused: '+response.status)}
     await response.arrayBuffer()
    }
    return target.batch(metadata.map((value,i)=>value?.statement??queries[i]))
   }
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
  return worker.fetch(request,{...env,DB:database},execution)
 }
}
