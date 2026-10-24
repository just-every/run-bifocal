import type { CalculationExpr, DataType, Order } from '../../calculations/core'
export type FormulaLanguage = 'excel' | 'dax' | 'tableau'
export type TranslationOptions = {
 parameterBindings?:Record<string,{name:string;default:string}>
 fields: Record<string, string>
 measures?: Record<string, CalculationExpr>
 fieldTypes?: Record<string, DataType>
 /** Exact source table bound to the evaluator's current authorized row scope. */
 table?: string
 fiscal?: { dateColumn: string; from: string; to: string; period?: 'year' | 'quarter' }
 window?: { partitionBy: string[]; orderBy: Order[] }
 /** Tableau FIXED runs after source and context filters. Supply them as immutable
  * authorizedRows restrictions; ordinary dimension filters remain removable. */
 fixedContextBound?: boolean
}
export type TranslationIssue = { code: string; message: string; sourceExpression: string }
export type TranslationResult = { sourceExpression: string; targetExpression: CalculationExpr | null; issues: TranslationIssue[] }
export type Syntax =
 | { kind: 'literal'; type: DataType | 'null'; value: string | boolean | null }
 | { kind: 'reference'; name: string; table?: string; source: string }
 | { kind: 'name'; name: string }
 | { kind: 'unary'; op: '-' | 'not'; expression: Syntax }
 | { kind: 'binary'; op: string; left: Syntax; right: Syntax }
 | { kind: 'call'; name: string; args: Syntax[] }
 | { kind: 'fixed'; grain: Syntax[]; expression: Syntax }
export class FormulaProblem extends Error {
 readonly code: string
 constructor(code: string, message: string) { super(message); this.code = code }
}
export function problem(code: string, message: string): never { throw new FormulaProblem(code, message) }
