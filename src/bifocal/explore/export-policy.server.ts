import { runtimeBindings, operatorAuth, type Bindings } from '../../auth.server'
import { appDocument, appPolicy } from '../../app/shell'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { currentAuthority, type Authority } from '../catalog/authority.server'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'

export const interactiveExportDefaults={csv:30000,xlsx:150000} as const
export type ExportPolicy={revision:number;csv:number;xlsx:number}

/** Revision zero is the native configuration before the owner's first change. */
export async function readExportPolicy(env:Bindings):Promise<ExportPolicy> {
 return await env.DB.prepare('SELECT revision,csv,xlsx FROM bf_explore_export_policy WHERE singleton=1').first<ExportPolicy>()??{revision:0,...interactiveExportDefaults}
}
export const exportPolicyGuard=(policy:ExportPolicy)=>policy.revision===0
 ?sql('NOT EXISTS(SELECT 1 FROM bf_explore_export_policy WHERE singleton=1)')
 :sql('EXISTS(SELECT 1 FROM bf_explore_export_policy WHERE singleton=1 AND revision=? AND csv=? AND xlsx=?)',policy.revision,policy.csv,policy.xlsx)

/** Called inside exploration's existing native session/origin admission. */
export async function exportPolicyResponse(request:Request,env:Bindings,actor:Authority,path:string):Promise<Response|null> {
 if(path!=='/api/operator/explore/export-policy')return null
 if(actor.role!=='owner')fail('owner_required',403)
 if(request.method==='GET') {
  const policy=await readExportPolicy(env)
  await transact(env.DB,actor,[assertion(exportPolicyGuard(policy))])
  return json(policy)
 }
 if(request.method!=='PUT')fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['previousRevision','csv','xlsx'])
 if(!Number.isSafeInteger(input.previousRevision)||Number(input.previousRevision)<0)fail('previous_export_policy_revision_required',400)
 if(!Number.isSafeInteger(input.csv)||Number(input.csv)<1||Number(input.csv)>interactiveExportDefaults.csv||!Number.isSafeInteger(input.xlsx)||Number(input.xlsx)<1||Number(input.xlsx)>interactiveExportDefaults.xlsx)fail('export_caps_must_be_positive_and_within_defaults',400)
 const previous=await readExportPolicy(env)
 if(previous.revision!==input.previousRevision)fail('export_policy_changed',409)
 const policy={revision:previous.revision+1,csv:Number(input.csv),xlsx:Number(input.xlsx)}
 await transact(env.DB,actor,[assertion(exportPolicyGuard(previous)),
  sql('INSERT INTO bf_explore_export_policy(singleton,revision,csv,xlsx) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,csv=excluded.csv,xlsx=excluded.xlsx',policy.revision,policy.csv,policy.xlsx),
  sql('INSERT INTO bf_explore_export_policy_audit(revision,actor_id,previous_csv,previous_xlsx,csv,xlsx,recorded_at) VALUES(?,?,?,?,?,?,?)',policy.revision,actor.id,previous.csv,previous.xlsx,policy.csv,policy.xlsx,new Date().toISOString())])
 return json(policy)
}

export async function exportPolicyPage(request:Request,original:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path!=='/app/settings/export')return null
 const env=runtimeBindings(original),session=await operatorAuth(env).getSession(request)
 if(!session)return new Response(null,{status:303,headers:{location:'/signin?returnTo='+encodeURIComponent(path),'cache-control':'no-store'}})
 if(request.method!=='GET')return new Response(null,{status:405})
 const actor=await currentAuthority(request,env)
 const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`}
 const document=(main:string,script=false)=>appDocument({title:'Export limits · Bifocal',viewer:session.operator,place:'settings',head:script?'<script type="module" src="/bifocal/export-policy.js"></script>':'',side:'<nav class="sidelist" aria-label="Export settings"><a href="/app/settings">Your settings</a><a href="/app/questions">Explore questions</a></nav>',main})
 if(!actor||actor.role!=='owner')return new Response(document('<h1>Export settings unavailable</h1><p>Only the current installation owner can change interactive export limits.</p>'),{status:403,headers})
 try {
  const policy=await readExportPolicy(env)
  await transact(env.DB,actor,[assertion(exportPolicyGuard(policy))])
  return new Response(document(`<h1>Export limits</h1><p class="lead">Choose the maximum rows in an interactive file download. Changes save when you leave a field.</p><p id="export-policy-status" class="status" role="status" aria-live="polite">Current limits loaded.</p><section class="panel"><form id="export-policy" data-revision="${policy.revision}"><div class="fields"><label>CSV row limit<input name="csv" type="number" min="1" max="${interactiveExportDefaults.csv}" step="1" required value="${policy.csv}" aria-describedby="export-policy-note"></label><label>XLSX row limit<input name="xlsx" type="number" min="1" max="${interactiveExportDefaults.xlsx}" step="1" required value="${policy.xlsx}" aria-describedby="export-policy-note"></label></div><p id="export-policy-note" class="hint">Limits apply to summarized and separately permitted underlying downloads. CSV can contain up to 30,000 rows and XLSX up to 150,000; you can lower either limit. Changing a limit grants no data or download permission.</p><p class="note">A download above its current limit offers named parts for the complete result, without truncation. Source row and byte bounds still apply.</p></form></section>`,true),{headers})
 }catch(error){const code=error instanceof QueryError?error.code:'export_policy_conflict';return new Response(document('<h1>Export settings unavailable</h1><p role="alert">Reload the current export settings.</p>'),{status:code==='owner_required'?403:409,headers})}finally{await discardBody(request)}
}
