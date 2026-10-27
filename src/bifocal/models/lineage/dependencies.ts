import type { Query } from '../../query/types'

/** Resolve source identities using the executable query's alias semantics. */
export function queryDependencies(query:Query) {
 const dependencies=new Map<string,Set<string>>()
 const add=(dataset:string,column:string)=>{const columns=dependencies.get(dataset)??new Set<string>();columns.add(column);dependencies.set(dataset,columns)}
 const column=(name:unknown)=>{
  if(typeof name!=='string')return
  const at=name.indexOf('.'),join=at<0?null:query.joins.find(j=>j.as===name.slice(0,at))
  if(join)add(join.dataset,name.slice(at+1));else add(query.dataset,name.startsWith('base.')?name.slice(5):name)
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
