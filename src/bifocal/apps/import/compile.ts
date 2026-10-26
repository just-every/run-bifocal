import { exactKeys } from '../../models/validation/transport'
import { fail, type Filter } from '../../query/types'
import { key as keyOf } from '../protocol'

/** The documented Bifocal migration envelope (docs/REPORTING-APPS.md) retains source app metadata and explicitly supplied audience definitions. */
export type Person={id:string;email:string;version:number}
export type ImportedMember={identifier:string;principalType:'User'|'Group'|'App';candidate:{operatorId:string;operatorVersion:number;email:string}|null;issue:string|null}
export type ImportedAudience={key:string;name:string;contentIds:string[];landingId:string;rowRole:{name:string;filters:Filter[];sourceRules:{table:string;column:string}[];issues:string[]}|null;members:ImportedMember[]}
export type AppImport={ownerId:string;id:string;format:'power-bi-app';source:{appId:string;name:string;description:string};content:{id:string;type:'report'|'dashboard';name:string}[];audiences:ImportedAudience[];issues:string[];active:false}
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))fail('power_bi_app_invalid',400);return value as Record<string,unknown>}
const text=(value:unknown,max=160):string=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))fail('power_bi_app_invalid',400);return value.trim()}
const array=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max)fail('power_bi_app_invalid',400);return value}
const slug=(name:string,position:number)=>{const candidate=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);return /^[a-z]/.test(candidate)?candidate:'audience-'+(position+1)}
/** Simple equality row-role rules translate; any other DAX stays an explicit unresolved issue. */
function rowRole(roles:Map<string,unknown[]>,name:string) {
 const issues:string[]=[],filters:Filter[]=[],sourceRules:{table:string;column:string}[]=[]
 for(const raw of roles.get(name)!) {
  const rule=object(raw);exactKeys(rule,['table','column','operator','value'])
  if(rule.operator!=='='||typeof rule.value!=='string'||!rule.value||typeof rule.column!=='string'||!rule.column){issues.push('row_role_rule_not_translated:'+String(rule.column))}
  else {filters.push({column:rule.column,op:'eq',value:rule.value});sourceRules.push({table:text(rule.table),column:text(rule.column)})}
 }
 return {name,filters,sourceRules,issues}
}
export function compileAppImport(value:unknown,id:string,ownerId:string,people:Person[]):AppImport {
 const input=object(value);exactKeys(input,['format','version','app','content','audiences','rowRoles'])
 if(input.format!=='power-bi-app'||input.version!==1)fail('power_bi_app_invalid',400)
 const app=object(input.app);exactKeys(app,['id','name','description'])
 const content=array(input.content,24).map(raw=>{const item=object(raw);exactKeys(item,['id','type','name']);if(!['report','dashboard'].includes(String(item.type)))fail('power_bi_app_invalid',400);return {id:text(item.id,64),type:item.type as 'report'|'dashboard',name:text(item.name)}})
 if(new Set(content.map(c=>c.id)).size!==content.length)fail('power_bi_app_invalid',400)
 const roles=new Map<string,unknown[]>()
 for(const raw of array(input.rowRoles,8)){const role=object(raw);exactKeys(role,['name','rules']);const name=text(role.name);if(roles.has(name))fail('power_bi_app_invalid',400);roles.set(name,array(role.rules,8))}
 const issues:string[]=[],byEmail=new Map(people.map(p=>[p.email.toLowerCase(),p]))
 const audiences=array(input.audiences,8).map((raw,position):ImportedAudience=>{
  const audience=object(raw);exactKeys(audience,['name','members','content','landing','rowRole'])
  const name=text(audience.name),contentIds=array(audience.content,24).map(v=>text(v,64))
  if(!contentIds.length||!contentIds.every(c=>content.some(item=>item.id===c))||new Set(contentIds).size!==contentIds.length)fail('power_bi_app_invalid',400)
  const landingId=audience.landing===undefined?contentIds[0]:text(audience.landing,64)
  if(!contentIds.includes(landingId))fail('power_bi_app_invalid',400)
  const role=audience.rowRole===undefined?null:text(audience.rowRole)
  if(role!==null&&!roles.has(role))fail('power_bi_app_invalid',400)
  const members=array(audience.members,50).map((rawMember):ImportedMember=>{
   const member=object(rawMember);exactKeys(member,['identifier','principalType'])
   const identifier=text(member.identifier,254),principalType=member.principalType as ImportedMember['principalType']
   if(!['User','Group','App'].includes(principalType))fail('power_bi_app_invalid',400)
   const person=principalType==='User'?byEmail.get(identifier.toLowerCase()):undefined
   return {identifier,principalType,candidate:person?{operatorId:person.id,operatorVersion:person.version,email:person.email}:null,issue:principalType!=='User'?'principal_not_resolved':person?null:'no_active_member'}
  })
  const mapped=role===null?null:rowRole(roles,role)
  const key=slug(name,position);keyOf(key)
  return {key,name,contentIds,landingId,rowRole:mapped,members}
 })
 if(!audiences.length||new Set(audiences.map(a=>a.key)).size!==audiences.length)fail('power_bi_app_invalid',400)
 for(const a of audiences){for(const m of a.members)if(m.issue)issues.push(m.issue+':'+a.key+':'+m.identifier);for(const issue of a.rowRole?.issues??[])issues.push(issue+':'+a.key)}
 return {ownerId,id,format:'power-bi-app',source:{appId:text(app.id,64),name:text(app.name),description:app.description===undefined?'':text(app.description,1000)},content,audiences,issues,active:false}
}
