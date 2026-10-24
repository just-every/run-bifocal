import { issue, name, objects, physical, provenance, tableName, unknownKeys, yaml } from './common'
import type { Dimension, ModelTable, Project, ProjectFile } from './types'

function column(value: unknown): string|null {
 if (typeof value !== 'string') return null
 return physical(value.replace(/^\{CUBE\}\./,'').replace(/^\{CUBE\.([A-Za-z_][A-Za-z0-9_$]*)\}$/,'$1'))
}
export function readCube(p: Project, files: ProjectFile[]) {
 for (const file of files) {
  const at=provenance(file,file.content)
  if (!/\.ya?ml$/i.test(file.path)) { issue(p,at,file.path,'cube_yaml_only','Only Cube YAML is read. JavaScript is never evaluated.'); continue }
  const root=yaml(p,file); if(!root)continue
  unknownKeys(p,at,file.path,root,['cubes'])
  for(const cube of objects(p,at,'cubes',root.cubes)) {
   const loc=provenance(file,cube), n=name(p,loc,cube.name,'cube');if(!n)continue
   unknownKeys(p,loc,n,cube,['name','sql_table','description','title','dimensions','measures','joins'])
   const sourceTable=tableName(cube.sql_table)
   if(!sourceTable)issue(p,loc,n,'physical_table_required','Use sql_table with a physical table reference; SQL and dynamic table expressions require implementation.',cube.sql_table)
   const table:ModelTable={...loc,name:n,sourceTable,dimensions:[],measures:[]};p.tables.push(table)
   const explore={...loc,name:n,table:n,joins:[] as import('./types').ModelJoin[]};p.explores.push(explore)
   for(const dimension of objects(p,loc,`${n}.dimensions`,cube.dimensions)) {
    const d=provenance(file,dimension), field=name(p,d,dimension.name,`${n}.dimension`);if(!field)continue
    unknownKeys(p,d,`${n}.${field}`,dimension,['name','sql','type','primary_key','description','title'])
    const col=column(dimension.sql), type=({string:'text',number:'number',boolean:'boolean'} as Record<string,Dimension['type']>)[String(dimension.type)]
    if(!col||!type){issue(p,d,`${n}.${field}`,'unsupported_dimension','Only physical string, number and boolean dimensions map directly; time dimensions need explicit timestamp handling.');continue}
    if(dimension.primary_key!==undefined&&typeof dimension.primary_key!=='boolean')issue(p,d,`${n}.${field}`,'invalid_primary_key','primary_key must be boolean.',dimension.primary_key)
    table.dimensions.push({...d,name:field,column:col,type,sourceType:String(dimension.type),primaryKey:dimension.primary_key===true,sourceExpression:String(dimension.sql)})
   }
   for(const measure of objects(p,loc,`${n}.measures`,cube.measures)) {
    const m=provenance(file,measure), field=name(p,m,measure.name,`${n}.measure`);if(!field)continue
    unknownKeys(p,m,`${n}.${field}`,measure,['name','sql','type','description','title'])
    const op=measure.type==='count'?'count':measure.type==='sum'?'sum':measure.type==='count_distinct'?'count-distinct':null
    const col=column(measure.sql)
    if(!op||op!=='count'&&!col){issue(p,m,`${n}.${field}`,'unsupported_measure','Only count, sum and count_distinct are translated; non-count measures need physical columns.');continue}
    // Cube ignores sql for count; native row count preserves that behavior.
    table.measures.push({...m,name:field,op,...(op!=='count'?{column:col!}:{}),sourceExpression:measure.sql===undefined?'count':String(measure.sql)})
   }
   for(const join of objects(p,loc,`${n}.joins`,cube.joins)) {
    const j=provenance(file,join), target=name(p,j,join.name,`${n}.join`);if(!target)continue
    unknownKeys(p,j,`${n}.${target}`,join,['name','relationship','sql'])
    const match=typeof join.sql==='string'?/^\{CUBE\.([A-Za-z_][A-Za-z0-9_$]*)\}\s*=\s*\{([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_$]*)\}$/.exec(join.sql.trim()):null
    const alternate=typeof join.sql==='string'?/^\{CUBE\}\.([A-Za-z_][A-Za-z0-9_$]*)\s*=\s*\{([A-Za-z_][A-Za-z0-9_]*)\}\.([A-Za-z_][A-Za-z0-9_$]*)$/.exec(join.sql.trim()):null
    const refs=match??alternate, cardinality=join.relationship==='many_to_one'?'many-to-one':join.relationship==='one_to_one'?'one-to-one':null
    if(!refs||refs[2]!==target||!cardinality){issue(p,j,`${n}.${target}`,'unsupported_join','Use a single base-to-target column equality and many_to_one or one_to_one; other joins require implementation.');continue}
    explore.joins.push({...j,name:target,table:target,left:refs[1],right:refs[3],cardinality,sourceExpression:String(join.sql)})
   }
  }
 }
}
