export type JSONSpan={start:number;end:number;pointer:string}
/** Strict data-only JSON with duplicate-key refusal and exact source spans. */
export function flowJSON(content:string) {
 const spans=new Map<string,JSONSpan>();let at=0,count=0
 const whitespace=()=>{while(/\s/.test(content[at]??'')&&at<content.length)at++}
 function string():string {
  const start=at++;while(at<content.length){if(content[at]==='\\'){at+=2;continue}if(content[at++]==='"')return JSON.parse(content.slice(start,at)) as string}
  throw Error('Unclosed JSON string.')
 }
 function value(pointer:string,depth:number):unknown {
  whitespace();const start=at
  if(depth>64||++count>20000)throw Error('Flow JSON structure exceeds its bounds.')
  let result:unknown
  if(content[at]==='{'){
   at++;whitespace();const fields:Record<string,unknown>=Object.create(null),keys=new Set<string>()
   if(content[at]!=='}')while(true){
    whitespace();if(content[at]!=='"')throw Error('Expected a JSON object key.')
    const key=string();if(keys.has(key))throw Error('Duplicate JSON keys are refused.');keys.add(key)
    whitespace();if(content[at++]!==':')throw Error('Expected a JSON value.')
    fields[key]=value(pointer+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);whitespace()
    if(content[at]!==',')break;at++
   }
   if(content[at++]!=='}')throw Error('Expected a closed JSON object.');result=fields
  }else if(content[at]==='['){
   at++;whitespace();const items:unknown[]=[]
   if(content[at]!==']')while(true){items.push(value(pointer+'/'+items.length,depth+1));whitespace();if(content[at]!==',')break;at++}
   if(content[at++]!==']')throw Error('Expected a closed JSON array.');result=items
  }else if(content[at]==='"')result=string()
  else {const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(content.slice(at));if(!token)throw Error('Expected a JSON literal.');at+=token[0].length;result=JSON.parse(token[0])}
  spans.set(pointer,{start,end:at,pointer});return result
 }
 const document=value('',0);whitespace();if(at!==content.length)throw Error('Unexpected trailing JSON content.')
 return {document,spans}
}
