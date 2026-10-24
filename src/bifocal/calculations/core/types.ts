export type DataType = 'number' | 'text' | 'date' | 'boolean'
export type Schema = Record<string, DataType>
export type ExactNumber={type:'number';numerator:string;denominator:string}
export type InputCell = string | boolean | null | ExactNumber
export type InputRow = Readonly<Record<string, InputCell>>
export type CalculationValue =
 | { type: 'null'; reason?: 'zero_denominator' | 'empty_input' | 'window_total' | 'fixed_total' | 'missing_offset' }
 | { type: 'number'; numerator: string; denominator: string }
 | { type: 'text' | 'date'; value: string }
 | { type: 'boolean'; value: boolean }
export type Literal = { kind: 'literal'; type: DataType | 'null'; value: InputCell }
export type AggregateOp = 'sum' | 'count' | 'count-distinct' | 'avg' | 'min' | 'max'
export type BinaryOp = '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'and' | 'or'
export type FunctionName = 'if' | 'coalesce' | 'is-null' | 'abs' | 'year' | 'month' | 'day' | 'date-add-days' | 'date-add-months' | 'date-add-years' | 'date-diff-days'
export type Order = ({ field: string } | { expression: CalculationExpr }) & { direction: 'asc' | 'desc'; nulls: 'first' | 'last' }
export type CalculationExpr =
 | Literal
 | { kind: 'field'; field: string }
 | { kind: 'parameter'; name: string }
 | { kind: 'selected-measure' }
 | { kind: 'unary'; op: '-' | 'not'; expression: CalculationExpr }
 | { kind: 'binary'; op: BinaryOp; left: CalculationExpr; right: CalculationExpr }
 | { kind: 'call'; fn: FunctionName; args: CalculationExpr[] }
 | { kind: 'aggregate'; op: AggregateOp; expression?: CalculationExpr }
 | { kind: 'calculate'; expression: CalculationExpr; removeFilters: string[]; filters: CalculationFilter[] }
 | { kind: 'fixed'; grain: string[]; expression: CalculationExpr; filters: 'retain-user' | 'ignore-user'; totals?: 'recompute' | 'null' }
 | { kind: 'window'; op: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'rank' | 'dense-rank' | 'row-number' | 'lag' | 'lead'; expression: CalculationExpr; partitionBy: string[]; orderBy: Order[]; preceding?: number | 'unbounded'; following?: number; offset?: number }
 | { kind: 'percent-of-total'; expression: CalculationExpr; partitionBy: string[] }
export type CalculationFilter = { field: string; op: 'eq' | 'ne' | 'in' | 'gte' | 'lte' | 'is-null'; value?: InputCell | InputCell[] }
export type CalculationMeasure = { id: string; expression: CalculationExpr; format?: string }
export type CalculationGroup = { id: string; precedence: number; expression: CalculationExpr; format?: string }
export type CalculationRequest = {
 /** Already authorized rows only. Nothing in the AST can replace or widen this set. */
 authorizedRows: readonly InputRow[]
 schema: Schema
 filters: CalculationFilter[]
 groupBy: string[]
 measures: CalculationMeasure[]
 parameters?: Record<string, Literal>
 calculationGroups?: CalculationGroup[]
}
export type CalculationAnswer = {
 rows: { dimensions: InputCell[]; values: Record<string, CalculationValue> }[]
 totals: Record<string, CalculationValue>
 formats: Record<string, string | null>
 inputRows: number
 filteredRows: number
 semantics: typeof CALCULATION_SEMANTICS
}
export const CALCULATION_SEMANTICS = {
 version: 'calculation-exact-v1',
 nulls: 'propagate; aggregate ignores null; count counts nonnull; count without expression counts rows; empty sum, avg, min and max null; empty count zero',
 divideByZero: 'null with zero_denominator reason',
 comparison: 'null operand gives null; if treats null condition as false; filters explicitly match null',
 totals: 'recompute expression over filtered authorized rows; never sum displayed ratios; windows at total return null',
 security: 'authorizedRows is immutable; calculate removes only named user filters and group coordinates; fixed changes grain and optionally ignores user filters',
 windows: 'visible grouped results; explicit partition and order; stable group-key tiebreak; ROWS frames inclusive; rank peers use declared order only',
 fixed: 'evaluate at declared grain; ambiguous non-total outer grain refuses; aggregate(fixed) evaluates per input row; grand total recomputes at all grains unless totals:null',
 groups: 'higher precedence is outermost; ties rejected; highest precedence format override wins; format is metadata only',
 dates: 'ISO civil dates; month and year shifts clamp day to destination month; calendar and fiscal windows require explicit filters supplied by caller',
} as const
export class CalculationError extends Error {
 constructor(public code: string, public path = '') { super(path ? `${code}: ${path}` : code) }
}
export function reject(code: string, path = ''): never { throw new CalculationError(code, path) }
