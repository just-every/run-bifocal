import { object, publicOrigin, requireValue, datasetId, token } from '../analytics/protocol'
import type { Column } from '../../imports/files/csv'
export type Field = Column & { path: string }
export type WebInput = { datasetId:string; readId:string; endpoint:string; format:'json'|'odata'|'xml'; itemsPath:string; fields:Field[]; paging:'none'|'next-link'|'page'|'offset'|'cursor'; nextPath:string; parameter:string; sizeParameter:string; pageSize:number; accessToken:string; catchup:boolean }
const credentialParameter = (name:string) => /^(?:token|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|authorization|api[-_]?key|secret)$/i.test(name)
export const readId = (value:unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
const path = (value:unknown): value is string => typeof value === 'string' && value.length <= 256 && (value === '' || value.split('.').every(part=>/^[A-Za-z_@][A-Za-z0-9_@-]*$/.test(part) && !['__proto__','prototype','constructor'].includes(part)))
export function destination(value:unknown, origins:string[], base?:string): URL {
 requireValue(typeof value === 'string' && value.length > 0 && value.length <= 2048,'web_endpoint_required')
 let url:URL
 try { url=new URL(value,base) } catch { throw Error('invalid destination') }
 publicOrigin(url.origin)
 requireValue(!url.username && !url.password && !url.hash && origins.includes(url.origin),'web_destination_not_approved',403)
 requireValue(![...url.searchParams.keys()].some(key=>credentialParameter(key)),'web_credentials_in_url',403)
 return url
}
export function approvedOrigins(setting:string|undefined): string[] {
 if(!setting)return []
 return setting.split(',').map(value=>publicOrigin(value.trim()))
}
export function webInput(value:Record<string,unknown>,origins:string[]): WebInput {
 requireValue(Object.keys(value).every(key=>['datasetId','readId','endpoint','format','itemsPath','fields','paging','nextPath','parameter','sizeParameter','pageSize','accessToken','confirmRead','confirmSnapshot','catchup'].includes(key)),'web_unknown_field')
 requireValue(datasetId(value.datasetId) && readId(value.readId),'web_identity_required')
 requireValue(value.confirmRead === true && value.confirmSnapshot === true,'web_snapshot_consent_required')
 const endpoint=destination(value.endpoint,origins).href
 requireValue(!new URL(endpoint).searchParams.has('$deltatoken'),'web_delta_requires_durable_sync',409)
 requireValue(['json','odata','xml'].includes(String(value.format)) && ['none','next-link','page','offset','cursor'].includes(String(value.paging)),'web_format_or_paging_required')
 requireValue(path(value.itemsPath) && path(value.nextPath),'web_simple_path_required')
 requireValue(Array.isArray(value.fields) && value.fields.length>0 && value.fields.length<=64,'web_fields_required')
 const fields=value.fields as unknown[]
 requireValue(fields.every(field=>object(field) && Object.keys(field).sort().join(',')==='name,path,type' && typeof field.name==='string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(field.name) && path(field.path) && field.path!=='' && ['text','number','money','date','boolean'].includes(String(field.type))),'web_invalid_field')
 requireValue(new Set(fields.map(field=>(field as Field).name)).size===fields.length,'web_duplicate_field')
 requireValue(typeof value.parameter==='string' && /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(value.parameter) && !credentialParameter(value.parameter),'web_paging_parameter_required')
 requireValue(typeof value.sizeParameter==='string' && /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(value.sizeParameter) && !credentialParameter(value.sizeParameter) && value.sizeParameter!==value.parameter,'web_size_parameter_required')
 requireValue(Number.isInteger(value.pageSize) && Number(value.pageSize)>0 && Number(value.pageSize)<=500,'web_page_size_required')
 requireValue(value.catchup===undefined || typeof value.catchup==='boolean','web_invalid_catchup')
 requireValue(value.format!=='xml' || value.paging==='none','web_xml_single_document_only')
 requireValue(value.format!=='odata' || value.paging==='next-link' && value.itemsPath==='value','web_odata_collection_required')
 requireValue(!['page','offset'].includes(String(value.paging)) || !new URL(endpoint).searchParams.has(value.parameter),'web_start_at_first_page')
 requireValue(value.paging!=='cursor' || value.nextPath!=='' && !new URL(endpoint).searchParams.has(value.parameter),'web_cursor_start_required')
 const accessToken=token(value.accessToken),{accessToken:_,...meaning}=value
 requireValue(!JSON.stringify(meaning).includes(accessToken),'web_credential_in_configuration')
 return {datasetId:value.datasetId,readId:value.readId,endpoint,format:value.format as WebInput['format'],itemsPath:value.itemsPath,fields:fields as Field[],paging:value.paging as WebInput['paging'],nextPath:value.nextPath,parameter:value.parameter,sizeParameter:value.sizeParameter,pageSize:Number(value.pageSize),accessToken,catchup:value.catchup===true}
}
