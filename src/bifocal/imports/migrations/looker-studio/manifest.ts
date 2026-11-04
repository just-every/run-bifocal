import { canonicalJson } from '../../../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys } from '../../../models/validation/transport'
import { fail } from '../../../query/types'
import { object, text, type InventoryItem } from '../compile'

export const evidenceKinds = ['page','data-source','field','blend','calculation','parameter','filter','layout','sharing','delivery'] as const
export type Evidence = {id:string;kind:typeof evidenceKinds[number];sourceRevision:string;sourceLocation:string;status:'inaccessible'|'supplied'|'unsupported';original:string}
export function evidenceInput(value:unknown):Evidence {
 const v=object(value)
 exactKeys(v,['id','kind','sourceRevision','sourceLocation','status','original'])
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(text(v.id,64))||!evidenceKinds.includes(v.kind as Evidence['kind'])||!['inaccessible','supplied','unsupported'].includes(String(v.status)))fail('looker_evidence_required',400)
 for(const key of ['sourceRevision','sourceLocation','original'])if(!text(v[key],key==='original'?8192:512).trim())fail('looker_evidence_location_required',400)
 return v as Evidence
}
/** This is our owner reconstruction format, never a claimed provider export. */
export function reconstructionItems(value:unknown):InventoryItem[] {
 const v=object(value)
 exactKeys(v,['version','projectId','source','cutoff','rollbackPlan','reportUrl','originals','evidence','drafts'])
 const link=new URL(text(v.reportUrl,1024))
 if(link.protocol!=='https:'||link.hostname!=='lookerstudio.google.com'||link.username||link.password||link.search||link.hash||!/^\/reporting\/[a-zA-Z0-9_-]+(?:\/page\/[a-zA-Z0-9_-]+)?\/?$/.test(link.pathname))fail('looker_report_link_required',400)
 if(!Array.isArray(v.originals)||!v.originals.length||v.originals.length>12||!Array.isArray(v.evidence)||v.evidence.length>70||!Array.isArray(v.drafts)||v.drafts.length>12)fail('looker_manifest_bounds',400)
 const originals=v.originals.map(value=>{const file=object(value);exactKeys(file,['name','content']);const name=text(file.name,128);if(!/^[a-zA-Z0-9_. -]+$/.test(name))fail('looker_original_name_required',400);return {name,content:text(file.content,32768)}})
 const evidence=v.evidence.map(evidenceInput)
 if(new Set(evidence.map(e=>e.id)).size!==evidence.length)fail('looker_duplicate_evidence',400)
 for(const kind of evidenceKinds)if(!evidence.some(e=>e.kind===kind))evidence.push({id:'missing-'+kind,kind,sourceRevision:'omitted',sourceLocation:link.href,status:'inaccessible',original:'Not supplied by the owner. Capture this definition or explicitly document its absence.'})
 const items:InventoryItem[]=[{id:'reconstruction-manifest',kind:'schema',sourceRevision:text(v.cutoff,32),original:canonicalJson({label:'Owner-supplied reconstruction; not a full report export',reportUrl:link.href,originals}),mapping:'Retained originals and source link; no provider authority.',gap:'Source parity and cutover are not established by this manifest.'},...evidence.map(e=>({id:e.id,kind:e.kind,sourceRevision:e.sourceRevision,original:canonicalJson(e),mapping:e.status,gap:e.status==='supplied'?'':e.status+': '+e.sourceLocation}))]
 for(const value of v.drafts){
  const draft=object(value);exactKeys(draft,['id','sourceRevision','document'])
  const id=text(draft.id,64);if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))fail('looker_draft_id_required',400)
  items.push({id,kind:'dashboard',sourceRevision:text(draft.sourceRevision,128),original:text(draft.document,8192),mapping:'Editable inactive native definition',gap:'Requires current evidence and separately reviewed native source snapshot; no sharing, delivery or cutover.'})
 }
 if(new Set(items.map(i=>i.id)).size!==items.length)fail('looker_duplicate_item',400)
 return items
}
