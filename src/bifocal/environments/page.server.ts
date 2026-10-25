import {operatorAuth,runtimeBindings,type Bindings} from '../../auth.server'
import {appDocument,appPolicy,escapeHtml} from '../../app/shell'
import {currentAuthority} from '../catalog/authority.server'
import {assertion,transact} from '../../modules/import-kit/src/door/store.ts'
import {estateGuard,readEstate,readEstateRevision} from './store.server'
import type {EstateDocument} from './protocol'
export async function environmentPage(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/app\/environments\/([a-z][a-z0-9-]{0,63})$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original),session=await operatorAuth(env).getSession(request)
 if(!session)return new Response(null,{status:303,headers:{location:'/signin?returnTo='+encodeURIComponent(url.pathname),'cache-control':'no-store'}})
 if(request.method!=='GET')return new Response(null,{status:405})
 const actor=await currentAuthority(request,env),headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}
 const page=(main:string,status=200)=>new Response(appDocument({title:'Environments · Bifocal',viewer:session.operator,place:'answers',main}),{status,headers})
 if(!actor||actor.role!=='owner')return page('<h1>Environment access unavailable</h1><p>Current installation owner required.</p>',403)
 const state=await readEstate(env,actor,match[1]);if(!state)return page('<h1>Environment not found</h1>',404)
 const rows=[]
 for(const environment of ['development','staging','production'] as const){
  const n=state[environment],revision=n?await readEstateRevision(env,actor,state.id,n):null
  const document=revision?JSON.parse(revision.document_json) as EstateDocument:null,definitions=revision?JSON.parse(revision.definitions_json):[]
  rows.push(`<section class="panel" data-environment="${environment}"><h2>${environment[0].toUpperCase()+environment.slice(1)}</h2><p role="status">${n?'Estate revision '+n:'Unpublished'}</p>${document?`<ul>${document.resources.map(ref=>{
   const href=ref.kind==='chart'?'/app/charts/'+ref.id:ref.kind==='dashboard'||ref.kind==='report'?'/app/'+ref.kind+'s/'+ref.id:ref.kind==='metric'?'/app/metrics/'+ref.id:ref.kind==='policy'?'/app/policies/'+ref.id:ref.kind==='schedule'?'/app/schedules/'+ref.id:'/app/models'
   return `<li><a href="${href}">${escapeHtml(ref.key)}</a> · ${ref.kind}${ref.revision?' · revision '+ref.revision:ref.version?' · version '+ref.version:''}</li>`
  }).join('')}</ul><details><summary>Exact retained definitions</summary><pre>${escapeHtml(JSON.stringify(definitions,null,2))}</pre></details>`:''}</section>`)
 }
 await transact(env.DB,actor,[assertion(estateGuard(actor,state.id,state))])
 const head=JSON.parse((await readEstateRevision(env,actor,state.id,state.head_revision)).document_json) as EstateDocument
 return page(`<h1>${escapeHtml(head.name)}</h1><p class="meta">Generation ${state.generation} · latest draft ${state.head_revision}</p><p>Each environment selects one complete estate revision. Retained charts, dashboards and reports keep their original answers. Definition files grant no data access. Role policies remain inactive; schedule definitions have no dispatcher.</p>${rows.join('')}`)
}
