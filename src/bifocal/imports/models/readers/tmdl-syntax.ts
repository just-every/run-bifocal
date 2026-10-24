export type TMDLNode = { head: string; children: TMDLNode[]; raw: string; line: number }
/** Indentation establishes ownership; expressions remain data. Unsupported
 * expression languages and properties survive in each node's original text. */
export function parseTMDL(source:string):TMDLNode[] {
 const lines=source.replace(/\r\n/g,'\n').split('\n'), roots:TMDLNode[]=[]
 const stack:{indent:number;node:TMDLNode}[]=[], styles=new Set<string>()
 let nodes=0
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim()||line.trimStart().startsWith('///'))continue
  const prefix=/^[\t ]*/.exec(line)![0]
  if(prefix.includes('\t')&&prefix.includes(' '))throw Error('mixed indentation')
  if(prefix)styles.add(prefix.includes('\t')?'tab':'space');if(styles.size>1)throw Error('mixed indentation style')
  const indent=prefix.replace(/\t/g,'    ').length
  if(indent>256||++nodes>10000)throw Error('node bound')
  while(stack.length&&stack[stack.length-1].indent>=indent)stack.pop()
  if(stack.length>32)throw Error('depth bound')
  const node:TMDLNode={head:line.slice(prefix.length),children:[],raw:line.slice(prefix.length),line:i+1}
  if(stack.length)stack[stack.length-1].node.children.push(node);else if(indent)throw Error('orphan indentation');else roots.push(node)
  stack.push({indent,node})
  if(/=\s*```\s*$/.test(node.head)){
   const body:string[]=[];let closed=false
   for(i++;i<lines.length;i++){if(lines[i].trim()==='```'){closed=true;break}body.push(lines[i])}
   if(!closed)throw Error('unclosed expression')
   node.head=node.head.replace(/```\s*$/,'')+'\n'+body.join('\n');node.raw+='\n'+body.join('\n')+'\n```'
  }
 }
 const collect=(node:TMDLNode):string=>{for(const child of node.children)collect(child);node.raw=[node.raw,...node.children.map(c=>c.raw)].join('\n');return node.raw}
 roots.forEach(collect);return roots
}

export function tmdlName(value:string):string|null {
 const v=value.trim()
 if(/^'(?:[^']|'')+'$/.test(v))return v.slice(1,-1).replace(/''/g,"'")
 return /^[A-Za-z_][A-Za-z0-9_]*$/.test(v)?v:null
}
export function declaration(head:string,kind:string):{name:string;expression:string|null}|null {
 if(head.slice(0,kind.length+1).toLowerCase()!==kind.toLowerCase()+' ')return null
 const body=head.slice(kind.length+1), match=/^('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*([\s\S]*))?$/.exec(body)
 const name=match?tmdlName(match[1]):null
 return name&&match?{name,expression:match[2]??null}:null
}
