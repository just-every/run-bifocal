import {exactKeys} from '../models/validation/transport'
import {fail,type Query} from '../query/types'

export type NativeKind='vertical-bar'|'line'|'stepped-line'|'area'
export type ChartOrder={field:string;direction:'ascending'|'descending';nulls:'first'|'last'}
export type NativeOptions={order:ChartOrder;missing:'gap';scale:{zero:boolean;reverse:boolean};selection:{field:string;label:string}}
export const nativeKinds:readonly string[]=['vertical-bar','line','stepped-line','area']
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))fail('chart_options_required',400);return value as Record<string,unknown>}
/** Bound fields come only from the reviewed grouped query, with exact numeric ordering. */
export function nativeOptions(visual:Record<string,unknown>,query:Query):NativeOptions {
 const order=object(visual.order),scale=object(visual.scale),selection=object(visual.selection)
 exactKeys(order,['field','direction','nulls']);exactKeys(scale,['zero','reverse']);exactKeys(selection,['field','label'])
 if(typeof order.field!=='string'||![...query.groupBy,...query.measures.map(m=>m.id)].includes(order.field)||!['ascending','descending'].includes(String(order.direction))||!['first','last'].includes(String(order.nulls)))fail('chart_explicit_order_required',400)
 if(query.measures.some(m=>query.groupBy.includes(m.id)))fail('chart_ambiguous_field',400)
 if(visual.missing!=='gap')fail('chart_missing_value_gap_required',400)
 if(typeof scale.zero!=='boolean'||typeof scale.reverse!=='boolean'||['vertical-bar','area'].includes(String(visual.kind))&&!scale.zero)fail('chart_suitable_linear_scale_required',400)
 if(selection.field!==visual.dimension||typeof selection.label!=='string'||!selection.label.trim()||selection.label.length>100||/[\u0000-\u001f]/.test(selection.label))fail('chart_selection_required',400)
 return {order:order as ChartOrder,missing:'gap',scale:{zero:scale.zero,reverse:scale.reverse},selection:{field:String(selection.field),label:selection.label}}
}
