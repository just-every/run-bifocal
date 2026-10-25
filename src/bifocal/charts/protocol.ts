import { exactKeys } from '../models/validation/transport'
import { queryInput } from '../query/validate'
import { fail, type Query } from '../query/types'

export type Visual = {kind:'bar';dimension:string;measure:string}
export type ChartDocument = {version:1;title:string;definition:Query;visual:Visual}
function object(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('chart_document_required',400)
 return value as Record<string,unknown>
}
export function chartDocument(value:unknown):ChartDocument {
 const document=object(value);exactKeys(document,['version','title','definition','visual'])
 if(document.version!==1||typeof document.title!=='string'||!document.title.trim()||document.title.length>160||/[\u0000-\u001f]/.test(document.title))fail('chart_title_required',400)
 const definition=queryInput(document.definition),visual=object(document.visual)
 exactKeys(visual,['kind','dimension','measure'])
 if(visual.kind!=='bar'||typeof visual.dimension!=='string'||definition.groupBy.length!==1||definition.groupBy[0]!==visual.dimension||typeof visual.measure!=='string'||!definition.measures.some(measure=>measure.id===visual.measure))fail('chart_requires_one_dimension_and_known_measure',400)
 return {version:1,title:document.title.trim(),definition,visual:{kind:'bar',dimension:visual.dimension,measure:visual.measure}}
}
