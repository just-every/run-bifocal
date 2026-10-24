import { issue, physical, tableName } from './common'
import { parseLookML, type LookNode } from './lookml-syntax'
import type { Dimension, ModelTable, Project, ProjectFile, Provenance } from './types'

export function readLookML(p:Project, files:ProjectFile[]) {
 const roots:{file:ProjectFile;nodes:LookNode[]}[]=[]
 for(const file of files){
  const at={file:file.path,sourceExpression:file.content}
  if(!/\.lkml$/i.test(file.path)){issue(p,at,file.path,'lookml_file_required','Supply LookML text files; other project assets need explicit translation.');continue}
  try{roots.push({file,nodes:parseLookML(file.content)})}catch{issue(p,at,file.path,'invalid_lookml','Malformed or excessive LookML syntax; nothing in this file was translated.')}
 }
 function properties(at:Provenance,object:string,nodes:LookNode[],allowed:string[],repeat:string[]=[]){
  const seen=new Set<string>()
  for(const node of nodes){if(!allowed.includes(node.key))issue(p,at,`${object}.${node.key}`,'unsupported_property',`Implement LookML ${node.key}.`,node.raw);if(node.children&&!['view','explore','dimension','measure','join'].includes(node.key))issue(p,at,`${object}.${node.key}`,'unexpected_block','This property requires a scalar, not a block.',node.raw);if(seen.has(node.key)&&!repeat.includes(node.key))issue(p,at,`${object}.${node.key}`,'duplicate_property','Resolve repeated property.',node.raw);seen.add(node.key)}
  return (key:string)=>nodes.find(n=>n.key===key)?.value
 }
 function col(sql:string|undefined,table:ModelTable):string|null {
  if(!sql)return null
  const direct=/^\$\{TABLE\}\.([A-Za-z_][A-Za-z0-9_$]*)$/.exec(sql.trim());if(direct)return direct[1]
  const ref=/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(sql.trim())
  return ref?table.dimensions.find(d=>d.name===ref[1])?.column??null:null
 }
 for(const {file,nodes} of roots){
  const at={file:file.path,sourceExpression:file.content}
  properties(at,file.path,nodes,['view','explore','include','connection'],['view','explore','include'])
  for(const node of nodes){
   if(node.key==='include'){
    const pattern=node.value.replace(/^\//,'')
    if(!pattern||pattern.includes('..')||/[\[\]{}]/.test(pattern)){issue(p,at,'include','unsupported_include','Use a relative file glob; list and dynamic includes require implementation.',node.raw);continue}
    const regex=new RegExp('^'+pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$')
    if(!files.some(f=>regex.test(f.path)))issue(p,at,'include','missing_include','Include at least one file matching this project include.',node.raw)
   }
   if(node.key!=='view')continue
   const loc={file:file.path,sourceExpression:node.raw}
   if(!physical(node.value)||!node.children){issue(p,loc,node.value||'view','invalid_view','Expected a named view block.');continue}
   const get=properties(loc,node.value,node.children,['sql_table_name','dimension','measure','label','description'],['dimension','measure'])
   const sourceTable=tableName(get('sql_table_name'))
   if(!sourceTable)issue(p,loc,node.value,'physical_table_required','An explicit physical sql_table_name is required; derived tables and dialect quoting need implementation.',get('sql_table_name'))
   const table:ModelTable={...loc,name:node.value,sourceTable,dimensions:[],measures:[]};p.tables.push(table)
   for(const field of node.children.filter(n=>n.key==='dimension')){
    const d={file:file.path,sourceExpression:field.raw}
    if(!physical(field.value)||!field.children){issue(p,d,`${table.name}.${field.value}`,'invalid_dimension','Expected a named dimension block.');continue}
    const get=properties(d,`${table.name}.${field.value}`,field.children,['type','sql','primary_key','label','description'])
    const type=({string:'text',number:'number',yesno:'boolean',date:'date'} as Record<string,Dimension['type']>)[get('type')??'string'], column=col(get('sql'),table)
    if(!type||!column){issue(p,d,`${table.name}.${field.value}`,'unsupported_dimension','Implement this dimension type or SQL expression; only physical-column dimensions are supported.');continue}
    if(get('primary_key')!==undefined&&!['yes','no'].includes(get('primary_key')!))issue(p,d,field.value,'invalid_primary_key','primary_key must be yes or no.')
    table.dimensions.push({...d,name:field.value,column,type,sourceType:get('type')??'string',primaryKey:get('primary_key')==='yes',sourceExpression:get('sql')!})
   }
   for(const field of node.children.filter(n=>n.key==='measure')){
    const m={file:file.path,sourceExpression:field.raw}
    if(!physical(field.value)||!field.children){issue(p,m,`${table.name}.${field.value}`,'invalid_measure','Expected a named measure block.');continue}
    const get=properties(m,`${table.name}.${field.value}`,field.children,['type','sql','label','description'])
    const op=get('type')==='sum'?'sum':get('type')==='count_distinct'?'count-distinct':get('type')==='count'?'count':null,column=col(get('sql'),table)
    if(!op||op!=='count'&&!column){issue(p,m,`${table.name}.${field.value}`,'unsupported_measure','Implement this expression or aggregation; sum and count_distinct need physical columns.');continue}
    if(op==='count'&&get('sql')!==undefined)issue(p,m,`${table.name}.${field.value}`,'count_sql_requires_review','Custom SQL on a count measure needs source-semantic verification; it is not mapped to native count(column).',get('sql'))
    table.measures.push({...m,name:field.value,op,...(op==='sum'?{empty:'zero' as const}:{}),...(op!=='count'?{column:column!}:{}),sourceExpression:get('sql')??'count'})
   }
  }
 }
 for(const {file,nodes} of roots)for(const node of nodes.filter(n=>n.key==='explore')){
  const loc={file:file.path,sourceExpression:node.raw}
  if(!physical(node.value)||!node.children){issue(p,loc,node.value||'explore','invalid_explore','Expected a named explore block.');continue}
  const get=properties(loc,node.value,node.children,['from','join','label','description'],['join']),table=get('from')??node.value
  const explore={...loc,name:node.value,table,joins:[] as import('./types').ModelJoin[]};p.explores.push(explore)
  for(const join of node.children.filter(n=>n.key==='join')){
   const j={file:file.path,sourceExpression:join.raw}
   if(!physical(join.value)||!join.children){issue(p,j,join.value||'join','invalid_join','Expected a named join block.');continue}
   const get=properties(j,`${node.value}.${join.value}`,join.children,['from','type','relationship','sql_on']),target=get('from')??join.value
   const eq=/^\$\{([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\}\s*=\s*\$\{([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(get('sql_on')??'')
   const cardinality=get('relationship')==='many_to_one'?'many-to-one':get('relationship')==='one_to_one'?'one-to-one':null
   if(!eq||![table,node.value].includes(eq[1])||eq[3]!==join.value||!cardinality||get('type')!==undefined&&get('type')!=='left_outer'){issue(p,j,`${node.value}.${join.value}`,'unsupported_join','Use an explicit many_to_one or one_to_one left join with one base-field equals joined-field predicate.');continue}
   const left=p.tables.find(t=>t.name===table)?.dimensions.find(d=>d.name===eq[2])?.column,right=p.tables.find(t=>t.name===target)?.dimensions.find(d=>d.name===eq[4])?.column
   if(!left||!right){issue(p,j,`${node.value}.${join.value}`,'unresolved_join_field','Include both physical-column dimensions referenced by sql_on.');continue}
   explore.joins.push({...j,name:join.value,table:target,left,right,cardinality,sourceExpression:get('sql_on')!})
  }
 }
}
