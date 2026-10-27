// Test clock only. The emitted application, native sessions and real D1 run
// unchanged; no rule result or application response is substituted.
import worker from '../../dist/server/index.js'
const NativeDate=Date
let instant=null
globalThis.Date=new Proxy(NativeDate,{
 construct(target,args,newTarget){return Reflect.construct(target,args.length?args:[instant??NativeDate.now()],newTarget)},
 apply(){return new NativeDate(instant??NativeDate.now()).toString()},
 get(target,key){return key==='now'?()=>instant??NativeDate.now():Reflect.get(target,key)}
})
export default {
 async fetch(request,env,execution){
  if(new URL(request.url).pathname==='/__quality-clock'&&request.method==='POST'){
   const {at}=await request.json(),value=Date.parse(at)
   if(!Number.isFinite(value))return new Response(null,{status:400})
   instant=value;return Response.json({at:new Date().toISOString()})
  }
  return worker.fetch(request,env,execution)
 }
}
