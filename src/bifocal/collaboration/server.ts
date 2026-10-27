import {randomUUID} from 'node:crypto'
import {runtimeBindings,type Bindings} from '../../auth.server'
import {currentAuthority,type Authority} from '../catalog/authority.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {json,jsonBody,exactKeys,discardBody} from '../models/validation/transport'
import {text} from '../metrics/transport'
import {fail,QueryError} from '../query/types'
import {subject,permittedMembers,subjectChanges} from './subjects.server'
import {prepareLink,readLink,audit} from './links.server'
import {collaborationPage,collaborationUnavailable} from './page.server'
const base='/api/operator/collaboration'
export async function collaborationResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname
 if(!path.startsWith(base+'/')&&!/^\/app\/(collaboration\/|shared\/)/.test(path))return null
 const env=runtimeBindings(original)
 try{
  const actor=await currentAuthority(request,env)
  const unfurl=/^\/api\/operator\/collaboration\/links\/([a-f0-9-]{36})\/unfurl$/.exec(path)
  if(unfurl&&request.method==='GET'){
   if(url.search)fail('query_parameters_not_supported',400)
   try{if(actor){const link=await readLink(env,actor,unfurl[1]);return json({title:link.target.title,href:'/app/shared/'+link.row.id})}}catch{}
   return json({title:'Private Bifocal link'})
  }
  if(!actor)return json({error:'authentication_required'},401)
  if(url.search)fail('query_parameters_not_supported',400)
  if(path.startsWith('/app/'))return await collaborationPage(request,env,actor)
  if(path===base+'/notifications'&&request.method==='GET'){
   const rows=(await env.DB.prepare('SELECT id,link_id,created_at FROM bf_collaboration_notifications WHERE recipient_id=? ORDER BY created_at DESC,id LIMIT 101').bind(actor.id).all<{id:string;link_id:string;created_at:string}>()).results
   if(rows.length>100)fail('notification_history_limit',413)
   const notifications=[]
   for(const row of rows){try{await readLink(env,actor,row.link_id);notifications.push({id:row.id,href:'/app/shared/'+row.link_id,createdAt:row.created_at})}catch{}}
   await transact(env.DB,actor,[]);return json({notifications})
  }
  const linked=/^\/api\/operator\/collaboration\/links\/([a-f0-9-]{36})(\/revoke)?$/.exec(path)
  if(linked){
   if(linked[2]){
    if(request.method!=='POST')fail('method_not_allowed',405)
    exactKeys(await jsonBody(request),[])
    const row=await env.DB.prepare('SELECT issuer_id FROM bf_collaboration_links WHERE id=?').bind(linked[1]).first<{issuer_id:string}>()
    if(row?.issuer_id!==actor.id)fail('link_access_unavailable',403)
    await transact(env.DB,actor,[sql('UPDATE bf_collaboration_links SET revoked=1 WHERE id=? AND issuer_id=?',linked[1],actor.id),audit(actor,'authenticated-link-revoked',linked[1])]);return json({revoked:true})
   }
   if(request.method!=='GET')fail('method_not_allowed',405)
   const link=await readLink(env,actor,linked[1]);return json({id:link.row.id,title:link.target.title,href:'/app/shared/'+link.row.id,expiresAt:link.row.expires_at})
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request)
  if(path===base+'/annotations'){
   exactKeys(input,['metricId','revision','body','point'])
   if(actor.role!=='owner')fail('owner_required',403)
   const target=await subject(env,actor,'metric',input.metricId),ref=target.metricRef!
   if(input.revision!==ref.revision)fail('certified_metric_changed',409)
   if(typeof input.point!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.point)||!Number.isFinite(Date.parse(input.point))||new Date(input.point).toISOString().slice(0,10)!==input.point)fail('annotation_date_required',400)
   const id=randomUUID(),body=text(input.body,2000)
   await transact(env.DB,actor,[...subjectChanges(target),sql('INSERT INTO bf_collaboration_annotations(id,metric_id,revision,digest,point,body,author_id,created_at) VALUES(?,?,?,?,?,?,?,?)',id,ref.id,ref.revision,ref.digest,input.point,body,actor.id,new Date().toISOString()),audit(actor,'metric-point-annotated',id)]);return json({id},201)
  }
  exactKeys(input,path===base+'/resolve'?['kind','id']:path===base+'/comments'?['kind','id','body','point','mentions']:path===base+'/links'?['kind','id','recipientId','expiresAt','public']:[])
  const target=await subject(env,actor,input.kind,input.id)
  if(path===base+'/resolve')return json(await resolve(env,actor,target))
  if(path===base+'/comments'){
   const body=text(input.body,2000),point=input.point??null
   if(point!==null&&(!Number.isSafeInteger(point)||Number(point)<0||target.snapshots.length!==1||Number(point)>=target.snapshots[0].answer.rows.length))fail('comment_point_not_found',400)
   if(!Array.isArray(input.mentions)||input.mentions.length>10||new Set(input.mentions).size!==input.mentions.length||!input.mentions.every(id=>typeof id==='string'))fail('mention_recipients_required',400)
   const people=await permittedMembers(env,actor,target)
   if(input.mentions.some(id=>!people.some(person=>person.id===id)))fail('collaboration_recipient_not_permitted',403)
   const id=randomUUID(),now=new Date().toISOString(),changes=[...subjectChanges(target),sql('INSERT INTO bf_collaboration_comments(id,subject_key,author_id,body,point,created_at) VALUES(?,?,?,?,?,?)',id,target.key,actor.id,body,point,now)]
   for(const recipientId of input.mentions){const link=await prepareLink(env,actor,target,recipientId,new Date(Date.now()+86400000).toISOString());changes.push(...link.changes,sql('INSERT INTO bf_collaboration_notifications(id,comment_id,link_id,recipient_id,created_at) VALUES(?,?,?,?,?)',randomUUID(),id,link.id,recipientId,now))}
   await transact(env.DB,actor,[...changes,audit(actor,'comment-posted',id)]);return json({id},201)
  }
  if(path===base+'/links'){
   if(input.public!==false)fail('public_publication_not_approved',403)
   const link=await prepareLink(env,actor,target,input.recipientId,input.expiresAt)
   await transact(env.DB,actor,link.changes);return json({id:link.id,href:link.href,expiresAt:link.expiresAt},201)
  }
  fail('not_found',404)
 }catch(error){if(path.startsWith('/app/'))return await collaborationUnavailable(request,env,error instanceof QueryError?error.status:409);if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'collaboration_changed',reason:'Reload current access and the retained subject.'},409)}finally{await discardBody(request)}
}
export async function resolve(env:Bindings,actor:Authority,target:Awaited<ReturnType<typeof subject>>){
 const members=await permittedMembers(env,actor,target)
 const comments=(await env.DB.prepare('SELECT id,author_id AS authorId,body,point,created_at AS createdAt FROM bf_collaboration_comments WHERE subject_key=? ORDER BY created_at,id LIMIT 101').bind(target.key).all()).results
 for(const comment of comments){const recipients=(await env.DB.prepare('SELECT DISTINCT recipient_id FROM bf_collaboration_notifications WHERE comment_id=?').bind(comment.id).all<{recipient_id:string}>()).results;comment.mentions=recipients.filter(row=>members.some(person=>person.id===row.recipient_id)).map(row=>row.recipient_id)}
 const links=(await env.DB.prepare('SELECT id,recipient_id AS recipientId,expires_at AS expiresAt,revoked FROM bf_collaboration_links WHERE subject_key=? AND issuer_id=? ORDER BY created_at DESC,id LIMIT 101').bind(target.key,actor.id).all()).results
 if(comments.length>100||links.length>100)fail('collaboration_history_limit',413)
 const ref=target.metricRef,annotations=ref?(await env.DB.prepare('SELECT id,point,body,revision,created_at AS createdAt FROM bf_collaboration_annotations WHERE metric_id=? AND revision=? AND digest=? ORDER BY point,id LIMIT 101').bind(ref.id,ref.revision,ref.digest).all()).results:[]
 if(annotations.length>100)fail('annotation_history_limit',413)
 await transact(env.DB,actor,subjectChanges(target))
 return {subject:{kind:target.kind,id:target.id,title:target.title,href:target.href},members:members.map(({id,displayName})=>({id,displayName})),comments,annotations,links,metric:ref}
}
