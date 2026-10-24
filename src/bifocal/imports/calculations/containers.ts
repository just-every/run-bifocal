import type { TranslationIssue, TranslationOptions, TranslationResult } from './types'
export type ContainerCalculation = TranslationResult & {
 name: string
 table?: string
 kind: 'measure' | 'calculation-item' | 'calculated-field'
 format?: string
 group?: { id: string; precedence: number | null }
 origin: { container: 'tmdl' | 'tableau-twb'; line?: number; sourceObject: string }
 metadata: Record<string, string>
}
export type CalculationContainer = { sourceExpression: string; calculations: ContainerCalculation[]; issues: TranslationIssue[]; dependencies: { kind: string; name: string; sourceExpression: string }[] }
export type ContainerOptions = TranslationOptions | ((item: { name: string; table?: string; kind: ContainerCalculation['kind'] }) => TranslationOptions)
export const optionsFor = (options: ContainerOptions, item: { name: string; table?: string; kind: ContainerCalculation['kind'] }) => typeof options === 'function' ? options(item) : options
export function containerIssue(result: CalculationContainer, code: string, message: string, sourceExpression: string) { result.issues.push({ code, message, sourceExpression }) }
