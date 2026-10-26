import { FISCAL_WINDOWS, type FiscalWindow } from '../calendars/fiscal'
import {exactKeys} from '../models/validation/transport'
import {fail,type Filter} from '../query/types'
import {dashboardFilters} from './filters'
import type {DashboardDocument,Placement} from './authoring.protocol'

export type ReaderSelection={tab:string;filters:Filter[];fields:Record<string,string>;fiscal:Record<string,{asOf:string;window:FiscalWindow}>;whatIf:Record<string,string>}
export type DashboardInteractions={
 tabs:{id:string;label:string;cards:string[];tiles:string[]}[]
 tiles:({key:string;kind:'text';text:string}|{key:string;kind:'image';alt:string;data:string})[]
 tileLayout:{desktop:Placement[];phone:Placement[]}
 recordActions:{id:string;label:string;card:string;columns:string[];keys:string[]}[]
 dimensions:string[]
 fieldParameters:{id:string;label:string;card:string;default:string;choices:{id:string;label:string;groupBy:string[];measures:string[]}[]}[]
 fiscalParameters:{id:string;label:string;cards:string[];default:{asOf:string;window:FiscalWindow}}[]
 whatIfParameters:{id:string;label:string;card:string;libraryId:string;revision:string;parameter:string;default:string}[]
 states:{name:string;revision:number;selection:ReaderSelection}[]
 stories:{id:string;label:string;steps:{state:string;revision:number}[]}[]
 actions:{id:string;label:string;card:string;kind:'dashboard'|'tooltip';target:string;bindings:{source:string;target:string}[];fiscalBindings:{source:string;target:string}[]}[]
 duplicateAllowed:boolean
}
export const interactionObject=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))fail('dashboard_interaction_object_required',400);return value as Record<string,unknown>}
const list=(value:unknown,max=16):unknown[]=>{if(!Array.isArray(value)||value.length>max)fail('bounded_dashboard_interactions_required',400);return value}
const text=(value:unknown,max=160):string=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))fail('dashboard_interaction_text_required',400);return value.trim()}
const key=(value:unknown)=>{const result=text(value,64);if(!/^[a-z][a-z0-9-]*$/.test(result))fail('dashboard_interaction_key_required',400);return result}
const refs=(value:unknown,max=16)=>{const result=list(value,max).map(v=>text(v,200));if(new Set(result).size!==result.length)fail('duplicate_dashboard_interaction_reference',400);return result}
const unique=(values:string[])=>{if(new Set(values).size!==values.length)fail('duplicate_dashboard_interaction_key',400)}
const civil=(value:unknown):string=>{const result=text(value,10);if(!/^\d{4}-\d\d-\d\d$/.test(result)||!Number.isFinite(Date.parse(result+'T00:00:00Z'))||new Date(result+'T00:00:00Z').toISOString().slice(0,10)!==result)fail('dashboard_fiscal_date_required',400);return result}
const fiscal=(value:unknown)=>{const v=interactionObject(value);exactKeys(v,['asOf','window']);if(!FISCAL_WINDOWS.some(window=>window===v.window))fail('dashboard_fiscal_window_required',400);return {asOf:civil(v.asOf),window:v.window} as ReaderSelection['fiscal'][string]}
const strings=(value:unknown):Record<string,string>=>Object.fromEntries(Object.entries(interactionObject(value??{})).map(([id,value])=>[key(id),text(value,200)]))
export function readerSelection(value:unknown,config:DashboardInteractions):ReaderSelection{
 const v=interactionObject(value??{});exactKeys(v,['tab','filters','fields','fiscal','whatIf'])
 const tab=v.tab===undefined?config.tabs[0].id:key(v.tab);if(!config.tabs.some(t=>t.id===tab))fail('dashboard_tab_unavailable',400)
 const filters=dashboardFilters(v.filters);if(filters.some(f=>!config.dimensions.includes(f.column)))fail('dashboard_dimension_unavailable',403)
 const fields={...Object.fromEntries(config.fieldParameters.map(p=>[p.id,p.default])),...strings(v.fields)}
 for(const [id,choice] of Object.entries(fields))if(!config.fieldParameters.some(p=>p.id===id&&p.choices.some(c=>c.id===choice)))fail('dashboard_field_parameter_unavailable',403)
 const fiscalValues={...Object.fromEntries(config.fiscalParameters.map(p=>[p.id,p.default])),...Object.fromEntries(Object.entries(interactionObject(v.fiscal??{})).map(([id,value])=>[id,fiscal(value)]))}
 if(Object.keys(fiscalValues).some(id=>!config.fiscalParameters.some(p=>p.id===id)))fail('dashboard_fiscal_parameter_unavailable',403)
 const whatIf={...Object.fromEntries(config.whatIfParameters.map(p=>[p.id,p.default])),...strings(v.whatIf)}
 if(Object.entries(whatIf).some(([id,value])=>!config.whatIfParameters.some(p=>p.id===id)||!/^[-+]?\d+(?:\.\d+)?$/.test(value)))fail('dashboard_what_if_parameter_unavailable',403)
 return {tab,filters,fields,fiscal:fiscalValues,whatIf}
}
export function defaultInteractions(document:DashboardDocument):DashboardInteractions{
 const dimensions=document.cards[0].definition.groupBy.filter(column=>document.cards.every(c=>c.definition.groupBy.includes(column)))
 return {tabs:[{id:'main',label:'Dashboard',cards:document.cards.map(c=>c.key),tiles:[]}],tiles:[],tileLayout:{desktop:[],phone:[]},recordActions:[],dimensions,fieldParameters:[],fiscalParameters:[],whatIfParameters:[],states:[],stories:[],actions:[],duplicateAllowed:false}
}
export function dashboardInteractions(value:unknown,document:DashboardDocument):DashboardInteractions{
 const v=interactionObject(value);exactKeys(v,['tabs','tiles','tileLayout','recordActions','dimensions','fieldParameters','fiscalParameters','whatIfParameters','states','stories','actions','duplicateAllowed'])
 const defaults=defaultInteractions(document),card=(id:unknown)=>{const found=document.cards.find(c=>c.key===id);if(!found)fail('dashboard_card_reference_required',400);return found}
 const recordActions=list(v.recordActions??[],4).map(value=>{const action=interactionObject(value);exactKeys(action,['id','label','card','columns','keys']);const target=card(action.card),columns=refs(action.columns,32),keys=refs(action.keys,8),shape=target.definition.semantic;if(!shape||!columns.length||!keys.length||columns.some(column=>!shape.dimensions.some(d=>d.column===column))||keys.some(column=>!columns.includes(column))||keys.length!==shape.grain.length||keys.some(column=>!shape.grain.includes(column)))fail('authored_dashboard_record_grain_required',400);return {id:key(action.id),label:text(action.label),card:target.key,columns,keys}});unique(recordActions.map(a=>a.id))
 const dimensions=v.dimensions===undefined?defaults.dimensions:refs(v.dimensions,8)
 for(const column of dimensions)for(const c of document.cards)if(!c.definition.groupBy.includes(column)&&!c.definition.semantic?.dimensions.some(d=>d.column===column))fail('dashboard_dimension_not_authored',400)
 const tiles=list(v.tiles??[],8).map(value=>{const tile=interactionObject(value);exactKeys(tile,['key','kind','text','alt','data']);const id=key(tile.key);if(tile.kind==='text'){if(typeof tile.text!=='string'||tile.text.length>8000)fail('bounded_dashboard_text_required',400);return {key:id,kind:'text' as const,text:tile.text}}if(tile.kind!=='image'||typeof tile.data!=='string'||tile.data.length>24000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(tile.data))fail('inert_dashboard_image_required',400);let bytes:string;try{bytes=atob(tile.data.split(',')[1])}catch{fail('inert_dashboard_image_required',400)}if(!(tile.data.startsWith('data:image/png;')&&bytes.startsWith('\x89PNG\r\n\x1a\n')||tile.data.startsWith('data:image/jpeg;')&&bytes.startsWith('\xff\xd8\xff')||tile.data.startsWith('data:image/webp;')&&bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP'))fail('dashboard_image_type_mismatch',400);return {key:id,kind:'image' as const,alt:text(tile.alt,300),data:tile.data}})
 unique([...document.cards.map(c=>c.key),...tiles.map(t=>t.key)])
 const placements=(values:unknown,columns:number):Placement[]=>{const rows=list(values??[],8).map(value=>{const p=interactionObject(value);exactKeys(p,['key','x','y','w','h']);if(!tiles.some(t=>t.key===p.key)||!['x','y','w','h'].every(k=>Number.isSafeInteger(p[k]))||Number(p.x)<0||Number(p.y)<0||Number(p.w)<1||Number(p.h)<1||Number(p.h)>1000||Number(p.x)+Number(p.w)>columns||Number(p.y)+Number(p.h)>10000)fail('dashboard_tile_placement_required',400);return {key:String(p.key),x:Number(p.x),y:Number(p.y),w:Number(p.w),h:Number(p.h)}});unique(rows.map(r=>r.key));if(rows.length!==tiles.length)fail('complete_dashboard_tile_layout_required',400);return rows}
 const layout=interactionObject(v.tileLayout??{});exactKeys(layout,['desktop','phone']);const tileLayout={desktop:placements(layout.desktop,12),phone:placements(layout.phone,1)}
 const tabs=list(v.tabs??defaults.tabs,8).map(value=>{const t=interactionObject(value);exactKeys(t,['id','label','cards','tiles']);const cards=refs(t.cards,4),tileIds=refs(t.tiles??[],8);cards.forEach(card);if(tileIds.some(id=>!tiles.some(t=>t.key===id)))fail('dashboard_tile_reference_required',400);return {id:key(t.id),label:text(t.label),cards,tiles:tileIds}})
 if(!tabs.length||document.cards.some(c=>!tabs.some(t=>t.cards.includes(c.key)))||tiles.some(tile=>!tabs.some(t=>t.tiles.includes(tile.key))))fail('complete_dashboard_tabs_required',400);unique(tabs.map(t=>t.id))
 for(const mode of ['desktop','phone'] as const)for(const tab of tabs){const rows=[...document.layout[mode].filter(p=>tab.cards.includes(p.key)),...tileLayout[mode].filter(p=>tab.tiles.includes(p.key))];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h)fail('dashboard_tab_layout_overlap',400)}}
 const fieldParameters=list(v.fieldParameters??[],4).map(value=>{const p=interactionObject(value);exactKeys(p,['id','label','card','default','choices']);const target=card(p.card),choices=list(p.choices,16).map(value=>{const c=interactionObject(value);exactKeys(c,['id','label','groupBy','measures']);const groupBy=refs(c.groupBy,8),measures=refs(c.measures,16);if(!measures.length||groupBy.some(g=>!target.definition.groupBy.includes(g))||measures.some(m=>!target.definition.measures.some(measure=>measure.id===m)))fail('dashboard_field_choice_not_authored',400);return {id:key(c.id),label:text(c.label),groupBy,measures}});unique(choices.map(c=>c.id));const selected=key(p.default);if(!choices.some(c=>c.id===selected))fail('dashboard_field_default_required',400);return {id:key(p.id),label:text(p.label),card:target.key,default:selected,choices}})
 unique(fieldParameters.map(p=>p.card))
 const fiscalParameters=list(v.fiscalParameters??[],4).map(value=>{const p=interactionObject(value);exactKeys(p,['id','label','cards','default']);const cards=refs(p.cards,4);if(!cards.length||cards.some(id=>!card(id).definition.fiscal))fail('authored_dashboard_fiscal_binding_required',400);return {id:key(p.id),label:text(p.label),cards,default:fiscal(p.default)}})
 unique(fiscalParameters.flatMap(p=>p.cards))
 const whatIfParameters=list(v.whatIfParameters??[],4).map(value=>{const p=interactionObject(value);exactKeys(p,['id','label','card','libraryId','revision','parameter','default']);if(typeof p.default!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(p.default))fail('dashboard_numeric_parameter_required',400);return {id:key(p.id),label:text(p.label),card:card(p.card).key,libraryId:key(p.libraryId),revision:text(p.revision,200),parameter:key(p.parameter),default:p.default}})
 unique(whatIfParameters.map(p=>p.card));unique([...fieldParameters,...fiscalParameters,...whatIfParameters].map(p=>p.id))
 const actions=list(v.actions??[],16).map(value=>{const a=interactionObject(value);exactKeys(a,['id','label','card','kind','target','bindings','fiscalBindings']);if(a.kind!=='dashboard'&&a.kind!=='tooltip'||typeof a.target!=='string'||!/^[a-f0-9-]{36}$/.test(a.target))fail('dashboard_action_target_required',400);const bindings=list(a.bindings??[],8).map(value=>{const b=interactionObject(value);exactKeys(b,['source','target']);const source=text(b.source,200);if(!dimensions.includes(source))fail('dashboard_action_dimension_required',400);return {source,target:text(b.target,200)}}),fiscalBindings=list(a.fiscalBindings??[],4).map(value=>{const b=interactionObject(value);exactKeys(b,['source','target']);if(!fiscalParameters.some(p=>p.id===b.source))fail('dashboard_action_fiscal_required',400);return {source:key(b.source),target:key(b.target)}});unique(bindings.map(b=>b.target));unique(fiscalBindings.map(b=>b.target));return {id:key(a.id),label:text(a.label),card:card(a.card).key,kind:a.kind as 'dashboard'|'tooltip',target:a.target,bindings,fiscalBindings}});unique(actions.map(a=>a.id))
 if(v.duplicateAllowed!==undefined&&typeof v.duplicateAllowed!=='boolean')fail('dashboard_duplication_permission_required',400)
 const config:DashboardInteractions={tabs,tiles,tileLayout,recordActions,dimensions,fieldParameters,fiscalParameters,whatIfParameters,actions,states:[],stories:[],duplicateAllowed:v.duplicateAllowed===true}
 config.states=list(v.states??[],20).map(value=>{const s=interactionObject(value);exactKeys(s,['name','revision','selection']);if(!Number.isSafeInteger(s.revision)||Number(s.revision)<1||Number(s.revision)>100)fail('dashboard_state_revision_required',400);return {name:text(s.name,80),revision:Number(s.revision),selection:readerSelection(s.selection,config)}});unique(config.states.map(s=>s.name))
 config.stories=list(v.stories??[],8).map(value=>{const s=interactionObject(value);exactKeys(s,['id','label','steps']);const steps=list(s.steps,20).map(value=>{const step=interactionObject(value);exactKeys(step,['state','revision']);const state=config.states.find(s=>s.name===step.state&&s.revision===step.revision);if(!state)fail('exact_dashboard_story_state_required',400);return {state:state.name,revision:state.revision}});if(steps.length<2)fail('dashboard_story_steps_required',400);return {id:key(s.id),label:text(s.label),steps}});unique(config.stories.map(s=>s.id))
 return config
}
