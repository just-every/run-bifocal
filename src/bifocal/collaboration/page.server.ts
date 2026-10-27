import {operatorAuth,type Bindings} from '../../auth.server'
import {appDocument,appPolicy,escapeHtml} from '../../app/shell'
import type {Authority} from '../catalog/authority.server'
import {transact} from '../../modules/import-kit/src/door/store.ts'
import {subject} from './subjects.server'
import {readLink} from './links.server'
import {fail} from '../query/types'
import {displayZone} from '../company/display-zone'
// The discussion's forms use the owner forms' rhythm (see ../metrics/forms): each label over its field with room
// between fields, hints beneath, one filled action. collaboration.js writes a refused submit's plain sentence at the
// field it concerns (or at the top of its form) and keeps what the person typed.
const box=(id:string,label:string,field:string,hint='')=>`<div class="control"><label for="${id}">${label}</label>${field}${hint?`<p class="hint" id="${id}-hint">${hint}</p>`:''}</div>`
const formActions=(label:string,primary=true)=>`<div class="actions"><button type="submit"${primary?' class="primary"':''}>${label}</button></div>`
function subjectSections(points:boolean){
 const comment=box('comment-body','Comment','<textarea id="comment-body" name="body" rows="3" maxlength="2000" required></textarea>')
  +(points?box('comment-point','Data point','<input id="comment-point" name="point" type="number" step="1" inputmode="numeric" aria-describedby="comment-point-hint">','Optional. The row of this answer the comment is about.'):'')
  +box('comment-mention','Mention a permitted member','<select id="comment-mention" name="mention"></select>')+formActions('Post comment')
 const annotation=box('annotation-point','Annotation date','<input id="annotation-point" name="point" type="date" required>')
  +box('annotation-body','Annotation','<textarea id="annotation-body" name="body" rows="3" maxlength="2000" required></textarea>')+formActions('Annotate metric version')
 const share=box('link-recipient','Link recipient','<select id="link-recipient" name="recipientId" required></select>')
  +box('link-minutes','Expires in minutes','<input id="link-minutes" name="minutes" type="number" step="1" inputmode="numeric" value="60" required aria-describedby="link-minutes-hint">','Up to 10,080 minutes (one week).')+formActions('Create authenticated link',false)
 return `<section id="collaboration-content" hidden><h2 id="collaboration-title" class="subject-title"></h2><p class="meta"><a id="collaboration-source">Open original</a></p>`
  +`<section class="panel" aria-labelledby="comments-title"><h2 id="comments-title">Comments</h2><ul id="collaboration-comments" class="thread" hidden></ul><p id="collaboration-comments-empty" class="muted" hidden>No comments yet.</p><form id="collaboration-comment" class="thread-form">${comment}</form></section>`
  +`<section id="collaboration-annotations-panel" class="panel" aria-labelledby="annotations-title" hidden><h2 id="annotations-title">Certified metric annotations</h2><p id="collaboration-metric-version" class="meta"></p><ul id="collaboration-annotations" class="thread" hidden></ul><p id="collaboration-annotations-empty" class="muted" hidden>No annotations on this revision yet.</p><form id="collaboration-annotation" class="thread-form">${annotation}</form></section>`
  +`<details class="panel"><summary>Authenticated links</summary><p class="hint">Only people who can currently open this exact analysis can take part. A link opens only for its named recipient, after their own sign-in, and grants no new access. Downloads keep their own permissions.</p><form id="collaboration-link">${share}</form><ul id="collaboration-links" class="records" hidden></ul></details></section>`
}
export const collaborationLink=(kind:string,id:string)=>`<p><a href="/app/collaboration/${kind}/${escapeHtml(id)}">Comments and sharing</a></p>`
export async function collaborationPage(request:Request,env:Bindings,actor:Authority){
 if(request.method!=='GET')fail('method_not_allowed',405)
 const path=new URL(request.url).pathname,match=/^\/app\/collaboration\/(answer|dashboard|chart|authored-dashboard|metric)\/([a-z0-9-]+)$/.exec(path),shared=/^\/app\/shared\/([a-f0-9-]{36})$/.exec(path),notifications=path==='/app/collaboration/notifications'
 const link=shared?await readLink(env,actor,shared[1]):null,target=link?.target??(match?await subject(env,actor,match[1],match[2]):null)
 if(!target&&!notifications)fail('not_found',404)
 const viewer=(await operatorAuth(env).getSession(request))!.operator
 await transact(env.DB,actor,[])
 const rows=target?.snapshots.length===1?target.snapshots[0].answer.rows.length:null
 const main=`<h1>${notifications?'Your mentions':'Comments and sharing'}</h1><p id="collaboration-status" class="status" role="status" aria-live="polite">Loading current access…</p>${target?subjectSections(rows!==null):''}<section class="panel" aria-label="Your mentions">${notifications?'':'<h2>Your mentions</h2>'}<ul id="collaboration-notifications" class="records" hidden></ul><p id="collaboration-notifications-empty" class="muted" hidden>No current mentions.</p></section>`
 // The bar lights the subject's own tool: a metric's thread sits under Metrics, a saved dashboard's under Library.
 return new Response(appDocument({title:(notifications?'Your mentions':'Comments and sharing')+' · Bifocal',viewer,place:target?.kind==='metric'?'metrics':target?.kind==='dashboard'?'library':'answers',head:'<script type="module" src="/bifocal/collaboration.js"></script>',body:` data-collaboration-kind="${target?.kind??''}" data-collaboration-id="${target?.id??''}" data-collaboration-rows="${rows??''}" data-shared-link="${link?.row.id??''}" data-zone="${escapeHtml(await displayZone(env,viewer.email))}"`,main}),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}})
}

export async function collaborationUnavailable(request:Request,env:Bindings,status:number){
 const viewer=(await operatorAuth(env).getSession(request))?.operator??null
 return new Response(appDocument({title:'Collaboration access unavailable · Bifocal',viewer,place:'answers',main:'<h1>Collaboration access unavailable</h1><p>This discussion or link is unavailable under your current access. Ask its owner for a current permitted link.</p><p><a href="/app/collaboration/notifications">View current mentions</a></p><p><a href="/app">Back to app home</a></p>'}),{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}})
}
