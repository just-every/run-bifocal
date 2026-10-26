import {dashboardInteractions,type DashboardInteractions} from './interactions.protocol'
import { exactKeys } from '../models/validation/transport'
import { queryInput } from '../query/validate'
import { fail, type Query } from '../query/types'
export type Placement={key:string;x:number;y:number;w:number;h:number}
export type DashboardDocument={version:2;title:string;cards:{key:string;definition:Query}[];layout:{desktop:Placement[];phone:Placement[]};interactions?:DashboardInteractions}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('dashboard_document_required',400);return v as Record<string,unknown>}
export function dashboardDocument(value:unknown):DashboardDocument {
 const input=object(value);exactKeys(input,['version','title','cards','layout','interactions'])
 if(input.version!==2||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||/[\u0000-\u001f]/.test(input.title)||!Array.isArray(input.cards)||input.cards.length<2||input.cards.length>4)fail('dashboard_grid_document_required',400)
 const cards=input.cards.map(value=>{const card=object(value);exactKeys(card,['key','definition']);if(typeof card.key!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(card.key))fail('dashboard_stable_card_key_required',400);return {key:card.key,definition:queryInput(card.definition)}})
 const keys=new Set(cards.map(card=>card.key));if(keys.size!==cards.length)fail('duplicate_dashboard_card_key',400)
 const layout=object(input.layout);exactKeys(layout,['desktop','phone'])
 const placements=(value:unknown,columns:number):Placement[]=>{
  if(!Array.isArray(value)||value.length!==cards.length)fail('complete_dashboard_layout_required',400)
  const rows=value.map(value=>{const p=object(value);exactKeys(p,['key','x','y','w','h']);if(typeof p.key!=='string'||!keys.has(p.key)||!['x','y','w','h'].every(k=>Number.isSafeInteger(p[k]))||Number(p.x)<0||Number(p.y)<0||Number(p.w)<1||Number(p.h)<1||Number(p.h)>1000||Number(p.x)+Number(p.w)>columns||Number(p.y)+Number(p.h)>10000)fail('bounded_dashboard_placement_required',400);return {key:p.key,x:Number(p.x),y:Number(p.y),w:Number(p.w),h:Number(p.h)}})
  if(new Set(rows.map(p=>p.key)).size!==keys.size)fail('complete_dashboard_layout_required',400)
  if(input.interactions===undefined)for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h)fail('dashboard_layout_overlap',400)}
  return rows.sort((a,b)=>a.key.localeCompare(b.key))
 }
 const document:DashboardDocument={version:2,title:input.title.trim(),cards,layout:{desktop:placements(layout.desktop,12),phone:placements(layout.phone,1)}}
 if(input.interactions!==undefined)document.interactions=dashboardInteractions(input.interactions,document)
 return document
}
export const dashboardId=(value:unknown):string=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))fail('dashboard_definition_id_required',400);return value}
export const dashboardRevision=(value:unknown):number=>{if(!Number.isSafeInteger(value)||Number(value)<1)fail('dashboard_definition_revision_required',400);return Number(value)}
