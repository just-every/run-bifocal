import { queryReference } from './references'
import { fiscalFilters, validateGrain } from '../models/semantics'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { plus as add, decimal, divide, times as multiply, rational, rounded, type Rational } from '../currency/decimal'
import { fail, type Answer, type Cell, type Context, type Measure, type Query, type Source, type Value } from './types'
import { date as civilDate } from '../calendars/date'
type Row = Record<string, Cell>
type Column = { type: string; alias: string }
const key = canonicalJson
export function execute(query: Query, sources: Source[], context: Context, capture?: (rows: Row[], resolve: (ref: string) => string) => void): Answer {
 const base = sources.find(s => s.id === query.dataset)!, columns = new Map<string, Column>()
 const tableFor = (dataset: string) => sources.find(s => s.id === dataset)!.table
 function register(dataset: string, alias: string) { for (const c of tableFor(dataset).columns) columns.set(`${alias}.${c.name}`, { type: c.type, alias }) }
 register(query.dataset, 'base'); for (const j of query.joins) register(j.dataset, j.as)
 const resolve = (ref: string) => { const normalized = queryReference(ref,columns); if (!columns.has(normalized)) fail('unknown_column'); return normalized }
 const col = (ref: string) => columns.get(resolve(ref))!
 const numeric = (ref: string) => { if (!['number','money'].includes(col(ref).type)) fail('numeric_column_required'); if (col(ref).alias !== 'base') fail('measure_grain_base_required') }
 validateGrain(query,base,columns,resolve)
 const filters = [...query.filters,...fiscalFilters(query,context)]
 if (query.fiscal && col(query.fiscal.column).type !== 'date') fail('fiscal_date_column_required')
 const get = (row: Row, ref: string): Cell => row[resolve(ref)] ?? null
 for (const ref of query.groupBy) resolve(ref)
 for (const f of filters) {
  const type = col(f.column).type
  if (f.op === 'is-null') { if (f.value !== undefined) fail('unexpected_filter_value',400); continue }
  if (['gte','lte'].includes(f.op) && (type === 'boolean' || f.value === null || Array.isArray(f.value) || typeof f.value === 'boolean')) fail('ordered_filter_value_required')
  for (const value of Array.isArray(f.value) ? f.value : [f.value]) {
   if (value === null) continue
   if (type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string') fail('filter_value_type_mismatch')
   try { if (type === 'number' || type === 'money') decimal(value); if (type === 'date') civilDate(value) } catch { fail('filter_value_type_mismatch') }
  }
 }
 for (const m of query.measures) {
  if (m.op === 'sum' || m.op === 'weighted-average') numeric(m.column!)
  if (m.op === 'ratio') { numeric(m.numerator!); numeric(m.denominator!); if (col(m.numerator!).type !== col(m.denominator!).type) fail('ratio_units_mismatch'); if (col(m.numerator!).type === 'money' && !m.sourceCurrency && !m.currencyColumn) fail('money_currency_required') }
  if (m.weight) { numeric(m.weight); if (col(m.weight).type !== 'number') fail('unitless_weight_required') }
  for (const ref of [m.column,m.stateColumn,m.currencyColumn,m.rateDateColumn]) if (ref) resolve(ref)
  if (m.stateColumn && col(m.stateColumn).type !== 'text') fail('state_column_text_required')
  if (m.currencyColumn && col(m.currencyColumn).type !== 'text') fail('currency_column_text_required')
  if (m.rateDateColumn && col(m.rateDateColumn).type !== 'date') fail('rate_date_column_required')
  if (m.unit !== 'money' && [m.column,m.numerator,m.denominator,m.weight].some(ref => ref && col(ref).type === 'money') && m.op !== 'ratio' && m.op !== 'count-distinct' && m.op !== 'count') fail('money_unit_required')
 }
 const makeRow = (cells: unknown[], dataset: string, alias: string): Row => Object.fromEntries(tableFor(dataset).columns.map((c,i) => [`${alias}.${c.name}`, cells[i] as Cell]))
 let rows = base.table.rows.map(r => makeRow(r, query.dataset, 'base'))
 const joinDiagnostics: Answer['joinDiagnostics'] = []
 for (const join of query.joins) {
  const left = resolve(join.left), right = `${join.as}.${join.right}`
  if (columns.get(left)?.alias !== 'base' || !columns.has(right) || columns.get(left)?.type !== columns.get(right)?.type) fail('join_key_type_or_grain_mismatch')
  const joinKey = (value: Cell) => { if (['money','number'].includes(columns.get(right)!.type)) { const v = decimal(value); return key([v.numerator.toString(),v.denominator.toString()]) } return key(value) }
  if (join.cardinality === 'one-to-one') {
   const seen = new Set<string>()
   for (const row of rows) { const value=row[left]; if(value===null) continue; const k=joinKey(value); if(seen.has(k)) fail('one_to_one_left_grain_violated',409); seen.add(k) }
  }
  if(join.effective){
   const effective=join.effective, asOf=resolve(effective.asOf), from=`${join.as}.${effective.from}`, to=`${join.as}.${effective.to}`
   if(columns.get(asOf)?.alias!=='base'||columns.get(asOf)?.type!=='date'||columns.get(from)?.type!=='date'||columns.get(to)?.type!=='date')fail('effective_relationship_date_columns_required')
   const history=new Map<string,Row[]>()
   for(const cells of tableFor(join.dataset).rows){
    const row=makeRow(cells,join.dataset,join.as)
    if(typeof row[from]!=='string'||row[to]!==null&&typeof row[to]!=='string'||row[to]!==null&&String(row[to])<=String(row[from]))fail('invalid_dimension_effective_interval',409)
    if(row[right]===null)continue
    const key=joinKey(row[right]), versions=history.get(key)??[];versions.push(row);history.set(key,versions)
   }
   for(const versions of history.values()){
    versions.sort((a,b)=>String(a[from]).localeCompare(String(b[from])))
    for(let i=1;i<versions.length;i++)if(versions[i-1][to]===null||String(versions[i-1][to])>String(versions[i][from]))fail('overlapping_dimension_history',409)
   }
   let unmatchedRows=0
   const empty=makeRow(tableFor(join.dataset).columns.map(()=>null),join.dataset,join.as)
   rows=rows.map(row=>{const at=row[asOf], match=row[left]===null||at===null?undefined:history.get(joinKey(row[left]))?.find(version=>String(version[from])<=String(at)&&(version[to]===null||String(at)<String(version[to])));if(!match)unmatchedRows++;return {...row,...(match??empty)}})
   joinDiagnostics.push({alias:join.as,duplicateRowsRemoved:0,unmatchedRows})
   continue
  }
  const lookup = new Map<string, Row>(); let duplicateRowsRemoved = 0, unmatchedRows = 0
  for (const cells of tableFor(join.dataset).rows) {
   const row = makeRow(cells,join.dataset,join.as), value = row[right]
   if (value === null) continue
   const k = joinKey(value), existing = lookup.get(k)
   if (existing) { if (join.duplicates !== 'identical' || key(existing) !== key(row)) fail('join_fanout_refused',409); duplicateRowsRemoved++ } else lookup.set(k,row)
  }
  const empty = makeRow(tableFor(join.dataset).columns.map(() => null),join.dataset,join.as)
  rows = rows.map(row => { const match = row[left] === null ? undefined : lookup.get(joinKey(row[left])); if (!match) unmatchedRows++; return { ...row,...(match ?? empty) } })
  joinDiagnostics.push({ alias:join.as, duplicateRowsRemoved, unmatchedRows })
 }
 function compare(a: Cell, b: Cell, ref: string): number {
  if (['money','number'].includes(col(ref).type)) { const x = decimal(a), y = decimal(b), difference = x.numerator * y.denominator - y.numerator * x.denominator; return difference < 0n ? -1 : difference > 0n ? 1 : 0 }
  return a === b ? 0 : String(a) < String(b) ? -1 : 1
 }
 const inputRows = rows.length
 rows = rows.filter(row => filters.every(f => {
  const a = get(row,f.column), b = f.value
  if (f.op === 'is-null') return a === null
  if (f.op === 'in') return (b as Cell[]).some(v => a === null || v === null ? a === v : compare(a,v,f.column) === 0)
  if (f.op === 'eq' || f.op === 'ne') { const equal = a === null || b === null ? a === b : compare(a,b as Cell,f.column) === 0; return f.op === 'eq' ? equal : !equal }
  if (a === null) return false
  const result = compare(a,b as Cell,f.column); return f.op === 'gte' ? result >= 0 : result <= 0
 }))
 capture?.(rows,resolve)
 function aggregate(group: Row[], m: Measure): Value {
  let n = rational(0n), d = rational(0n), nonnull = 0, nulls = 0, excluded = 0
  let state: Value['state'] = 'value'; const rank = { value:0, null:0, incomplete:1, unknown:2, suppressed:3 }
  const seen = new Set<string>()
  const currencyRate = (currency: string, date: Cell): Rational => {
   if (!context.rateSource || typeof date !== 'string') fail('dated_rate_source_required')
   const def = context.rateSource.definition
   if (currency === def.baseCurrency) return rational(1n)
   const matches = def.rates.filter(r => r.currency === currency && r.date === date)
   if (matches.length !== 1) fail('exact_dated_rate_unavailable')
   const rate = decimal(matches[0].rate); if (rate.numerator <= 0n) fail('invalid_currency_rate'); return rate
  }
  function value(row: Row, ref: string): Rational { let amount = decimal(get(row,ref))
   if (m.unit === 'money' || (m.op === 'ratio' && (col(m.numerator!).type === 'money' || m.sourceCurrency || m.currencyColumn))) {
    const currency = m.currencyColumn ? get(row,m.currencyColumn) : m.sourceCurrency
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) fail('unknown_source_currency')
    if (currency !== context.currency) { const date = m.rateDateColumn ? get(row,m.rateDateColumn) : null; amount = multiply(divide(amount,currencyRate(currency,date)),currencyRate(context.currency,date)) }
   }
   return amount
  }
  for (const row of group) {
   if (m.stateColumn) {
    const quality = get(row,m.stateColumn)
    if (quality !== null && quality !== 'value' && quality !== 'unknown' && quality !== 'suppressed' && quality !== 'incomplete') fail('invalid_value_state')
    if (quality && quality !== 'value') { if (rank[quality] > rank[state]) state = quality; excluded++; continue }
   }
   const refs = m.op === 'ratio' ? [m.numerator!,m.denominator!] : m.op === 'weighted-average' ? [m.column!,m.weight!] : m.column ? [m.column] : []
   if (refs.some(ref => get(row,ref) === null)) { nulls++; continue }
   nonnull++
   if (m.op === 'count') n = add(n,rational(1n))
   else if (m.op === 'count-distinct') { const raw = get(row,m.column!); const k = ['number','money'].includes(col(m.column!).type) ? key({n:decimal(raw).numerator.toString(),d:decimal(raw).denominator.toString()}) : key(raw); seen.add(k) }
   else if (m.op === 'sum') n = add(n,value(row,m.column!))
   else if (m.op === 'ratio') { n = add(n,value(row,m.numerator!)); d = add(d,value(row,m.denominator!)) }
   else { const weight = decimal(get(row,m.weight!)); if (weight.numerator < 0n) fail('negative_weight_refused'); n = add(n,multiply(value(row,m.column!),weight)); d = add(d,weight) }
  }
  const result = (s: Value['state'], exact: Rational | null, reason?: string): Value => ({ state:s, value:exact && s === 'value' ? rounded(exact,m.scale,query.context.rounding) : null, exact:exact && s === 'value' ? {numerator:exact.numerator.toString(),denominator:exact.denominator.toString()} : null,unit:m.unit,nulls,excluded,...(reason ? {reason} : {}) })
  if (state !== 'value') return result(state,null,'Source value state prevents a complete numerical answer.')
  if (m.op === 'count-distinct') n = rational(BigInt(seen.size))
  if (!nonnull && !['count','count-distinct'].includes(m.op)) return m.empty==='zero'?result('value',rational(0n)):result('null',null)
  if (m.op === 'ratio' || m.op === 'weighted-average') { if (!d.numerator) return result('unknown',null,'zero_denominator'); n = divide(n,d) }
  if (m.unit === 'percent') n = multiply(n,rational(100n))
  return result('value',n)
 }
 const values = (group: Row[]) => Object.fromEntries(query.measures.map(m => [m.id,aggregate(group,m)]))
 const groups = new Map<string,{dimensions:Cell[];rows:Row[]}>()
 for (const row of rows) { const dimensions = query.groupBy.map(ref => get(row,ref)), k = key(dimensions.map((v,i)=> { if (v !== null && ['number','money'].includes(col(query.groupBy[i]).type)) { const x=decimal(v); return {numeric:[x.numerator.toString(),x.denominator.toString()]} } return v })), group = groups.get(k); if (group) group.rows.push(row); else groups.set(k,{dimensions,rows:[row]}) }
 if (!query.groupBy.length && !groups.size) groups.set('[]',{dimensions:[],rows:[]})
 return { rows:[...groups.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,g])=>({dimensions:g.dimensions,values:values(g.rows)})), totals:values(rows),inputRows,filteredRows:rows.length,joinDiagnostics,commonSnapshot:sources.length === 1 ? 'single-source' : 'unavailable',certification:'unavailable',definitionHash:sha256(canonicalJson(query)),semanticsVersion:'exact-v1',sourceWatermarks:[...sources].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(s=>({dataset:s.id,revision:s.revision,updatedAt:s.table.updatedAt,sha256:sha256(s.value_json)})) }
}
