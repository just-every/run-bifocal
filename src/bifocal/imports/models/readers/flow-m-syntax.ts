export type MToken = { value:string; kind:'id'|'text'|'punct'; start:number; end:number; quoted?:boolean }
export function mTokens(source:string):MToken[] {
 const tokens:MToken[]=[]
 for(let i=0;i<source.length;){
  if(/\s/.test(source[i])){i++;continue}
  if(source.slice(i,i+2)==='//'){const end=source.indexOf('\n',i+2);i=end<0?source.length:end;continue}
  if(source.slice(i,i+2)==='/*'){let level=1;i+=2;while(i<source.length&&level){if(source.slice(i,i+2)==='/*'){level++;i+=2}else if(source.slice(i,i+2)==='*/'){level--;i+=2}else i++}if(level)throw Error('Unclosed M comment.');continue}
  const start=i,quoted=source[i]==='#'&&source[i+1]==='"'
  if(source[i]==='"'||quoted){
   i+=quoted?2:1;let value='',closed=false
   while(i<source.length){if(source[i]==='"'){if(source[i+1]==='"'){value+='"';i+=2}else {i++;closed=true;break}}else value+=source[i++]}
   if(!closed)throw Error('Unclosed M string.')
   // Escape sequences require their own semantics; never normalize them silently.
   tokens.push({value,kind:quoted?'id':'text',start,end:i,...quoted?{quoted:true}:{}});continue
  }
  const match=/^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(i))
  if(match){i+=match[0].length;tokens.push({value:match[0],kind:'id',start,end:i})}
  else {i++;tokens.push({value:source[start],kind:'punct',start,end:i})}
  if(tokens.length>20000)throw Error('M token limit exceeded.')
 }
 return tokens
}
export function splitM(tokens:MToken[],separator:string):MToken[][] {
 const parts:MToken[][]=[],stack:string[]=[];let start=0,lets=0
 for(let i=0;i<tokens.length;i++){
  const t=tokens[i],v=t.value
  if(t.kind!=='punct'&&t.kind!=='id')continue
  const nestedIn=t.kind==='id'&&!t.quoted&&v==='in'&&lets>0
  if(t.kind==='id'&&!t.quoted&&v==='let')lets++
  else if(t.kind==='id'&&!t.quoted&&v==='in'&&lets)lets--
  if(t.kind==='punct'&&['(','[','{'].includes(v))stack.push(v)
  else if(t.kind==='punct'&&[')',']','}'].includes(v)){if(stack.pop()!=={')':'(',']':'[','}':'{'}[v])throw Error('Unbalanced M expression.')}
  else if(!stack.length&&!lets&&!nestedIn&&!t.quoted&&v===separator){parts.push(tokens.slice(start,i));start=i+1}
  if(stack.length>64||lets>64)throw Error('M expression nesting limit exceeded.')
 }
 if(stack.length||lets)throw Error('Unbalanced M expression.')
 parts.push(tokens.slice(start));return parts
}
export const mIdentifier=(tokens:MToken[])=>tokens.length===1&&tokens[0].kind==='id'&&!tokens[0].value.includes('#(')?tokens[0].value:null
export function mCall(tokens:MToken[],name:string):MToken[][]|null {
 if(tokens[0]?.kind!=='id'||tokens[0].quoted||tokens[0].value!==name||tokens[1]?.value!=='('||tokens.at(-1)?.value!==')')return null
 try{return splitM(tokens.slice(2,-1),',')}catch{return null}
}
export function mList(tokens:MToken[]):MToken[][]|null {
 if(tokens[0]?.value!=='{'||tokens.at(-1)?.value!=='}')return null
 try{return tokens.length===2?[]:splitM(tokens.slice(1,-1),',')}catch{return null}
}
