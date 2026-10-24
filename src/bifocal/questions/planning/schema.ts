import type { PlannerInput } from './types'
const string = { type: 'string' }
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const array = (items: unknown, maxItems: number) => ({ type: 'array', items, maxItems })
const reference = (name: string) => ({ $ref: `#/$defs/${name}` })
export const driverColumns = (input: PlannerInput) => input.model.dimensions.filter(d => /^(region|product|channel|customer)(id|name)?$/.test(d.column.split('.').at(-1)!.toLowerCase().replace(/[ _-]/g, ''))).map(d => d.column)
export function questionSchema(input: PlannerInput): object {
 const dimensions = input.model.dimensions.map(d => d.column), dates = input.model.dimensions.filter(d => d.type === 'date').map(d => d.column), numeric = input.model.dimensions.filter(d => d.type === 'number' || d.type === 'money').map(d => d.column)
 const enumeration = (values: string[]) => ({ type: 'string', enum: values.length ? values : [''] })
 const period = object({ kind: { type: 'string', enum: ['all', 'range', 'quarter-to-date', 'year-to-date', 'last-quarter', 'month', 'last-month'] }, column: enumeration(['', ...dates]), asOf: string, from: string, to: string })
 return {
  ...object({ decision: { type: 'string', enum: ['answer', 'clarify', 'refuse'] }, message: string, missing: array(string, 16), intent: { type: 'string', enum: ['query', 'why'] }, measureIds: array(reference('measure'), 16), groupBy: array(reference('dimension'), 8), filters: array(object({ column: reference('dimension'), op: { type: 'string', enum: ['eq', 'ne', 'in', 'gte', 'lte'] }, value: string, values: array(string, 100) }), 32), period: reference('period'), comparison: { anyOf: [reference('period'), { type: 'null' }] }, drivers: array(reference('driver'), 4), priceVolume: { anyOf: [object({ revenue: reference('numeric'), quantity: reference('numeric'), product: reference('dimension') }), { type: 'null' }] } }),
  $defs: { dimension: enumeration(dimensions), measure: enumeration(input.model.measures.map(m => m.id)), driver: enumeration(driverColumns(input)), numeric: enumeration(numeric), period },
 }
}
