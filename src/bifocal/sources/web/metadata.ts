import { object, publicOrigin, requireValue } from '../analytics/protocol'
export type WebMetadata = { origin:string; format:'json'|'odata'|'xml'; paging:string; pages:number; fetchedAt:string; reconciliation:'reviewed-full-snapshot'; deletionFeed:false; deltaAvailable:boolean }
export function webMetadata(value:unknown):WebMetadata|undefined {
 if(value===undefined)return undefined
 requireValue(object(value) && Object.keys(value).sort().join(',')==='deletionFeed,deltaAvailable,fetchedAt,format,origin,pages,paging,reconciliation','web_invalid_metadata')
 publicOrigin(value.origin)
 requireValue(['json','odata','xml'].includes(String(value.format)) && ['none','next-link','page','offset','cursor'].includes(String(value.paging)) && Number.isInteger(value.pages) && Number(value.pages)>0 && Number(value.pages)<=20 && typeof value.fetchedAt==='string' && Number.isFinite(Date.parse(value.fetchedAt)) && value.reconciliation==='reviewed-full-snapshot' && value.deletionFeed===false && typeof value.deltaAvailable==='boolean','web_invalid_metadata')
 return value as WebMetadata
}
