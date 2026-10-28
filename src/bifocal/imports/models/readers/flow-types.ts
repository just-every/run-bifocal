import type { ProjectResource } from './types'

export type FlowLocation = { file:string; start:number; end:number; line:number; column:number; pointer?:string }
export type FlowStep = {
 id:string; name:string; dependencies:string[]; sourceExpression:string; location:FlowLocation
 operation:'source'|'cast'|'dedupe'|'identity'|'unsupported'; nativeSteps:Record<string,unknown>[]
 sourceSchema?:{name:string;type:string}[]
 code?:string; message?:string
}
export type FlowDefinition = { format:'powerquery'|'tableau-prep'; steps:FlowStep[]; output:string|null; errors:{code:string;message:string}[] }
export type FlowResource = ProjectResource & { kind:'preparation-flow'; definition:FlowDefinition & Record<string,unknown> }
export function flowLocation(file:string,content:string,start:number,end:number,pointer?:string):FlowLocation {
 const prefix=content.slice(0,start),line=prefix.split('\n').length,column=start-prefix.lastIndexOf('\n')
 return {file,start,end,line,column,...pointer===undefined?{}:{pointer}}
}
