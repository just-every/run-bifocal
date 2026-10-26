import { runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { guarded, sql } from '../company/store'
import { rejectedResponse } from '../../base/rejected-response'
export async function erasureReceiptResponse(request:Request,original:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname
 if(!path.startsWith('/api/operator/erasure-receipts/'))return null
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}})
 const env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner)return rejectedResponse(request,json({error:'owner_required'},401))
 if(request.method!=='GET')return json({error:'method_not_allowed'},405)
 const id=path.slice('/api/operator/erasure-receipts/'.length)
 if(!/^[a-f0-9-]{36}$/.test(id))return json({error:'receipt_not_found'},404)
 try{
  const [audit,stores]=await guarded<Record<string,unknown>>(env,owner,[sql('SELECT * FROM bf_erasure_audit WHERE id=?',id),sql('SELECT store,rows FROM bf_erasure_stores WHERE audit_id=? ORDER BY store',id)])
  if(!audit[0])return json({error:'receipt_not_found'},404)
  return json({audit:audit[0],stores:stores.map(store=>({...store,state:'complete'})),scope:'Completed file import custody and enumerated native derivative stores. Separate model-project and calculation-library retirement results remain in the original erasure response.',externalCopies:'External downloads and sent messages cannot be recalled. No provider deletion completion or legal-hold check is asserted.',restore:'An older archive is fenced only where the current erasure journal is known. Fresh-destination acknowledgment and journal import require BIF-086.'})
 }catch{return json({error:'receipt_conflict'},409)}
}
