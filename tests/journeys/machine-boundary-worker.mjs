// Test-only scheduler around the emitted Worker and real local D1. It inserts
// an actual authenticated public mutation immediately before a read's final
// response transaction. No application authorization or SQL result is mocked.
import worker from '../../dist/server/index.js'
import { withDevIdentity } from '../../src/modules/operator-auth/dev/index.mjs'
import { createOperatorAuth, createAuthHandler } from '../../src/modules/operator-auth/index.mjs'
// The real local-only native CLI can issue a step-up-fenced native session.
// It is available only in this fixture, with this journey's synthetic secrets.
const local=withDevIdentity(worker,{config:env=>({dependencies:true,origin:env.AUTH_ORIGIN,local:true,OWNER_EMAIL:env.OWNER_EMAIL,SESSION_SECRET:env.SESSION_SECRET,INSTALLATION_KEY:env.INSTALLATION_KEY,SETUP_TOKEN:env.SETUP_TOKEN,MAIL_FROM:env.MAIL_FROM,branding:{productName:'Bifocal'}})})
// The model import journey uses the unchanged native handlers with a mail
// delivery sink. Sessions, invitation consumption and application checks are real.
const mail=[]
let pending
let completed
const statements=new WeakMap()
export default {
 async fetch(request,env,execution){
  const url=new URL(request.url)
  if(url.pathname==='/__model-mail')return Response.json(mail)
  if(request.headers.get('X-Bifocal-Test-Mail')==='synthetic-bifocal-mail'&&['/auth/invite','/auth/confirm'].includes(url.pathname)){
   const auth=createOperatorAuth({db:env.DB,clientIp:()=>'127.0.0.1',config:{dependencies:true,origin:env.AUTH_ORIGIN,local:true,OWNER_EMAIL:env.OWNER_EMAIL,SESSION_SECRET:env.SESSION_SECRET,INSTALLATION_KEY:env.INSTALLATION_KEY,MAIL_FROM:env.MAIL_FROM},mailSender:{async send(message){mail.push(message);return {status:'accepted',provider:'resend',providerMessageId:'synthetic-bifocal-mail'}}}})
   return createAuthHandler(auth)(request)
  }
  if(['/auth/local/cli-session','/auth/dev/enter'].includes(url.pathname))return local.fetch(request,env,execution)
  if(url.pathname==='/__machine-boundary'&&request.method==='POST'){
   pending=await request.json()
   return Response.json({armed:true})
  }
  if(url.pathname==='/__machine-boundary'&&request.method==='GET'){
   const result=completed;completed=undefined
   return Response.json(result??null,{headers:{'cache-control':'no-store'}})
  }
  const wrap=(statement,query,args=[])=>{
   const proxy=new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values)=>wrap(target.bind(...values),query,values)
    const value=target[key];return typeof value==='function'?value.bind(target):value
   }})
   statements.set(proxy,{statement,query,args});return proxy
  }
  const database=new Proxy(env.DB,{get(target,key){
   if(key==='prepare')return query=>wrap(target.prepare(query),query)
   if(key==='batch')return async queries=>{
    const metadata=queries.map(query=>statements.get(query))
    if(pending&&metadata.some(q=>(q?.query.startsWith('INSERT INTO bf_machine_audit(')&&['query','definitions'].includes(q.args[4]))||(q?.query==='INSERT INTO bf_portal_audit VALUES(?,?,?,?,?,?)'&&['read-completed','export-completed'].includes(q.args[3])))){
     const mutation=pending;pending=null
     const headers={cookie:mutation.cookie,Origin:url.origin,'content-type':'application'+'/json'}
     if(mutation.rotate){
      const review=await fetch(new Request(url.origin+mutation.path+'/review',{method:'POST',headers,body:'{}'}))
      if(review.status!==200)throw Error('Boundary rotation review refused: '+review.status)
      const {reviewedAt,reviewedDigest}=await review.json();mutation.body={reviewedAt,reviewedDigest}
     }
     const response=await fetch(new Request(url.origin+mutation.path,{method:'POST',headers,body:JSON.stringify(mutation.body)}))
     if(response.status!==(mutation.rotate?201:200)){console.error('Boundary fixture mutation refused',response.status,await response.text());throw Error('Boundary fixture public mutation refused: '+response.status)}
     completed=await response.json()
    }
    return target.batch(metadata.map((value,i)=>value?.statement??queries[i]))
   }
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
  return worker.fetch(request,{...env,DB:database},execution)
 }
}
