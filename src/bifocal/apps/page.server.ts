import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { appDocument, escapeHtml } from '../../app/shell'
import { appPolicy } from '../../app/shell'
import { currentAuthority, type Authority } from '../catalog/authority.server'
import { QueryError } from '../query/types'
import { appDetail, appList } from './owner.server'
import { appView, homeEntries, pageView, subscriptions } from './reader.server'

const h=(value:unknown)=>escapeHtml(String(value??''))
const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`}
const starter=JSON.stringify({version:1,title:'Regional reporting',pages:[{key:'overview',title:'Overview',kind:'dashboard',ref:'00000000-0000-4000-8000-000000000000'}],audiences:[{key:'sales',name:'Sales',landing:'overview',pages:['overview'],rows:[{column:'region',op:'eq',value:'West'}],columns:null}]},null,2)
const list=(items:string[],empty:string)=>items.length?`<ul class="library-list">${items.join('')}</ul>`:`<p class="meta">${empty}</p>`
type Content={kind:string;id:string;title:string}
/** Owner-visible content that an app page can reference, newest first and bounded. */
async function available(env:Bindings,owner:Authority):Promise<Content[]> {
 const found:Content[]=[]
 const authored=(await env.DB.prepare('SELECT d.id,r.document_json FROM bf_dashboard_definitions d JOIN bf_dashboard_definition_revisions r ON r.dashboard_id=d.id AND r.revision=d.published_revision WHERE d.owner_id=? LIMIT 25').bind(owner.id).all<{id:string;document_json:string}>()).results
 for(const row of authored)found.push({kind:'dashboard',id:row.id,title:(JSON.parse(row.document_json) as {title:string}).title})
 for(const row of (await env.DB.prepare('SELECT id,kind,title FROM bf_analytics_boards WHERE owner_id=? ORDER BY created_at DESC LIMIT 25').bind(owner.id).all<{id:string;kind:string;title:string}>()).results)found.push(row)
 for(const row of (await env.DB.prepare('SELECT id,kind,title FROM bf_query_artifacts WHERE owner_id=? AND kind IN (\'dashboard\',\'report\') ORDER BY created_at DESC LIMIT 25').bind(owner.id).all<{id:string;kind:string;title:string}>()).results)found.push(row)
 for(const row of (await env.DB.prepare('SELECT id FROM bf_query_snapshots WHERE owner_id=? ORDER BY created_at DESC LIMIT 25').bind(owner.id).all<{id:string}>()).results)found.push({kind:'question',id:row.id,title:'Retained answer'})
 for(const row of (await env.DB.prepare('SELECT g.id,v.document_json FROM bf_goals g JOIN bf_goal_versions v ON v.goal_id=g.id AND v.version=g.version WHERE g.owner_id=? LIMIT 25').bind(owner.id).all<{id:string;document_json:string}>()).results)found.push({kind:'scorecard',id:row.id,title:(JSON.parse(row.document_json) as {title:string}).title})
 return found
}
const cell=(value:{state:string;value:string|null}|undefined)=>value?.state==='value'?h(value.value):`<span class="meta">${h(value?.state==='null'?'No value':value?.state)}</span>`
function cards(content:Awaited<ReturnType<typeof pageView>>):string {
 return content.cards.map(card=>{
  const head=card.columns.map(c=>`<th scope="col"${c.kind==='measure'?' class="num"':''}>${h(c.name)}${c.kind==='measure'?` <span class="meta">${h(c.unit)}</span>`:''}</th>`).join('')
  const rows=card.rows.map(row=>`<tr>${row.dimensions.map(d=>`<td>${h(d??'NULL')}</td>`).join('')}${card.columns.filter(c=>c.kind==='measure').map(c=>`<td class="num">${cell(row.values[c.name])}</td>`).join('')}</tr>`).join('')
  const dims=card.columns.filter(c=>c.kind==='dimension').length,totals=`<tr class="totals"><th scope="row"${dims>1?` colspan="${dims}"`:''}>Total</th>${card.columns.filter(c=>c.kind==='measure').map(c=>`<td class="num">${cell(card.totals[c.name])}</td>`).join('')}</tr>`
  return `<section class="panel tablepanel app-card" data-card="${h(card.label)}"><h2 class="app-card-title">${h(card.label)}</h2><div class="tablewrap" tabindex="0" aria-label="${h(card.label)} results, scroll horizontally"><table><thead><tr>${head}</tr></thead><tbody>${rows}${totals}</tbody></table></div><p class="meta app-sources">${card.filteredRows} ${card.filteredRows===1?'row':'rows'} in scope · ${card.sources.map(s=>h(s.dataset)+' updated '+h(s.updatedAt)).join(', ')}</p></section>`
 }).join('')+(content.target?`<section class="panel app-target"><h2>Target</h2><p>${h(content.target.title)}: ${h(content.target.amount)} USD from ${h(content.target.from)} to ${h(content.target.to)} (exclusive). Actual is the certified metric over that period.</p></section>`:'')
}
function document(title:string,viewer:{displayName:string;role:string},main:string,side='',status=200) {
 return new Response(appDocument({title:title+' · Bifocal',viewer,place:'apps',side,main,head:'<link rel="stylesheet" href="/bifocal/apps.css"><script type="module" src="/bifocal/apps.js"></script>'}),{status,headers})
}
const unavailable=(viewer:{displayName:string;role:string})=>document('App unavailable',viewer,'<h1>App unavailable</h1><p class="lead">This app is not available to your account.</p><p><a href="/app/apps">Back to apps</a></p>',undefined,404)
function ownerList(apps:Awaited<ReturnType<typeof appList>>,content:Content[]) {
 return `<div class="pagehead"><div><h1>Reporting apps</h1><p class="lead">Package reviewed dashboards, reports, questions and scorecards for named audiences, publish them as one version and roll back safely.</p></div></div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<section class="panel"><h2>Your apps</h2>${list(apps.map(app=>`<li class="library-row"><div><a class="library-name" href="/app/apps/${h(app.id)}">${h(app.title)}</a><p class="meta">${app.publishedVersion?'Published version '+app.publishedVersion:'Unpublished draft'} · draft revision ${app.draftRevision}</p></div></li>`),'No apps yet. Create a draft below or import a Power BI app.')}</section>
