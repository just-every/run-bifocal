import { DOMParser, type Element } from '@xmldom/xmldom'
import { object, requireValue } from '../analytics/protocol'
import type { WebInput, Field } from './input'
export function property(value:unknown,path:string):unknown {
 for(const part of path ? path.split('.') : []) {
  requireValue(object(value) && Object.hasOwn(value,part),'web_missing_path',502)
  value=value[part]
 }
 return value
}
export function optional(value:unknown,path:string):unknown {
 if(!path)return undefined
 if(object(value) && Object.hasOwn(value,path))return value[path]
 for(const part of path.split('.')) { if(!object(value) || !Object.hasOwn(value,part))return undefined;value=value[part] }
 return value
}
function xml(source:string,path:string):unknown[] {
 requireValue(!/<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(source),'web_active_xml_refused',502)
 let doc
 try { doc=new DOMParser({onError:()=>{throw Error('invalid XML')}}).parseFromString(source,'application/xml') } catch { requireValue(false,'web_invalid_xml',502) }
 requireValue(doc?.documentElement,'web_invalid_xml',502)
 const stack=[{node:doc.documentElement,depth:1}];let count=0
 while(stack.length) {
  const {node,depth}=stack.pop()!
  requireValue(++count<=20000 && depth<=32,'web_xml_limit',413)
  requireValue(node.namespaceURI!=='http://www.w3.org/2001/XInclude','web_active_xml_refused',502)
  for(const child of Array.from(node.childNodes))if(child.nodeType===1)stack.push({node:child as Element,depth:depth+1})
 }
 let nodes=[doc.documentElement]
 for(const part of path ? path.split('.') : [])nodes=nodes.flatMap(node=>Array.from(node.childNodes).filter((child):child is Element=>child.nodeType===1 && child.nodeName===part))
 return nodes.map(node=>{
  const value:Record<string,unknown>=Object.create(null)
  for(const child of Array.from(node.childNodes))if(child.nodeType===1) {
   const el=child as Element
   requireValue(!Object.hasOwn(value,el.nodeName) && !Array.from(el.childNodes).some(item=>item.nodeType===1),'web_xml_scalar_fields_required',502)
   value[el.nodeName]=el.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance','nil')==='true'?null:el.textContent
  }
  return value
 })
}
export function decode(source:string,input:WebInput):{document:unknown;items:unknown[]} {
 if(input.format==='xml')return {document:null,items:xml(source,input.itemsPath)}
 let document:unknown
 try { document=JSON.parse(source) } catch { requireValue(false,'web_invalid_json',502) }
 const items=property(document,input.itemsPath)
 requireValue(Array.isArray(items),'web_collection_required',502)
 if(input.format==='odata') {
  requireValue(!items.some(item=>object(item) && (Object.hasOwn(item,'@removed') || Object.hasOwn(item,'@odata.removed'))),'web_delta_requires_durable_sync',409)
  requireValue(!(optional(document,'@odata.nextLink') && optional(document,'@odata.deltaLink')),'web_invalid_odata_links',502)
 }
 return {document,items}
}
/** Shared CSV typing uses decimal strings and US input dates. Preserve empty
 * text, null, false and zero distinctly; refuse lossy floating point numbers. */
export function cell(row:unknown,field:Field):string|null {
 const value=property(row,field.path)
 if(value===null)return null
 requireValue(['string','number','boolean'].includes(typeof value),'web_scalar_required',502)
 requireValue(typeof value!=='number' || Number.isSafeInteger(value),'web_exact_decimal_string_required',502)
 let text=String(value)
 if(field.type==='date') {
  requireValue(typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value,'web_iso_date_required',502)
  text=value.slice(5,7)+'/'+value.slice(8,10)+'/'+value.slice(0,4)
 }
 requireValue(text.length<=4096 && !text.includes('\0'),'web_cell_limit',413)
 return text
}
