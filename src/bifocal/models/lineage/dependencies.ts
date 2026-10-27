import { queryReference } from '../../query/references'
import type { Query } from '../../query/types'

/** Resolve source identities using the executable query's alias semantics. */
export type DependencySchema={dataset:string;columns:string[]}
export function queryDependencies(query:Query,schemas:DependencySchema[]) {
 const references=new Map<string,{dataset:string;column:string}>()
 for(const {dataset,as} of [{dataset:query.dataset,as:'base'},...query.joins])for(const column of schemas.find(source=>source.dataset===dataset)?.columns??[])references.set(as+'.'+column,{dataset,column})
 const dependencies=new Map<string,Set<string>>()
 const add=(dataset:string,column:string)=>{const columns=dependencies.get(dataset)??new Set<string>();columns.add(column);dependencies.set(dataset,columns)}
 const column=(name:unknown)=>{
  if(typeof name!=='string')return
  const physical=references.get(queryReference(name,references))
  if(physical)add(physical.dataset,physical.column)
 }
 dependencies.set(query.dataset,new Set())
 for(const join of query.joins){column(join.left);add(join.dataset,join.right);if(join.effective){column(join.effective.asOf);add(join.dataset,join.effective.from);add(join.dataset,join.effective.to)}}
 for(const name of query.groupBy)column(name)
 for(const filter of query.filters)column(filter.column)
 for(const measure of query.measures)for(const key of ['column','numerator','denominator','weight','stateColumn','currencyColumn','rateDateColumn'] as const)column(measure[key])
 if(query.fiscal)column(query.fiscal.column)
 if(query.semantic){for(const name of query.semantic.grain)column(name);for(const dimension of query.semantic.dimensions)column(dimension.column)}
 return [...dependencies].map(([dataset,columns])=>({dataset,columns:[...columns].sort()})).sort((a,b)=>a.dataset.localeCompare(b.dataset))
}
