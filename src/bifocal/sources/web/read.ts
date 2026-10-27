import { boundedText, requireValue } from '../analytics/protocol'
import { destination, type WebInput } from './input'
import { cell, decode, optional } from './document'
export type WebSnapshot = {rows:(string|null)[][];pages:number;deltaAvailable:boolean}
/** A synchronous complete snapshot, with no retry, refresh, writes or retained
 * cursor authority. Every continuation is validated before sending the grant. */
export async function readWeb(input:WebInput,check:()=>Promise<void>,signal:AbortSignal):Promise<WebSnapshot> {
 const origin=new URL(input.endpoint).origin,seen=new Set<string>(),rows:(string|null)[][]=[]
 let next:URL|null=new URL(input.endpoint),pages=0,bytes=0,deltaAvailable=false
 if(input.paging==='page' || input.paging==='offset'){next.searchParams.set(input.parameter,input.paging==='page'?'1':'0');next.searchParams.set(input.sizeParameter,String(input.pageSize))}
 while(next) {
  await check()
  requireValue(!signal.aborted,'web_read_cancelled',409)
  requireValue(pages<20 && !seen.has(next.href),'web_nonterminating_pagination',409)
  requireValue(!next.href.includes(input.accessToken),'web_credentials_in_url',403)
  seen.add(next.href)
  let response:Response
  try { response=await fetch(next,{method:'GET',headers:{Authorization:'Bearer '+input.accessToken,Accept:input.format==='xml'?'application/xml':'application/json;IEEE754Compatible=true'},redirect:'manual',signal}) } catch { requireValue(false,signal.aborted?'web_read_cancelled':'web_read_unavailable',409) }
  if(response!.status>=300 && response!.status<400){await response!.body?.cancel();requireValue(false,'web_redirect_refused',409)}
  if(!response!.ok){await response!.body?.cancel();requireValue(false,response!.status===429?'web_rate_limited':response!.status===401 || response!.status===403?'web_authorization_expired':'web_source_failed',response!.status===429?429:409)}
  if(response!.status!==200){await response!.body?.cancel();requireValue(false,'web_partial_response_refused',502)}
  requireValue(input.format==='xml'?/^(?:application|text)\/(?:[\w.+-]*\+)?xml(?:\s*;|$)/i.test(response!.headers.get('content-type')??''):/^application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(response!.headers.get('content-type')??''),'web_content_type_required',502)
  const source=await boundedText(response!.body,524288-bytes,'web_response_limit');bytes+=new TextEncoder().encode(source).length
  requireValue(!source.includes(input.accessToken),'web_credential_in_response',502)
  const {document,items}=decode(source,input)
  requireValue(rows.length+items.length<=2000,'web_row_limit',413)
  const pageRows=items.map(row=>input.fields.map(field=>cell(row,field)))
  requireValue(!pageRows.some(row=>row.some(value=>value!==null && value.includes(input.accessToken))),'web_credential_in_response',502)
  rows.push(...pageRows);pages++
  let continuation:unknown
  if(input.paging==='next-link') {
   if(input.format==='odata') {continuation=optional(document,'@odata.nextLink')??optional(document,'@nextLink');deltaAvailable=!!(optional(document,'@odata.deltaLink')??optional(document,'@deltaLink'))}
   else if(input.nextPath)continuation=optional(document,input.nextPath)
   else {
    const links=response!.headers.get('link')??'',matches=[...links.matchAll(/<([^>]+)>\s*;\s*rel="?next"?(?=\s*[,;]|\s*$)/g)]
    requireValue(matches.length<=1,'web_ambiguous_next_link',502);continuation=matches[0]?.[1]
   }
   requireValue(!continuation || typeof continuation==='string','web_invalid_next_link',502)
   next=continuation?destination(continuation,[origin],next.href):null
  } else if(input.paging==='cursor') {
   continuation=optional(document,input.nextPath)
   requireValue(continuation===undefined || continuation===null || typeof continuation==='string' && continuation.length<=1024,'web_invalid_cursor',502)
   if(continuation){next=new URL(input.endpoint);next.searchParams.set(input.parameter,String(continuation))}else next=null
  } else if(input.paging==='page' || input.paging==='offset') {
   requireValue(items.length<=input.pageSize,'web_page_size_mismatch',502)
   if(items.length===input.pageSize){next=new URL(input.endpoint);next.searchParams.set(input.parameter,String(input.paging==='page'?pages+1:rows.length));next.searchParams.set(input.sizeParameter,String(input.pageSize))}else next=null
  } else {
   requireValue(!optional(document,input.nextPath) && !optional(document,'@odata.nextLink') && !/rel="?next/.test(response!.headers.get('link')??''),'web_partial_document_refused',409)
   next=null
  }
 }
 await check();requireValue(!signal.aborted,'web_read_cancelled',409)
 return {rows,pages,deltaAvailable}
}
