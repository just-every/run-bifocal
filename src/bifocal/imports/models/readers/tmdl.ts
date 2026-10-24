import { issue } from './common'
import { declaration, parseTMDL, tmdlName, type TMDLNode } from './tmdl-syntax'
import type { Dimension, Project, ProjectFile, Provenance } from './types'

function property(node:TMDLNode):{key:string;value:string}|null {
 const m=/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(node.head)
 return m?{key:m[1].toLowerCase(),value:m[2]}:null
}
function reference(value:string):{table:string;column:string}|null {
 const match=/^('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)\.('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)$/.exec(value.trim())
 return match?{table:tmdlName(match[1])!,column:tmdlName(match[2])!}:null
}
export function readTMDL(p:Project,files:ProjectFile[]){
 const relationships:{node:TMDLNode;at:Provenance}[]=[]
 const fieldDeclarations=new Set<string>()
 for(const file of files){
  const at={file:file.path,sourceExpression:file.content};if(!/\.tmdl$/i.test(file.path)){issue(p,at,file.path,'tmdl_file_required','Supply textual TMDL files.');continue}
  let roots:TMDLNode[];try{roots=parseTMDL(file.content)}catch{issue(p,at,file.path,'invalid_tmdl','Malformed, mixed or excessive indentation or unterminated expression.');continue}
  for(const root of roots){
   const loc={file:file.path,sourceExpression:root.raw}
   if(/^relationship\s/i.test(root.head)){relationships.push({node:root,at:loc});continue}
   const header=declaration(root.head,'table')??(/^ref table /i.test(root.head)?declaration(root.head.slice(4),'table'):null)
   if(!header||header.expression!==null){issue(p,loc,`line ${root.line}`,'unsupported_tmdl_object','Implement this root object or property before importing it.');continue}
   let table=p.tables.find(t=>t.name===header.name)
   if(!table){table={...loc,name:header.name,sourceTable:null,dimensions:[],measures:[]};p.tables.push(table);p.explores.push({...loc,name:header.name,table:header.name,joins:[]});issue(p,loc,header.name,'source_table_binding','TMDL table names are logical; map the source partition to a reviewed physical dataset before execution.')}
   for(const node of root.children){
    const source={file:file.path,sourceExpression:node.raw},column=declaration(node.head,'column'),measure=declaration(node.head,'measure')
    if(!column&&!measure){issue(p,source,header.name,'unsupported_table_property','Partitions, hierarchies, annotations and other properties need explicit translation.');continue}
    const declared=column??measure!,object=`${header.name}.${declared.name}`
    if(fieldDeclarations.has(object))issue(p,source,object,'duplicate_field','Resolve duplicate fields across partial table declarations.');fieldDeclarations.add(object)
    const props=new Map<string,string>(),expressionNodes:TMDLNode[]=[]
    for(const child of node.children){
     const prop=property(child)
     if(!prop){expressionNodes.push(child);continue}
     if(props.has(prop.key))issue(p,source,`${object}.${prop.key}`,'duplicate_property','Resolve repeated TMDL property.',child.raw)
     props.set(prop.key,prop.value)
     const allowed=column?['datatype','sourcecolumn']:[]
     if(!allowed.includes(prop.key)||child.children.length)issue(p,source,`${object}.${prop.key}`,'unsupported_property','Implement this TMDL property, including format and visibility behavior, before importing.',child.raw)
    }
    if(column){
     if(column.expression!==null||expressionNodes.length){issue(p,source,object,'calculated_column','Calculated columns require DAX expression translation.');continue}
     const type=({string:'text',int64:'number',double:'number',decimal:'number',boolean:'boolean'} as Record<string,Dimension['type']>)[props.get('datatype')??'']
     const physical=props.get('sourcecolumn')
     if(!type||!physical||physical.length>200||/^["']|[\u0000-\u001f]/.test(physical)){issue(p,source,object,'physical_column_required','Declare an unquoted sourceColumn and a supported dataType; quoted property strings and dateTime need explicit mapping.');continue}
     table.dimensions.push({...source,name:column.name,column:physical,type,sourceType:props.get('datatype')!,primaryKey:false,sourceExpression:physical})
    }else{
     const expression=[measure!.expression??'',...expressionNodes.map(n=>n.raw)].join('\n').trim()
     const match=/^(SUM|COUNT|DISTINCTCOUNT)\s*\(\s*(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)\s*)?\[((?:[^\]]|\]\])+)\]\s*\)$/i.exec(expression)
     if(!match){issue(p,source,object,'unsupported_dax','Translate this DAX expression; only SUM, COUNT and DISTINCTCOUNT of one physical column are recognized.',expression);continue}
     const op=match[1].toUpperCase()==='SUM'?'sum':match[1].toUpperCase()==='COUNT'?'count':'count-distinct',sourceTable=match[2]?tmdlName(match[2])!:header.name
     table.measures.push({...source,name:measure!.name,op,column:match[3].replace(/\]\]/g,']'),sourceTable,sourceExpression:expression,...(op!=='sum'?{sourceSemantics:op==='count'?'dax-count-empty-is-blank':'dax-distinctcount-includes-blank-empty-is-blank'}:{})})
     if(op!=='sum')issue(p,{...source,sourceExpression:expression},object,'dax_blank_semantics','Preserve DAX BLANK on empty count; DISTINCTCOUNT also counts BLANK. Native count operations require explicit adaptation.')
    }
   }
  }
 }
 // DAX references name model columns. Resolve only after all partial files.
 for(const table of p.tables)for(const m of table.measures){
  const target=p.tables.find(t=>t.name===m.sourceTable),dimension=target?.dimensions.find(d=>d.name===m.column)
  if(!dimension)issue(p,m,`${table.name}.${m.name}`,'unresolved_dax_column','Include the referenced model column with a physical sourceColumn.')
  else {m.column=dimension.column;if(m.op==='sum'&&dimension.type!=='number'&&dimension.type!=='money'||m.op==='count'&&dimension.type==='boolean')issue(p,m,`${table.name}.${m.name}`,'invalid_dax_column_type','The declared model column type is incompatible with this aggregate.')}
 }
 for(const {node,at} of relationships){
  const values=new Map<string,string>()
  for(const child of node.children){const prop=property(child);if(!prop||!['fromcolumn','tocolumn','fromcardinality','tocardinality','crossfilteringbehavior','isactive'].includes(prop.key)||child.children.length){issue(p,at,node.head,'unsupported_relationship_property','Implement this relationship property.',child.raw);continue}if(values.has(prop.key))issue(p,at,node.head,'duplicate_property','Resolve repeated relationship property.',child.raw);values.set(prop.key,prop.value)}
  const from=reference(values.get('fromcolumn')??''),to=reference(values.get('tocolumn')??'')
  const fromCard=values.get('fromcardinality')?.toLowerCase(),toCard=values.get('tocardinality')?.toLowerCase()
  if(!from||!to||!['many','one'].includes(fromCard??'')||toCard!=='one'||values.get('crossfilteringbehavior')?.toLowerCase()!=='onedirection'||values.get('isactive')?.toLowerCase()!=='true'){issue(p,at,node.head,'unsupported_relationship','Declare an active one-direction relationship with explicit many-to-one or one-to-one cardinality.');continue}
  const left=p.tables.find(t=>t.name===from.table)?.dimensions.find(d=>d.name===from.column),right=p.tables.find(t=>t.name===to.table)?.dimensions.find(d=>d.name===to.column),explore=p.explores.find(e=>e.table===from.table)
  if(!left||!right||!explore){issue(p,at,node.head,'unresolved_relationship_column','Include the physical columns of both relationship endpoints.');continue}
  explore.joins.push({...at,name:to.table,table:to.table,left:left.column,right:right.column,cardinality:fromCard==='one'?'one-to-one':'many-to-one'})
 }
}
