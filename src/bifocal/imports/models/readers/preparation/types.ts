import type { ProjectFile } from '../types'

/** Parsed source data only. Operations are from Bifocal's closed preparation
 * vocabulary; no expression is evaluated by the reader. */
export type FlowStep = {
 id: string
 name: string
 file: string
 location: string
 sourceExpression: string
 dependencies: string[]
 binding?: string
 operations?: Record<string, unknown>[]
 reason?: string
 parameter?: { value: string | number | boolean | null; type: string }
 metadata?: Record<string, unknown>
}
export type SourceFlow = {
 id: string
 name: string
 file: string
 result: string
 steps: FlowStep[]
 metadata?: Record<string, unknown>
}
export type FlowFile = ProjectFile
export type PreparationFormat = 'powerquery' | 'dataflow-gen1' | 'dataflow-gen2' | 'prep'
