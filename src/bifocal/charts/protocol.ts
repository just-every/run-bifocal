import { exactKeys } from '../models/validation/transport'
import { queryInput } from '../query/validate'
import { fail, type Query } from '../query/types'
import { compileSpecification, type Specification } from './declarative'
import {nativeKinds,nativeOptions,type NativeKind,type NativeOptions} from './native'

export type Visual = {dimension:string;measure:string} & ({kind:'bar';specification?:Specification}|({kind:NativeKind;specification?:never}&NativeOptions))
export type ChartDocument = {version:1;title:string;definition:Query;visual:Visual}
function object(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('chart_document_required',400)
 return value as Record<string,unknown>
}
export function chartDocument(value:unknown):ChartDocument {
 const document=object(value);exactKeys(document,['version','title','definition','visual'])
 if(document.version!==1||typeof document.title!=='string'||!document.title.trim()||document.title.length>160||/[\u0000-\u001f]/.test(document.title))fail('chart_title_required',400)
 const definition=queryInput(document.definition),visual=object(document.visual)
 exactKeys(visual,visual.kind==='bar'?['kind','dimension','measure','specification']:['kind','dimension','measure','order','missing','scale','selection'])
 if(visual.kind!=='bar'&&!nativeKinds.includes(String(visual.kind))||typeof visual.dimension!=='string'||definition.groupBy.length!==1||definition.groupBy[0]!==visual.dimension||typeof visual.measure!=='string'||!definition.measures.some(measure=>measure.id===visual.measure))fail('chart_requires_one_dimension_and_known_measure',400)
 if(visual.kind!=='bar')return {version:1,title:document.title.trim(),definition,visual:{kind:visual.kind as NativeKind,dimension:visual.dimension as string,measure:visual.measure as string,...nativeOptions(visual,definition)}}
 const specification=visual.specification===undefined?undefined:compileSpecification(visual.specification,definition).specification
 return {version:1,title:document.title.trim(),definition,visual:{kind:'bar',dimension:visual.dimension,measure:visual.measure,...(specification?{specification}:{})}}
}
