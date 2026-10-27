// Test scheduling only: real native requests and D1 handle both operations.
import worker from '../../src/server.dev'
let pending,originalAuditEntry,originalAuditHead
const statements=new WeakMap()
export default {
 async fetch(request,env,execution){
  const url=new URL(request.url)
  // Fixture writes share the live D1 owner; a second local Wrangler process
  // can contend with this Worker's SQLite store while its clock is frozen.
  if(url.pathname==='/__entitlement-fixture'&&request.method==='POST'){
   if(!env.RER_DEV_KEY||request.headers.get('x-rer-dev-key')!==env.RER_DEV_KEY)return new Response(null,{status:404})
   const input=await request.json()
   if(input.action==='audit-mutation-guards'){
    const row=await env.DB.prepare('SELECT sequence FROM bf_security_audit ORDER BY sequence LIMIT 1').first()
    let updateRefused=false,deleteRefused=false
    try{await env.DB.prepare('UPDATE bf_security_audit SET event_json=event_json WHERE sequence=?').bind(row.sequence).run()}catch{updateRefused=true}
    try{await env.DB.prepare('DELETE FROM bf_security_audit WHERE sequence=?').bind(row.sequence).run()}catch{deleteRefused=true}
    return Response.json({updateRefused,deleteRefused})
   }
   if(input.action==='audit-invalidate-head'){
    originalAuditHead=await env.DB.prepare('SELECT signature FROM bf_security_audit_head WHERE singleton=1').first()
    await env.DB.prepare('DROP TRIGGER bf_security_audit_head_monotonic').run()
    await env.DB.prepare("UPDATE bf_security_audit_head SET signature='synthetic-bifocal-invalid' WHERE singleton=1").run()
    return Response.json({changed:true})
   }
   if(input.action==='audit-repair-head'){
    await env.DB.prepare('UPDATE bf_security_audit_head SET signature=? WHERE singleton=1').bind(originalAuditHead.signature).run()
    await env.DB.prepare("CREATE TRIGGER bf_security_audit_head_monotonic BEFORE UPDATE ON bf_security_audit_head WHEN NEW.sequence != OLD.sequence+1 BEGIN SELECT RAISE(ABORT,'security_audit_chain_conflict'); END").run()
    originalAuditHead=null
    return Response.json({repaired:true})
   }
   if(input.action==='audit-corrupt'){
    originalAuditEntry=await env.DB.prepare('SELECT sequence,event_json FROM bf_security_audit ORDER BY sequence LIMIT 1').first()
    await env.DB.prepare('DROP TRIGGER bf_security_audit_no_update').run()
    await env.DB.prepare('UPDATE bf_security_audit SET event_json=? WHERE sequence=?').bind(JSON.stringify({...JSON.parse(originalAuditEntry.event_json),outcome:'synthetic-bifocal-altered'}),originalAuditEntry.sequence).run()
    return Response.json({changed:true})
   }
   if(input.action==='audit-repair-fixture'){
    await env.DB.prepare('UPDATE bf_security_audit SET event_json=? WHERE sequence=?').bind(originalAuditEntry.event_json,originalAuditEntry.sequence).run()
    await env.DB.prepare("CREATE TRIGGER bf_security_audit_no_update BEFORE UPDATE ON bf_security_audit BEGIN SELECT RAISE(ABORT,'security_audit_append_only'); END").run()
    originalAuditEntry=null
    return Response.json({repaired:true})
   }
   if(input.action==='clock')return Response.json(await env.DB.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS utc").first())
   if(input.action==='collision-insert'&&typeof input.operatorId==='string'){
    await env.DB.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) SELECT 'synthetic-bifocal-normalization-collision',upper(email),'Synthetic collision','member','active',1,created_at FROM oa_operators WHERE id=?").bind(input.operatorId).run()
    return Response.json({ok:true})
   }
   if(input.action==='collision-remove'){
    await env.DB.prepare("DELETE FROM oa_operators WHERE id='synthetic-bifocal-normalization-collision'").run()
    return Response.json({ok:true})
   }
   return new Response(null,{status:400})
  }
  if(url.pathname==='/__entitlement-boundary'&&request.method==='POST'){
   pending=await request.json();return Response.json({armed:true})
  }
  const wrap=(statement,query)=>{
   const proxy=new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values)=>wrap(target.bind(...values),query)
    const value=target[key];return typeof value==='function'?value.bind(target):value
   }})
   statements.set(proxy,{statement,query});return proxy
  }
  const database=new Proxy(env.DB,{get(target,key){
   if(key==='prepare')return query=>wrap(target.prepare(query),query)
   if(key==='batch')return async queries=>{
    const metadata=queries.map(query=>statements.get(query))
    if(pending&&url.pathname===pending.at&&metadata.some(q=>q?.query.startsWith(pending.before))){
     const mutation=pending;pending=null
     const response=await fetch(url.origin+mutation.path,{method:'POST',headers:{cookie:mutation.cookie,Origin:url.origin,'content-type':'application'+'/json',...mutation.headers},body:JSON.stringify(mutation.body)})
     if(![200,204].includes(response.status))throw Error('Entitlement boundary public mutation refused: '+response.status)
     await response.arrayBuffer()
    }
    return target.batch(metadata.map((value,i)=>value?.statement??queries[i]))
   }
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
  // The network edge supplies the authoritative ingress address in this test.
  if(request.headers.has('x-security-test-ip')){
   const headers=new Headers(request.headers),ip=headers.get('x-security-test-ip')
   headers.delete('x-security-test-ip');headers.delete('CF-Connecting-IP')
   if(ip!=='unknown')headers.set('CF-Connecting-IP',ip)
   request=new Request(request,{headers})
  }
  return worker.fetch(request,{...env,DB:database},execution)
 }
}
