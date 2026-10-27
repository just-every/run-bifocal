import { exactKeys } from '../models/validation/transport'
import { fail, type Cell, type Measure, type Query } from '../query/types'
import { arithmetic, expressionFields, type Expression } from './expression'

export type Specification={language:'vega-lite'|'vega';spec:Record<string,unknown>;selection?:{field:string;label:string}}
export type Column={id:string;unit:Measure['unit'];scale:number}
type Predicate={field:string;equal?:Cell;notEqual?:Cell;oneOf?:Cell[];range?:[string,string];gte?:string;lte?:string}
export type Transform={kind:'calculate';as:string;expression:Expression}|{kind:'sum';as:string;field:string;cumulative:boolean}|{kind:'filter';predicate:Predicate}
export type Plan={mark:'bar'|'point';dimension:string;measure:string;end?:string;scale:{domain?:[string,string];domainField?:string;zero:boolean;reverse:boolean};columns:Column[];transforms:Transform[];selection?:{field:string;label:string};language?:string}
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('chart_object_required',400);return value as Record<string,unknown>}
function list(value:unknown,max=16):unknown[]{if(!Array.isArray(value)||value.length>max)fail('chart_bounded_array_required',400);return value}
function text(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>100||/[\u0000-\u001f]/.test(value))fail('chart_text_required',400);return value}
const scalar=(value:unknown):Cell=>{if(value!==null&&typeof value!=='string'&&typeof value!=='boolean')fail('chart_scalar_required',400);if(typeof value==='string'&&value.length>200)fail('chart_scalar_required',400);return value as Cell}
const numberText=(value:unknown)=>{if(typeof value!=='string'||!/^\-?(?:0|[1-9]\d{0,35})(?:\.\d{1,12})?$/.test(value))fail('chart_decimal_string_required',400);return value}
function scale(value:unknown):Plan['scale'] {
 if(value===undefined)return {zero:true,reverse:false}
 const input=record(value);exactKeys(input,['type','zero','reverse','domain'])
 if(input.type!==undefined&&input.type!=='linear'||input.zero!==undefined&&typeof input.zero!=='boolean'||input.reverse!==undefined&&typeof input.reverse!=='boolean')fail('chart_linear_scale_required',400)
 let domain:[string,string]|undefined
 if(input.domain!==undefined){const values=list(input.domain,2);if(values.length!==2)fail('chart_scale_domain_required',400);domain=[numberText(values[0]),numberText(values[1])];const compare=(a:string,b:string)=>{const digits=Math.max(a.split('.')[1]?.length??0,b.split('.')[1]?.length??0),normalize=(s:string)=>BigInt(s.replace('.',''))*10n**BigInt(digits-(s.split('.')[1]?.length??0));return normalize(a)<normalize(b)};if(!compare(...domain))fail('chart_scale_domain_order_required',400)}
 return {zero:input.zero!==false,reverse:input.reverse===true,...(domain?{domain}:{})}
}
function predicate(value:unknown,dimensions:Set<string>,numeric:Set<string>):Predicate {
 const input=record(value);exactKeys(input,['field','equal','oneOf','range','gte','lte'])
 const field=text(input.field);if(!dimensions.has(field)&&!numeric.has(field))fail('chart_unknown_field',400)
 const operations=['equal','oneOf','range','gte','lte'].filter(key=>Object.hasOwn(input,key));if(operations.length!==1)fail('chart_filter_required',400)
 if(operations[0]==='equal')return {field,equal:scalar(input.equal)}
 if(operations[0]==='oneOf')return {field,oneOf:list(input.oneOf,100).map(scalar)}
 if(!numeric.has(field))fail('chart_numeric_range_required',400)
 if(operations[0]==='gte'||operations[0]==='lte')return {field,[operations[0]]:numberText(input[operations[0]])}
 const values=list(input.range,2);if(values.length!==2)fail('chart_range_required',400)
 return {field,range:[numberText(values[0]),numberText(values[1])]}
}
export function compileSpecification(value:unknown,query:Query):{specification:Specification;plan:Plan} {
 const input=record(value);exactKeys(input,['language','spec','selection'])
 if(input.language!=='vega-lite'&&input.language!=='vega')fail('chart_language_unsupported',400)
 const language=input.language,spec=record(input.spec),dimensions=new Set(query.groupBy),columns:Column[]=query.measures.map(m=>({id:m.id,unit:m.unit,scale:m.scale})),numeric=new Set(columns.map(c=>c.id)),transforms:Transform[]=[]
 if(query.groupBy.some(field=>numeric.has(field)))fail('chart_ambiguous_field',400)
 const field=(value:unknown,kind:'numeric'|'dimension')=>{const name=text(value);if(!(kind==='numeric'?numeric:dimensions).has(name))fail('chart_unknown_field',400);return name}
 const derived=(name:unknown,unit:Column['unit'],precision:number)=>{const id=text(name);if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)||['__proto__','constructor','prototype'].includes(id)||numeric.has(id)||dimensions.has(id))fail('chart_derived_field_conflict',400);numeric.add(id);columns.push({id,unit,scale:precision});return id}
 const calculation=(source:unknown,name:unknown)=>{
  const expression=arithmetic(source,numeric),inputs=expressionFields(expression).map(ref=>columns.find(column=>column.id===ref)!)
  const unit=(expression:Expression):Column['unit']|undefined=>{
   if(expression.kind==='constant')return undefined
   if(expression.kind==='field')return columns.find(column=>column.id===expression.field)!.unit
   const left=unit(expression.left),right=unit(expression.right)
   if((expression.op==='+'||expression.op==='-')&&left&&right&&left!==right)fail('chart_calculation_units_mismatch',400)
   if(expression.op==='*'&&left&&right||expression.op==='/'&&right)fail('chart_calculation_unit_product_unsupported',400)
   return left??right
  }
  const as=derived(name,unit(expression)??'number',Math.max(2,...inputs.map(column=>column.scale)));transforms.push({kind:'calculate',as,expression})
 }
 const sum=(name:unknown,source:unknown,cumulative:boolean)=>{const id=field(source,'numeric'),column=columns.find(c=>c.id===id)!,as=derived(name,column.unit,column.scale);transforms.push({kind:'sum',as,field:id,cumulative})}
 let mark:Plan['mark'],dimension:string,measure:string,end:string|undefined,numericScale:Plan['scale']
 if(language==='vega-lite'){
  exactKeys(spec,['data','mark','encoding','transform']);const data=record(spec.data);exactKeys(data,['name']);if(data.name!=='answer')fail('chart_retained_answer_required',400)
  for(const value of spec.transform===undefined?[]:list(spec.transform)){
   const transform=record(value)
   if(Object.hasOwn(transform,'calculate')){exactKeys(transform,['calculate','as']);calculation(transform.calculate,transform.as)}
   else if(Object.hasOwn(transform,'filter')){exactKeys(transform,['filter']);transforms.push({kind:'filter',predicate:predicate(transform.filter,dimensions,numeric)})}
   else if(Object.hasOwn(transform,'joinaggregate')){exactKeys(transform,['joinaggregate']);for(const value of list(transform.joinaggregate,4)){const aggregate=record(value);exactKeys(aggregate,['op','field','as']);if(aggregate.op!=='sum')fail('chart_sum_required',400);sum(aggregate.as,aggregate.field,false)}}
   else if(Object.hasOwn(transform,'window')){exactKeys(transform,['window','frame']);if(JSON.stringify(transform.frame)!=='[null,0]')fail('chart_cumulative_frame_required',400);for(const value of list(transform.window,4)){const window=record(value);exactKeys(window,['op','field','as']);if(window.op!=='sum')fail('chart_sum_required',400);sum(window.as,window.field,true)}}
   else fail('chart_transform_unsupported',400)
  }
  if(spec.mark!=='bar'&&spec.mark!=='point')fail('chart_mark_unsupported',400);mark=spec.mark
  const encoding=record(spec.encoding);exactKeys(encoding,['x','y','x2']);const x=record(encoding.x),y=record(encoding.y);exactKeys(x,['field','type','scale']);exactKeys(y,['field','type']);if(x.type!=='quantitative'||y.type!=='nominal')fail('chart_binding_types_required',400)
  dimension=field(y.field,'dimension');measure=field(x.field,'numeric');numericScale=scale(x.scale)
  if(encoding.x2!==undefined){const x2=record(encoding.x2);exactKeys(x2,['field']);end=field(x2.field,'numeric');if(mark!=='bar')fail('chart_interval_bar_required',400)}
 }else{
  exactKeys(spec,['data','scales','marks'])
  const datasets=list(spec.data,1);if(datasets.length!==1)fail('chart_retained_answer_required',400);const data=record(datasets[0]);exactKeys(data,['name','transform']);if(data.name!=='answer')fail('chart_retained_answer_required',400)
  for(const value of data.transform===undefined?[]:list(data.transform)){
   const transform=record(value)
   if(transform.type==='formula'){exactKeys(transform,['type','expr','as']);calculation(transform.expr,transform.as)}
   else if(transform.type==='filter'){
    exactKeys(transform,['type','expr']);if(typeof transform.expr!=='string'||transform.expr.length>512)fail('chart_unsafe_expression',400)
    const match=/^datum\.([A-Za-z_][A-Za-z0-9_]*)\s*(===|!==|==|!=|>=|<=)\s*("(?:[^"\\]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(transform.expr)
    if(!match)fail('chart_unsafe_expression',400)
    let value:unknown;try{value=JSON.parse(match[3])}catch{fail('chart_unsafe_expression',400)}
    const op=match[2],literal=typeof value==='number'?match[3]:value,filter=predicate({field:match[1],...(op==='>='?{gte:literal}:op==='<='?{lte:literal}:{equal:literal})},dimensions,numeric)
    if(op==='!=='||op==='!='){filter.notEqual=filter.equal;delete filter.equal}
    transforms.push({kind:'filter',predicate:filter})
   }
   else if(transform.type==='joinaggregate'||transform.type==='window'){exactKeys(transform,['type','ops','fields','as',...(transform.type==='window'?['frame']:[])]);const ops=list(transform.ops,4),fields=list(transform.fields,4),names=list(transform.as,4);if(!ops.length||ops.length!==fields.length||ops.length!==names.length||ops.some(op=>op!=='sum')||transform.type==='window'&&JSON.stringify(transform.frame)!=='[null,0]')fail('chart_sum_required',400);for(let index=0;index<ops.length;index++)sum(names[index],fields[index],transform.type==='window')}
   else fail('chart_transform_unsupported',400)
  }
  const scales=list(spec.scales,2);if(scales.length!==2)fail('chart_two_scales_required',400)
  const x=record(scales[0]),y=record(scales[1]);exactKeys(x,['name','type','domain','range','zero','reverse']);exactKeys(y,['name','type','domain','range']);if(x.name!=='x'||x.type!=='linear'||x.range!=='width'||y.name!=='y'||y.type!=='band'||y.range!=='height')fail('chart_native_scales_required',400)
  const yDomain=record(y.domain);exactKeys(yDomain,['data','field']);if(yDomain.data!=='answer')fail('chart_retained_answer_required',400);dimension=field(yDomain.field,'dimension')
  const domain=record(x.domain);exactKeys(domain,['data','field']);if(domain.data!=='answer')fail('chart_retained_answer_required',400);const domainField=field(domain.field,'numeric')
  numericScale={...scale({type:'linear',...(x.zero!==undefined?{zero:x.zero}:{}),...(x.reverse!==undefined?{reverse:x.reverse}:{})}),domainField}
  const marks=list(spec.marks,1);if(marks.length!==1)fail('chart_one_mark_required',400);const node=record(marks[0]);exactKeys(node,['type','from','encode']);if(node.type!=='rect'&&node.type!=='symbol')fail('chart_mark_unsupported',400);mark=node.type==='rect'?'bar':'point'
  const from=record(node.from);exactKeys(from,['data']);if(from.data!=='answer')fail('chart_retained_answer_required',400)
  const encode=record(node.encode);exactKeys(encode,['enter']);const enter=record(encode.enter);exactKeys(enter,['x','x2','y'])
  const binding=(value:unknown,axis:'x'|'y')=>{const b=record(value);exactKeys(b,['scale','field','value']);if(b.scale!==axis)fail('chart_scale_binding_required',400);if(axis==='x'&&b.value===0&&b.field===undefined)return undefined;if(b.value!==undefined)fail('chart_field_binding_required',400);return field(b.field,axis==='x'?'numeric':'dimension')}
  if(binding(enter.y,'y')!==dimension)fail('chart_dimension_binding_mismatch',400)
  const start=binding(enter.x,'x');if(enter.x2===undefined){if(!start)fail('chart_measure_binding_required',400);measure=start}else{if(mark!=='bar')fail('chart_interval_bar_required',400);const finish=binding(enter.x2,'x');if(!finish)fail('chart_measure_binding_required',400);measure=start??finish;end=start?finish:undefined}
 }
 if(mark==='bar'&&!end&&!numericScale.zero)fail('chart_bar_zero_baseline_required',400)
 if(columns.find(c=>c.id===measure)!.unit!==columns.find(c=>c.id===(end??measure))!.unit)fail('chart_interval_units_mismatch',400)
 let selection:Specification['selection']
 if(input.selection!==undefined){const value=record(input.selection);exactKeys(value,['field','label']);selection={field:field(value.field,'dimension'),label:text(value.label)};if(selection.field!==dimension)fail('chart_selection_dimension_required',400)}
 return {specification:{language,spec,...(selection?{selection}:{})},plan:{mark,dimension,measure,...(end?{end}:{}),scale:numericScale,columns,transforms,...(selection?{selection}:{}),language}}
}
