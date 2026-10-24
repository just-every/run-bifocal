import { appDocument, appPolicy, escapeHtml } from '../../app/shell'
import { fail, QueryError } from '../query/types'
export const json = (data: unknown, status=200) => Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
export const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v)
export function text(v:unknown,max=240):string {if(typeof v!=='string'||!v.trim()||v.length>max)fail('nonempty_text_required',400);return v.trim()}
export const ident=(v:unknown)=>{const s=text(v,64);if(!/^[a-z][a-z0-9-]*$/.test(s))fail('stable_id_required',400);return s}
export function exact(v:Record<string,unknown>,keys:string[]) {if(Object.keys(v).some(k=>!keys.includes(k)))fail('unsupported_field',400)}
export async function input(request:Request):Promise<Record<string,unknown>> {
 const type=request.headers.get('content-type')??'', reader=request.body?.getReader()
 if(!reader)fail('body_required',400)
 let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true})
 try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32768)fail('body_too_large',413);raw+=decoder.decode(part.value,{stream:true})}raw+=decoder.decode()
  if(type.startsWith('application/x-www-form-urlencoded'))return Object.fromEntries(new URLSearchParams(raw))
  if(!type.startsWith('application/json'))fail('json_or_form_required',400)
  const value=JSON.parse(raw);if(!object(value))fail('object_required',400);return value
 }catch(e){if(e instanceof QueryError)throw e;fail('invalid_body',400)}finally{await reader.cancel();reader.releaseLock()}
}
export const field=(name:string,label:string,value='',kind='text')=>`<label>${escapeHtml(label)}<input name="${name}" type="${kind}" value="${escapeHtml(value)}" required></label>`
export const hidden=(name:string,value:unknown)=>`<input type="hidden" name="${name}" value="${escapeHtml(String(value))}">`
export const details=(label:string,value:unknown)=>`<details class="panel"><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(JSON.stringify(value,null,2))}</pre></details>`
export function document(title:string,viewer:{displayName:string;role:string},main:string,status=200) {
 return new Response(appDocument({title:title+' · Bifocal',viewer,place:'answers',side:'<nav class="sidelist" aria-label="Governed data"><a href="/app/metrics">Metrics</a><a href="/app/goals">Goals</a><a href="/app/quality">Data quality</a><a href="/app/queries">Exact answers</a></nav>',main:`<h1>${escapeHtml(title)}</h1>${main}`}),{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}})
}
export function result(request:Request,value:unknown,location:string,status=201) {return request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?new Response(null,{status:303,headers:{location,'cache-control':'no-store'}}):json(value,status)}
