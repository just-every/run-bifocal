import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, appPolicy, escapeHtml, type Viewer } from '../../app/shell'
import { ConventionsError, identifier } from '../company/protocol'
import { guarded, readVersion, sql, versions, type VersionRow } from '../company/store'
import { fileOwner } from '../imports/files/owner.server'

const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}
type Occurrence={localDate:string;status:string;shiftSeconds:number;instants:{instant:string;offset:string;localDate:string;localTime:string;reportDate:string}[]}
function scheduleContent(row:VersionRow,history:{version:number;name:string;createdAt:string}[]) {
 const saved=JSON.parse(row.value_json),recurring=saved.document?.version===2,definition=recurring?saved.document.definition:saved,binding=recurring?saved.binding:null
 const occurrences:Occurrence[]=recurring?saved.resolution.occurrences:[{localDate:definition.localDate,...saved.resolution}]
 const semantic=recurring?`${definition.recurrence.frequency} · every ${definition.recurrence.interval} · ${definition.startDate} through ${definition.endDate} inclusive`:`One-time · ${definition.localDate}`
 const target=binding?`<dl class="facts-grid"><div><dt>Environment</dt><dd>${escapeHtml(binding.environment)}</dd></div><div><dt>Model</dt><dd>${escapeHtml(binding.modelId)}</dd></div><div><dt>View</dt><dd>${escapeHtml(binding.viewId)}</dd></div><div><dt>Bound revision</dt><dd>${escapeHtml(binding.revision)}</dd></div><div><dt>Review digest</dt><dd>${escapeHtml(binding.digest)}</dd></div></dl>`:''
 return `<h1>${escapeHtml(definition.name)}</h1><p class="meta">Inactive schedule definition · version ${row.version} · ${escapeHtml(row.created_at)}</p><p class="note" role="status">This definition does not activate a subscription or dispatch. No provider sends or source writes occur.</p><section class="panel"><h2>Retained definition</h2><p>${escapeHtml(semantic)}</p><p>${escapeHtml(definition.time)} · ${escapeHtml(definition.timezone)} · report cutoff ${escapeHtml(definition.reportCutoff)}</p><p>Skipped time: ${escapeHtml(definition.skipped)} · repeated time: ${escapeHtml(definition.repeated)}</p>${target}</section><section class="panel tablepanel"><div class="tablewrap" tabindex="0" role="region" aria-label="Resolved schedule occurrences"><table><caption>Resolved civil-time occurrences</caption><thead><tr><th scope="col">Declared date</th><th scope="col">Resolution</th><th scope="col">UTC instant</th><th scope="col">Local time and offset</th><th scope="col">Report date</th></tr></thead><tbody>${occurrences.map(occurrence=>occurrence.instants.length?occurrence.instants.map(instant=>`<tr><th scope="row">${escapeHtml(occurrence.localDate)}</th><td>${escapeHtml(occurrence.status)}${occurrence.shiftSeconds?' · shifted '+occurrence.shiftSeconds+' seconds':''}</td><td>${escapeHtml(instant.instant)}</td><td>${escapeHtml(instant.localDate+' '+instant.localTime+' '+instant.offset)}</td><td>${escapeHtml(instant.reportDate)}</td></tr>`).join(''):`<tr><th scope="row">${escapeHtml(occurrence.localDate)}</th><td>${escapeHtml(occurrence.status)}</td><td colspan="3">No instant</td></tr>`).join('')}</tbody></table></div></section><section class="panel"><h2>Immutable history</h2><ol>${history.map(version=>`<li><a href="/app/schedules/${row.id}?version=${version.version}"${row.version===version.version?' aria-current="page"':''}>Version ${version.version} · ${escapeHtml(version.name)} · ${escapeHtml(version.createdAt)}</a></li>`).join('')}</ol></section><details class="panel"><summary>Exact definition, resolution and local binding</summary><pre>${escapeHtml(JSON.stringify(saved,null,2))}</pre></details>`
}
export async function scheduleDefinitionPage(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),match=/^\/app\/schedules\/([a-z][a-z0-9-]{0,63})$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original),session=await operatorAuth(env).getSession(request)
 if(!session)return new Response(null,{status:303,headers:{location:'/signin?returnTo='+encodeURIComponent(url.pathname),'cache-control':'no-store'}})
 const document=(main:string,status=200)=>new Response(appDocument({title:'Schedule definition · Bifocal',viewer:session.operator as Viewer,place:'answers',head:'<link rel="stylesheet" href="/bifocal/schedules.css">',main}),{status,headers})
 const owner=await fileOwner(request,env)
 if(!owner)return document('<h1>Schedule unavailable</h1><p role="alert">Current installation owner required.</p>',403)
 try {
  if(request.method!=='GET')throw new ConventionsError('method_not_allowed',405)
  if([...url.searchParams.keys()].some(key=>key!=='version')||url.searchParams.getAll('version').length>1)throw new ConventionsError('unsupported_schedule_query',400)
  const id=identifier(match[1]),history=await versions(env,owner,'bf_schedules',id),versionText=url.searchParams.get('version')
  if(versionText!==null&&!/^[1-9][0-9]{0,9}$/.test(versionText))throw new ConventionsError('schedule_version_required',400)
  const version=versionText===null?history[0]?.version:Number(versionText)
  if(!version)throw new ConventionsError('schedule_not_found',404)
  const row=await readVersion(env,owner,'bf_schedules',id,version)
  // Fence the retained version and the complete displayed history together.
  const assertion=sql('INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM bf_schedules WHERE id=? AND version=? AND value_json=?) AND (SELECT count(*) FROM bf_schedules WHERE id=?)=? THEN 1 ELSE 0 END',id,version,row.value_json,id,history.length)
  await guarded(env,owner,[assertion])
  return document(scheduleContent(row,history))
 }catch(error){const code=error instanceof ConventionsError?error.code:'schedule_conflict',status=error instanceof ConventionsError?error.status:409;return document(`<h1>Schedule unavailable</h1><p role="alert">${escapeHtml(code)}</p><p><a href="/app/queries">Return to exact answers</a></p>`,status)}
}
