// Test-only scheduler around the emitted Worker and real local D1. It inserts
// an actual authenticated public mutation immediately before a read's final
// response transaction. No application authorization or SQL result is mocked.
import worker from '../../dist/server/index.js'
let pending
const statements=new WeakMap()
export default {
 async fetch(request,env,execution){
  const url=new URL(request.url)
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
    if(pending&&metadata.some(q=>q?.query.startsWith('INSERT INTO bf_machine_audit(')&&['query','definitions'].includes(q.args[4]))){
     const mutation=pending;pending=null
     const response=await worker.fetch(new Request(url.origin+mutation.path,{method:'POST',headers:{cookie:mutation.cookie,Origin:url.origin,'content-type':'application'+'/json'},body:JSON.stringify(mutation.body)}),env,execution)
     if(response.status!==200)throw Error('Boundary fixture public mutation refused: '+response.status)
     await response.arrayBuffer()
    }
    return target.batch(metadata.map((value,i)=>value?.statement??queries[i]))
   }
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
  return worker.fetch(request,{...env,DB:database},execution)
 }
}
