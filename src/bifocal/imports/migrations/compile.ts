import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys } from '../../models/validation/transport'
import { fail } from '../../query/types'
export type InventoryItem={id:string;kind:string;sourceRevision:string;original:string;mapping:string;gap:string}
export type Item={source:InventoryItem;native:string;edited:boolean;conflict:InventoryItem|null}
export type MigrationProject={id:string;ownerId:string;source:string;cutoff:string;rollbackPlan:string;items:Item[];state:'inactive';dispatch:'unavailable';grants:'none';expectedWorkspace:string|null}
const sources=['spreadsheet','databox','zoho','klipfolio','qlik','power-bi','tableau','looker','metabase','omni','sigma','hex']
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('migration_object_required',400);return value as Record<string,unknown>}
export function text(value:unknown,max=8192):string{if(typeof value!=='string'||value.length>max||value.includes('\u0000'))fail('migration_text_required',400);return value}
export function item(value:unknown):InventoryItem{
 const v=object(value);exactKeys(v,['id','kind','sourceRevision','original','mapping','gap'])
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(text(v.id,64)))fail('migration_item_id_required',400)
 if(!['data','metric','dashboard','parameter','schedule','folder','permission','identity','schema','load-script','association','set-analysis','sheet','bookmark','calculation'].includes(text(v.kind,32)))fail('migration_item_kind_required',400)
 const sourceRevision=text(v.sourceRevision,128);if(!sourceRevision)fail('migration_source_revision_required',400)
 // These are inert original descriptions. No expression, script or grant executes.
 return {id:v.id as string,kind:v.kind as string,sourceRevision,original:text(v.original),mapping:text(v.mapping,2048),gap:text(v.gap,2048)}
}
export const digest=(value:unknown)=>sha256(canonicalJson(value))
export function compileMigration(value:unknown,id:string,ownerId:string,current?:MigrationProject,expectedWorkspace:string|null=null):MigrationProject{
 const v=object(value);exactKeys(v,['version','projectId','source','cutoff','rollbackPlan','items'])
 if(v.version!==1||v.projectId!==id||!sources.includes(String(v.source)))fail('migration_envelope_required',400)
 const cutoff=text(v.cutoff,32);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cutoff)||!Number.isFinite(Date.parse(cutoff)))fail('migration_cutoff_required',400)
 const rollbackPlan=text(v.rollbackPlan,2048);if(!rollbackPlan.trim())fail('migration_rollback_plan_required',400)
 if(current&&(current.ownerId!==ownerId||current.source!==v.source))fail('migration_identity_changed',409)
 if(current&&cutoff<current.cutoff)fail('migration_cutoff_regressed',409)
 if(!Array.isArray(v.items)||!v.items.length||v.items.length>100)fail('migration_inventory_required',400)
 const incoming=v.items.map(item);if(new Set(incoming.map(i=>i.id)).size!==incoming.length)fail('migration_duplicate_item',400)
 const items:Item[]=structuredClone(current?.items??[])
 for(const next of incoming){
  const old=items.find(i=>i.source.id===next.id)
  if(!old){items.push({source:next,native:next.original,edited:false,conflict:null});continue}
  if(old.source.kind!==next.kind)fail('migration_item_kind_changed',409)
  if(digest(old.source)===digest(next)||old.conflict&&digest(old.conflict)===digest(next))continue
  if(next.sourceRevision===old.source.sourceRevision||next.sourceRevision===old.conflict?.sourceRevision)fail('migration_revision_reused',409)
  if(old.edited||old.conflict){old.conflict=next;continue}
  old.source=next;old.native=next.original
 }
 if(items.length>100)fail('migration_inventory_limit',413)
 // A reconstruction description never establishes translated behavior or parity.
 return {id,ownerId,source:v.source as string,cutoff,rollbackPlan,items:items.sort((a,b)=>a.source.id.localeCompare(b.source.id)),state:'inactive',dispatch:'unavailable',grants:'none',expectedWorkspace}
}
