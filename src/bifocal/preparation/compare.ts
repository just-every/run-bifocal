import type { Frame, Preparation } from './execute'
import { preparationDatasets } from './execute'
import type { Source, Cell } from '../query/types'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { preparationDecimal, exactDecimal } from './decimal'
import { date } from '../calendars/date'

export type SourceStepOutput={flow:string;step:string;columns:Frame['columns'];rows:Cell[][];ordered:boolean;sources:{dataset:string;revision:string}[]}
export type StepComparison={state:'not-supplied'|'matched'|'different'|'invalid';reason?:string;schemaEqual?:boolean;multisetEqual?:boolean;orderEqual?:boolean;ordered?:boolean;sourceRows?:number;nativeRows?:number}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const only=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k))
export function sourceStepOutputs(value:unknown):SourceStepOutput[]{
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>512)throw Error('Supply a bounded array of source step outputs.')
 const seen=new Set<string>()
 for(const row of value){
  if(!record(row)||!only(row,['flow','step','columns','rows','ordered','sources'])||typeof row.flow!=='string'||typeof row.step!=='string'||!row.flow||!row.step||typeof row.ordered!=='boolean'||!Array.isArray(row.columns)||!row.columns.length||row.columns.length>64||!Array.isArray(row.rows)||row.rows.length>10000||!Array.isArray(row.sources)||!row.sources.length||row.sources.length>100)throw Error('Each source output needs a named flow and step, complete typed rows, ordered flag and exact dataset revisions.')
  const columns=row.columns
  if(columns.some(c=>!record(c)||!only(c,['name','type'])||typeof c.name!=='string'||!c.name||!['text','number','money','date','boolean'].includes(String(c.type)))||new Set(columns.map(c=>c.name)).size!==columns.length)throw Error('Source output columns require unique names and native types.')
  for(const cells of row.rows){
   if(!Array.isArray(cells)||cells.length!==columns.length)throw Error('Source output rows must contain every typed column.')
   for(const [i,cell] of cells.entries()){
    if(cell===null)continue
    const type=columns[i].type
    if(type==='boolean'){if(typeof cell!=='boolean')throw Error('Boolean source cells must be booleans.');continue}
    if(typeof cell!=='string'||cell.length>10000)throw Error('Nonboolean source cells require exact text or decimal strings.')
    if(type==='number'||type==='money')preparationDecimal(cell)
    if(type==='date'&&date(cell)!==cell)throw Error('Source dates require canonical calendar values.')
   }
  }
  if(row.sources.some(s=>!record(s)||!only(s,['dataset','revision'])||typeof s.dataset!=='string'||typeof s.revision!=='string'||!s.dataset||!s.revision)||new Set(row.sources.map(s=>s.dataset)).size!==row.sources.length)throw Error('Source output revisions must identify every dataset exactly once.')
  const key=canonicalJson([row.flow,row.step]);if(seen.has(key))throw Error('Duplicate source step output.');seen.add(key)
 }
 return value as SourceStepOutput[]
}
export function compareSourceStep(output:Frame,document:Preparation,sources:Source[],reference:SourceStepOutput|undefined):StepComparison {
 if(!reference)return {state:'not-supplied'}
 const pins=preparationDatasets(document).map(dataset=>({dataset,revision:sources.find(s=>s.id===dataset)!.revision})).sort((a,b)=>a.dataset.localeCompare(b.dataset)),expectedPins=[...reference.sources].sort((a,b)=>a.dataset.localeCompare(b.dataset))
 if(canonicalJson(pins)!==canonicalJson(expectedPins))return {state:'invalid',reason:'The supplied source output does not identify this exact complete source snapshot.'}
 const schemaEqual=canonicalJson(reference.columns)===canonicalJson(output.columns)
 if(!schemaEqual)return {state:'different',schemaEqual:false,multisetEqual:false,orderEqual:false,ordered:reference.ordered,sourceRows:reference.rows.length,nativeRows:output.rows.length}
 const keys=(rows:Cell[][])=>rows.map(row=>canonicalJson(row.map((v,i)=>v!==null&&['number','money'].includes(output.columns[i].type)?exactDecimal(preparationDecimal(v)):v)))
 const native=keys(output.rows),original=keys(reference.rows),orderEqual=canonicalJson(native)===canonicalJson(original),multisetEqual=canonicalJson([...native].sort())===canonicalJson([...original].sort())
 return {state:multisetEqual&&(!reference.ordered||orderEqual)?'matched':'different',schemaEqual,multisetEqual,orderEqual,ordered:reference.ordered,sourceRows:original.length,nativeRows:native.length}
}
