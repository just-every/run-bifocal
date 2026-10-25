import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, appPolicy, escapeHtml } from '../../app/shell'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { currentAuthority } from '../catalog/authority.server'
import { policyAudit, policyGuard, readPolicy, type PolicyVersion } from './store.server'

export async function policyDefinitionPage(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),match=/^\/app\/policies\/([a-z][a-z0-9-]{0,63})$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original),session=await operatorAuth(env).getSession(request)
 if(!session)return new Response(null,{status:303,headers:{location:'/signin?returnTo='+encodeURIComponent(url.pathname),'cache-control':'no-store'}})
 if(request.method!=='GET')return new Response(null,{status:405})
 const actor=await currentAuthority(request,env)
 const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}
 const document=(main:string)=>appDocument({title:'Inactive role policy · Bifocal',viewer:session.operator,place:'answers',main})
 if(!actor||actor.role!=='owner')return new Response(document('<h1>Policy access unavailable</h1><p>This definition requires the current installation owner.</p><a href="/app">Back to app</a>'),{status:403,headers})
 try {
  const current=await readPolicy(env,actor,match[1])
  const history=current?(await env.DB.prepare('SELECT revision,document_json,digest,created_at FROM bf_policy_definition_revisions WHERE owner_id=? AND policy_id=? ORDER BY revision DESC LIMIT 101').bind(actor.id,match[1]).all<PolicyVersion>()).results:[]
  const versions=history.slice(0,100),show=(value:unknown)=>escapeHtml(JSON.stringify(value,null,2))
  await transact(env.DB,actor,[assertion(policyGuard(actor,match[1],current?.revision??null)),...versions.map(v=>assertion(sql('EXISTS(SELECT 1 FROM bf_policy_definition_revisions WHERE owner_id=? AND policy_id=? AND revision=? AND digest=?)',actor.id,match[1],v.revision,v.digest))),...(current?[policyAudit(actor,match[1],current.revision,current.digest,'read')]:[])])
  if(!current)return new Response(document('<h1>Policy definition not found</h1><p>No inactive definition is saved with this id.</p>'),{status:404,headers})
  const saved=JSON.parse(current.document_json),before=versions.find(v=>v.revision===current.revision-1)
  const main=`<h1>${escapeHtml(saved.name)}</h1><p class="status" role="status">Inactive definition · revision ${current.revision}</p><p class="lead">This versioned policy records intended access. It grants nobody access and does not send reports or write to sources.</p><p class="note">Applying or restoring this definition never activates an exploration grant. Actual access still requires a separate exact owner review for a named active member. Inactive definitions do not complete BIF-019 roles or activation.</p><section class="panel"><h2>Semantic before and after</h2><h3>Before</h3><pre>${show(before?JSON.parse(before.document_json):null)}</pre><h3>After</h3><pre>${show(saved)}</pre></section><section class="panel"><h2>Version history</h2>${history.length>100?'<p>Showing the latest 100 revisions.</p>':''}${versions.map(v=>`<details><summary>Revision ${v.revision} · ${escapeHtml(v.created_at)}</summary><pre>${show(JSON.parse(v.document_json))}</pre></details>`).join('')}</section>`
  return new Response(document(main),{headers})
 }catch{return new Response(document('<h1>Policy definition unavailable</h1><p>Reload the current policy definition.</p>'),{status:409,headers})}
}