<section class="panel"><h2>New app</h2><form id="app-create"><label>App definition (JSON)<textarea name="document" rows="12" spellcheck="false">${h(starter)}</textarea></label><p class="hint">Replace the placeholder content reference with a content ID listed below. Row rules and visible columns are applied to every query an audience reads.</p><div class="actions"><button class="primary" type="submit">Create draft</button></div></form></section>
<details class="panel"><summary>Content you can package</summary>${list(content.map(item=>`<li class="library-row"><div><span class="library-name">${h(item.title)}</span><p class="meta">${h(item.kind)} · <code>${h(item.id)}</code></p></div></li>`),'No retained dashboards, reports, answers or goals yet.')}</details>
<section class="panel"><h2>Import a Power BI app</h2><p class="hint">Upload an app export with its audiences. Members and content are mapped for review; nothing is activated and no credentials are imported.</p><form id="app-import"><div class="fields"><label>Import ID<input name="project" value="power-bi-app" pattern="[a-z][a-z0-9-]{0,63}" required></label><label>Power BI app export (JSON)<input name="file" type="file" accept="application/json,.json" required></label></div><div class="actions"><button class="primary" type="submit">Review import</button></div></form><div id="app-import-review" hidden></div></section>`
}
function ownerDetail(detail:Awaited<ReturnType<typeof appDetail>>,people:{id:string;email:string;display_name:string;version:number}[]) {
 const doc=detail.draft.document,id=detail.id
 const audience=(a:typeof doc.audiences[number])=>`<section class="panel app-audience" data-audience="${h(a.key)}"><h3>${h(a.name)}</h3><p class="meta">${a.pages.length} ${a.pages.length===1?'page':'pages'} · landing ${h(a.landing)} · ${a.rows.length?'rows limited by '+a.rows.map(r=>h(r.column+' '+r.op+' '+JSON.stringify(r.value))).join(' and '):'all rows'}${a.columns?' · columns '+a.columns.map(h).join(', '):''}</p>
