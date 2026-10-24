const discardLimit=65536
const discardDeadlineMs=2000

/** Finish refused uploads without buffering or interpreting their contents.
 * Drain through EOF within the time bound, even after the size refusal, so
 * cancelling an ordinary oversized body cannot abort the next proxy request. */
export async function rejectedUpload(request:Request,response:Response):Promise<Response> {
 if(!request.body||request.bodyUsed||request.body.locked)return response
 const reader=request.body.getReader()
 let bytes=0,limited=false,timer:ReturnType<typeof setTimeout>|undefined
 const deadline=new Promise<'timeout'>(resolve=>{timer=setTimeout(()=>resolve('timeout'),discardDeadlineMs)})
 try {
  for(;;) {
   const part=await Promise.race([reader.read(),deadline])
   if(part==='timeout'){limited=true;void reader.cancel().catch(()=>{});break}
   if(part.done)break
   bytes+=part.value.byteLength
   if(bytes>discardLimit)limited=true
  }
 }catch{limited=true}
 finally{clearTimeout(timer)}
 if(!limited)return response
 const headers=new Headers(response.headers)
 for(const name of ['set-cookie','location','content-length','content-encoding'])headers.delete(name)
 headers.set('content-type','text/plain; charset=utf-8')
 void response.body?.cancel().catch(()=>{})
 return new Response('Request body too large or incomplete',{status:413,headers})
}
