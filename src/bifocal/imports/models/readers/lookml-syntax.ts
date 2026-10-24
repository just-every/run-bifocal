export type LookNode = { key: string; value: string; children: LookNode[]|null; raw: string }
/** Consume all input, including unsupported blocks. SQL terminators are read
 * outside quoted strings so braces and substitution references stay opaque. */
export function parseLookML(source: string): LookNode[] {
 let i=0,count=0
 const skip=()=>{while(i<source.length){if(/\s/.test(source[i]))i++;else if(source[i]==='#'){while(i<source.length&&source[i]!=='\n')i++}else break}}
 const quoted=()=>{const quote=source[i++];while(i<source.length){if(source[i]==='\\'){i+=2;continue}if(source[i++]===quote)return}throw Error('unterminated quote')}
 const scalar=(start:number)=>{const raw=source.slice(start,i).trim();if(raw.startsWith('"')){try{return JSON.parse(raw) as string}catch{throw Error('invalid quoted value')}}return raw}
 function nodes(depth:number, block:boolean):LookNode[] {
  if(depth>32)throw Error('nesting limit')
  const result:LookNode[]=[]
  while(true){
   skip();if(i>=source.length){if(block)throw Error('unclosed block');return result}
   if(source[i]==='}'){if(!block)throw Error('unexpected close');i++;return result}
   if(++count>10000)throw Error('node limit')
   const start=i, match=/^[+A-Za-z_][A-Za-z0-9_+-]*/.exec(source.slice(i));if(!match)throw Error('property required')
   const key=match[0];i+=key.length;skip();if(source[i++]!==':')throw Error('colon required');skip()
   const valueStart=i
   if(key==='sql'||key.startsWith('sql_')||key==='html'||key==='expression'){
    let ended=false
    while(i<source.length){if(source[i]==='"'||source[i]==="'"){quoted();continue}if(source.slice(i,i+2)===';;'){ended=true;break}i++}
    if(!ended)throw Error('SQL terminator required')
    const value=source.slice(valueStart,i).trim();i+=2;result.push({key,value,children:null,raw:source.slice(start,i)});continue
   }
   let brackets=0,children:LookNode[]|null=null
   while(i<source.length){
    const c=source[i]
    if(c==='"'||c==="'"){quoted();continue}
    if(c==='['){brackets++;i++;continue}if(c===']'){if(--brackets<0)throw Error('unexpected bracket');i++;continue}
    if(!brackets&&c==='{'){const value=scalar(valueStart);i++;children=nodes(depth+1,true);result.push({key,value,children,raw:source.slice(start,i)});break}
    if(!brackets&&(c==='}'||/^[+A-Za-z_][A-Za-z0-9_+-]*\s*:/.test(source.slice(i))))break
    if(c==='#'&&!brackets)break
    i++
   }
   if(brackets)throw Error('unclosed list')
   if(children===null)result.push({key,value:scalar(valueStart),children:null,raw:source.slice(start,i)})
  }
 }
 return nodes(0,false)
}