${list(detail.members.filter(m=>m.audience===a.key).map(m=>`<li class="library-row"><div><span class="library-name">${h(m.displayName)}</span><p class="meta">${h(m.email)}${m.active?'':' · membership changed, access ended'}</p></div><button type="button" data-remove="${h(m.operatorId)}" data-audience="${h(a.key)}" data-version="${m.operatorVersion}">Remove ${h(m.displayName)} from ${h(a.name)}</button></li>`),'No readers yet.')}
<form class="app-member-form" data-audience="${h(a.key)}"><label>Add reader<select name="person" required><option value="">Choose an active member</option>${people.map(p=>`<option value="${h(p.id)}" data-version="${p.version}">${h(p.display_name)} (${h(p.email)})</option>`).join('')}</select></label><div class="actions"><button type="submit">Add reader to ${h(a.name)}</button></div></form></section>`
 return `<a href="/app/apps">Back to apps</a><div class="pagehead"><div><h1>${h(doc.title)}</h1><p class="lead">${detail.publishedVersion?'Published version '+detail.publishedVersion:'Not published'} · draft revision ${detail.draft.revision}</p></div></div>
<p id="status" class="status" role="status" aria-live="polite"></p><div id="app-owner" data-app="${h(id)}" data-draft-revision="${detail.draft.revision}" data-published="${detail.publishedVersion??''}">
<section class="panel"><h2>Draft definition</h2><p class="hint">Editing the draft never changes what readers see. Publication freezes the content into a new version.</p><form id="app-draft"><label>App definition (JSON)<textarea name="document" rows="14" spellcheck="false">${h(JSON.stringify(doc,null,2))}</textarea></label><div class="actions"><button class="primary" type="submit">Save draft</button></div></form></section>
<section class="panel"><h2>Audiences and readers</h2>${doc.audiences.map(audience).join('')}</section>
<section class="panel"><h2>Publish</h2><p class="hint">Review runs every audience page under its row and column rules before anything changes.</p><div class="actions"><button id="app-review" type="button">Review publication</button></div><div id="app-review-result" hidden></div></section>
<section class="panel"><h2>Version history</h2>${list(detail.versions.map(v=>`<li class="library-row"><div><span class="library-name">Version ${v.version}${v.version===detail.publishedVersion?' · current':''}</span><p class="meta">${h(v.action)}${v.restores?' of version '+v.restores:''} · ${h(v.audiences.join(', '))} · ${v.pages} ${v.pages===1?'page':'pages'} · ${h(v.createdAt)}</p></div>${v.version===detail.publishedVersion?'':`<button type="button" data-restore="${v.version}">Review restore of version ${v.version}</button>`}</li>`),'Nothing is published yet.')}<div id="app-restore-result" hidden></div></section>
<details class="panel"><summary>Subscriptions</summary>${list(detail.subscriptions.map(s=>`<li class="library-row"><div><span class="library-name">${h((s as {email:string}).email)} · ${h((s as {pageKey:string}).pageKey)}</span><p class="meta">${h((s as {audience:string}).audience)} · ${(s as {endedAt:string|null}).endedAt?'ended ('+h((s as {endedReason:string}).endedReason)+')':'active, delivery inactive'}</p></div></li>`),'No subscriptions.')}</details>
<details class="panel"><summary>Audit history</summary>${list(detail.history.map(e=>`<li class="library-row"><div><span class="library-name">${h((e as {action:string}).action)}</span><p class="meta">${h((e as {subject:string|null}).subject??'')} ${h((e as {recordedAt:string}).recordedAt)}</p></div></li>`),'No history.')}</details></div>`
}
function memberHome(apps:Awaited<ReturnType<typeof homeEntries>>) {
 return `<div class="pagehead"><div><h1>Reporting apps</h1><p class="lead">Apps published to you.</p></div></div>${list(apps.map(app=>`<li class="library-row"><div><a class="library-name" href="${h(app.href)}">${h(app.title)}</a><p class="meta">${app.audiences.map(a=>h(a.name)).join(', ')} · version ${app.version}</p></div></li>`),'No apps have been published to you.')}`
}
export async function appPage(request:Request,original:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname,match=/^\/app\/apps(?:\/([a-f0-9-]{36})(?:\/([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]{0,63}))?)?$/.exec(path)
 if(!match)return null
 const env=runtimeBindings(original),session=await operatorAuth(env).getSession(request)
 if(!session)return new Response(null,{status:303,headers:{location:'/signin?returnTo='+encodeURIComponent(path),'cache-control':'no-store'}})
 if(request.method!=='GET')return new Response(null,{status:405})
 const viewer=session.operator,actor=await currentAuthority(request,env)
 if(!actor)return unavailable(viewer)
 try {
  if(!match[1]) return actor.role==='owner'?document('Reporting apps',viewer,ownerList(await appList(env,actor),await available(env,actor))):document('Reporting apps',viewer,memberHome(await homeEntries(env,actor)))
  if(actor.role==='owner'){
   if(match[2])return unavailable(viewer)
   const people=(await env.DB.prepare("SELECT id,email,display_name,version FROM oa_operators WHERE status='active' AND role<>'owner' ORDER BY email LIMIT 200").all<{id:string;email:string;display_name:string;version:number}>()).results
   return document('Reporting app',viewer,ownerDetail(await appDetail(env,actor,match[1]),people))
  }
  const view=await appView(env,actor,match[1])
  const side=`<nav class="sidelist" aria-label="App pages"><a href="/app/apps/${h(view.id)}"${match[2]?'':' aria-current="page"'}>${h(view.title)}</a>${view.audiences.map(a=>`<p class="side-heading">${h(a.name)}</p>${a.pages.map(p=>`<a href="${h(p.href)}"${match[2]===a.key&&match[3]===p.key?' aria-current="page"':''}>${h(p.title)}<span class="meta">${h(p.kind)}</span></a>`).join('')}`).join('')}</nav>`
  if(!match[2])return document(view.title,viewer,`<div class="pagehead"><div><h1>${h(view.title)}</h1><p class="lead">Version ${view.version}</p></div></div>${view.audiences.map(a=>`<section class="panel"><h2>${h(a.name)}</h2>${list(a.pages.map(p=>`<li class="library-row"><div><a class="library-name" href="${h(p.href)}">${h(p.title)}</a><p class="meta">${h(p.kind)}${p.href===a.landing?' · landing':''}</p></div></li>`),'')}</section>`).join('')}`,side)
  const content=await pageView(env,actor,match[1],match[2],match[3]),subs=(await subscriptions(env,actor,match[1])).subscriptions.find(s=>s.audience===match[2]&&s.pageKey===match[3])
  return document(content.page.title,viewer,`<div class="pagehead"><div><h1>${h(content.page.title)}</h1><p class="lead">${h(content.audience.name)} · ${h(content.page.kind)} · version ${content.app.version}</p></div></div><p id="status" class="status" role="status" aria-live="polite"></p>${cards(content)}
<section class="panel" id="app-subscription" data-app="${h(match[1])}" data-audience="${h(match[2])}" data-page="${h(match[3])}" data-subscription="${h(subs?.id??'')}"><h2>Delivery</h2><p class="hint">${subs?'You are subscribed to this page.':'Subscribe to receive this page on a schedule.'} Delivery stays inactive until a dispatcher is available; previews use your current access.</p><div class="actions">${subs?'<button id="app-unsubscribe" type="button">Unsubscribe from this page</button><button id="app-preview" type="button">Preview next delivery</button>':'<button id="app-subscribe" type="button" class="primary">Subscribe to this page</button>'}</div><div id="app-preview-result" hidden></div></section>`,side)
 }catch(error){
  if(error instanceof QueryError&&[403,404,409].includes(error.status))return unavailable(viewer)
  throw error
 }
}
