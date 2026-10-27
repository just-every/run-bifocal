import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { accountSide, appDocument, appPolicy } from '../../app/shell'
import { transact } from '../../modules/import-kit/src/door/store.ts'
import { currentAuthority } from '../catalog/authority.server'

export async function classificationPage(request:Request,original:Bindings):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/app/settings/approvals')return null
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}
 if(request.headers.has('Authorization'))return new Response('A human owner session is required.',{status:403,headers})
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}})
 const env=runtimeBindings(original),actor=await currentAuthority(request,env)
 if(!actor)return new Response(null,{status:303,headers:{...headers,location:'/signin?returnTo=%2Fapp%2Fsettings%2Fapprovals'}})
 if(actor.role!=='owner')return new Response('Only the owner can manage approval classifications.',{status:403,headers})
 const session=await operatorAuth(env).getSession(request)
 if(!session)return new Response(null,{status:401,headers})
 const document=appDocument({title:'Approval classifications · Bifocal',viewer:session.operator,place:'settings',side:accountSide(actor.role,'settings'),head:'<script type="module" src="/bifocal/approval-classifications.js"></script>',main:`<div class="pagehead"><div><h1>Approval classifications</h1><p class="lead">Record which active people belong to leadership or the board.</p></div></div>
<p class="note">A classification describes a person for publication review. It grants no data access or approval authority. Only the owner can approve publication. Leadership and board classifications expire within seven days and must be reviewed again after membership changes.</p>
<p class="status" id="classification-status" role="status" aria-live="polite">Loading active people…</p>
<section class="panel"><h2>Active people</h2><div id="classification-people"></div></section>
<details class="panel"><summary>Classification audit history</summary><div id="classification-history"></div></details>
<section class="panel"><h2>Review a classification</h2><form id="classification-form"><div class="fields">
<label>Person<select id="classification-person" name="operatorId" required disabled></select></label>
<label>Classification<select id="classification-kind" name="kind" required><option value="none">None</option><option value="leadership">Leadership</option><option value="board">Board</option></select></label>
<label>Expires at in device local time<input id="classification-expiry" name="expiresAt" type="datetime-local" step="1" disabled></label>
</div><p id="classification-review">Choose a person to inspect their current classification.</p><button type="submit" id="classification-save" class="primary" disabled>Save reviewed classification</button></form></section>`})
 try {await transact(env.DB,actor,[])}catch{return new Response('Your account access changed. Sign in again.',{status:401,headers})}
 return new Response(request.method==='HEAD'?null:document,{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':`default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}})
}
