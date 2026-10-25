import {exactKeys} from '../models/validation/transport'
import {queryInput} from '../query/validate'
import {fail,type Query} from '../query/types'
export type SnapshotDocument={version:1;title:string;definition:Query}|{version:1;title:string;cards:Query[]}
export function snapshotDocument(value:unknown):SnapshotDocument {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('dashboard_document_required',400)
 const input=value as Record<string,unknown>;exactKeys(input,['version','title','definition','cards'])
 if(input.version!==1||typeof input.title!=='string'||!input.title.trim()||input.title.length>160)fail('dashboard_title_required',400)
 const title=input.title.trim()
 if(input.cards!==undefined){
  if(input.definition!==undefined||!Array.isArray(input.cards)||input.cards.length<2||input.cards.length>4)fail('dashboard_requires_two_to_four_definitions',400)
  return {version:1,title,cards:input.cards.map(queryInput)}
 }
 return {version:1,title,definition:queryInput(input.definition)}
}
export const documentQueries=(document:SnapshotDocument)=>'cards' in document?document.cards:[document.definition]
