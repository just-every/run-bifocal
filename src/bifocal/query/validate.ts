import { fail, type Query } from './types'
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v)
const ref = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) fail('unsupported_query_field', 400) }
export function queryInput(v: unknown): Query {
 if (!obj(v)) fail('query_object_required', 400)
 keys(v, ['version','dataset','joins','filters','groupBy','measures','context'])
 if (v.version !== 1 || !id(v.dataset) || !Array.isArray(v.joins) || v.joins.length > 2 || !Array.isArray(v.filters) || v.filters.length > 20 || !Array.isArray(v.groupBy) || v.groupBy.length > 4 || !v.groupBy.every(ref) || new Set(v.groupBy).size !== v.groupBy.length || !Array.isArray(v.measures) || !v.measures.length || v.measures.length > 12 || !obj(v.context)) fail('invalid_query_shape', 400)
 const aliases = new Set(['base'])
 for (const j of v.joins) {
  if (!obj(j)) fail('invalid_join', 400)
  keys(j, ['dataset','as','left','right','duplicates'])
  if (!id(j.dataset) || !id(j.as) || aliases.has(j.as) || !ref(j.left) || !ref(j.right) || !['reject','identical'].includes(String(j.duplicates))) fail('invalid_join', 400)
  aliases.add(j.as)
 }
 for (const f of v.filters) {
  if (!obj(f)) fail('invalid_filter', 400)
  keys(f,['column','op','value'])
  const cell = (x: unknown) => x === null || typeof x === 'boolean' || (typeof x === 'string' && x.length <= 4096)
  if (!ref(f.column) || !['eq','ne','in','gte','lte','is-null'].includes(String(f.op)) || (f.op === 'in' ? !Array.isArray(f.value) || f.value.length > 100 || !f.value.every(cell) : f.op !== 'is-null' && !cell(f.value))) fail('invalid_filter', 400)
 }
 const names = new Set<string>()
 for (const m of v.measures) {
  if (!obj(m)) fail('invalid_measure', 400)
  keys(m,['id','op','column','numerator','denominator','weight','unit','scale','stateColumn','sourceCurrency','currencyColumn','rateDateColumn'])
  if (!id(m.id) || names.has(m.id) || !['sum','count','count-distinct','ratio','weighted-average'].includes(String(m.op)) || !['money','number','count','percent'].includes(String(m.unit)) || !Number.isInteger(m.scale) || Number(m.scale) < 0 || Number(m.scale) > 12) fail('invalid_measure',400)
  names.add(m.id)
  for (const field of ['column','numerator','denominator','weight','stateColumn','currencyColumn','rateDateColumn']) if (m[field] !== undefined && !ref(m[field])) fail('invalid_measure_column',400)
  if ((['sum','count-distinct','weighted-average'].includes(String(m.op)) && !m.column) || (m.op === 'ratio' && (!m.numerator || !m.denominator)) || (m.op === 'weighted-average' && !m.weight) || (m.sourceCurrency !== undefined && (typeof m.sourceCurrency !== 'string' || !/^[A-Z]{3}$/.test(m.sourceCurrency)))) fail('incomplete_measure',400)
  if (m.unit === 'money' && ((!m.sourceCurrency && !m.currencyColumn) || !['sum','weighted-average'].includes(String(m.op)))) fail('money_currency_required',400)
  if (['count','count-distinct'].includes(String(m.op)) && (m.unit !== 'count' || m.scale !== 0)) fail('count_unit_required',400)
  if (m.unit === 'percent' && m.op !== 'ratio') fail('percentage_requires_ratio',400)
  if (m.op === 'ratio' && !['number','percent'].includes(String(m.unit))) fail('ratio_unit_required',400)
  if ((m.op === 'ratio' && (m.column !== undefined || m.weight !== undefined)) || (m.op !== 'ratio' && (m.numerator !== undefined || m.denominator !== undefined)) || (m.op !== 'weighted-average' && m.weight !== undefined)) fail('measure_operand_mismatch',400)
  if (m.sourceCurrency !== undefined && m.currencyColumn !== undefined) fail('ambiguous_source_currency',400)
  if (m.unit !== 'money' && m.op !== 'ratio' && (m.sourceCurrency !== undefined || m.currencyColumn !== undefined || m.rateDateColumn !== undefined)) fail('currency_unit_mismatch',400)
 }
 const c = v.context; keys(c,['modelVersion','metricVersion','accountingBasis','calendar','rateSource','rounding'])
 const version = (x: unknown) => typeof x === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(x)
 const resource = (x: unknown) => obj(x) && Object.keys(x).every(k => ['id','version'].includes(k)) && id(x.id) && Number.isSafeInteger(x.version) && Number(x.version)>0
 if (!version(c.modelVersion) || !version(c.metricVersion) || !['cash','accrual','not-applicable'].includes(String(c.accountingBasis)) || !resource(c.calendar) || (c.rateSource !== undefined && !resource(c.rateSource)) || !['half-even','half-away-from-zero'].includes(String(c.rounding))) fail('invalid_query_context',400)
 return v as unknown as Query
}
