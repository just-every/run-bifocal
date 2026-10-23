import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail } from '../query/types'
export function text(value:unknown,max=160):string{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))fail('invalid_catalog_text',400);return value.trim()}
export function uuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))fail('invalid_catalog_id',400);return value}
export const digest=(value:unknown)=>sha256(canonicalJson(value))
export function metadata(input:Record<string,unknown>){
 const kind=text(input.kind),title=text(input.title),description=input.description===''?'':text(input.description,4000)
 if(!['dashboard','report','question','notebook','metric','source-column'].includes(kind)||!Array.isArray(input.tags)||input.tags.length>20||!Array.isArray(input.sourceLinks)||input.sourceLinks.length>10||typeof input.verified!=='boolean')fail('invalid_catalog_metadata',400)
 const tags=[...new Set(input.tags.map(tag=>text(tag,64)))].sort()
 const sourceLinks=input.sourceLinks.map(value=>{
  const link=text(value,1024)
  if(link.startsWith('/')&&!link.startsWith('//')&&!/[?#\\]/.test(link))return link
  let url:URL;try{url=new URL(link)}catch{fail('invalid_source_link',400)}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('source_link_must_not_carry_credentials',400)
  return url.href
 })
 if(!input.definition||typeof input.definition!=='object'||Array.isArray(input.definition)||canonicalJson(input.definition).length>8192)fail('catalog_definition_required',400)
 const collectionId=input.collectionId===null?null:uuid(input.collectionId)
 const definition=input.definition as Record<string,unknown>
 return {kind,title,description,tags,sourceLinks,verified:input.verified,definition,collectionId,fingerprint:digest({kind,definition,sourceLinks})}
}
