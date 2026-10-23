import { rejectedResponse } from '../../base/rejected-response'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { fileOwner } from '../imports/files/owner.server'
import { ownerIdentity, readQuery } from '../data/snapshots/store'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'
import { QueryError, fail } from '../query/types'
import { chartData, chartOptions, chartSvg, chartTypes } from './render'

const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox",'x-robots-tag':'noindex, nofollow'}
/** Derived on demand: no extra stored copy can outlive source erasure. */
export async function chartResponse(request: Request, original: Bindings): Promise<Response|null> {
 const url=new URL(request.url)
 if(!/^\/api\/operator\/charts(?:\/|$)/.test(url.pathname))return null
 const env=runtimeBindings(original)
 try {
  const owner=await fileOwner(request,env)
  if(!owner)fail('owner_required',401)
  if(!['GET','HEAD'].includes(request.method))fail('method_not_allowed',405)
  const ownerId=await ownerIdentity(env,owner)
  if(url.pathname==='/api/operator/charts') {
   if(url.search)fail('chart_option_not_supported',400)
   await transact(env.DB,owner,[])
   return new Response(request.method==='HEAD'?null:JSON.stringify({types:chartTypes,formats:['svg','json'],maxGroups:40,minGroupWidth:24,width:{min:320,max:1440,default:720},scales:{linear:chartTypes,log:['line','stepped-line','sparkline']}}),{headers:{...headers,'content-type':'application/json'}})
  }
  const match=/^\/api\/operator\/charts\/([a-f0-9-]{36})\/([a-z-]+)\.(svg|json)$/.exec(url.pathname)
  if(!match)fail('chart_not_found',404)
  const {snapshot,guard}=await readQuery(env,owner,ownerId,match[1]),options=chartOptions(snapshot,match[2],url.searchParams)
  const document=match[3]==='svg'?chartSvg(snapshot,options):JSON.stringify(chartData(snapshot,options))
  // Fence the fully rendered response against concurrent withdrawal or revocation.
  await transact(env.DB,owner,[assertion(guard)])
  return new Response(request.method==='HEAD'?null:document,{headers:{...headers,'content-type':match[3]==='svg'?'image/svg+xml; charset=utf-8':'application/json; charset=utf-8'}})
 } catch(error) {
  return rejectedResponse(request,Response.json({error:error instanceof QueryError?error.code:'chart_snapshot_conflict'},{status:error instanceof QueryError?error.status:409,headers}))
 }
}
