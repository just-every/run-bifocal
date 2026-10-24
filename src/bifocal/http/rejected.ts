import { rejectedResponse } from '../../base/rejected-response'

/** A refused upload that was cancelled cannot reuse its HTTP connection. */
export async function rejectedUpload(request:Request,response:Response):Promise<Response> {
 const finished=await rejectedResponse(request,response)
 if(finished.status!==413)return finished
 const headers=new Headers(finished.headers)
 headers.set('connection','close')
 return new Response(finished.body,{status:finished.status,headers})
}
