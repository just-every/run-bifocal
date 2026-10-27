import type { Filter, Measure } from '../../../query/types'

export type ProjectFormat = 'lookml' | 'dbt' | 'metricflow' | 'tmdl' | 'pbip' | 'cube' | 'metabase' | 'tableau' | 'powerquery' | 'dataflow-gen1' | 'dataflow-gen2' | 'prep'
export type ProjectFile = { path: string; content: string }
export type Provenance = { file: string; sourceExpression: string }
export type Dimension = Provenance & {
 name: string; column: string; type: 'text'|'number'|'money'|'date'|'boolean'|'unknown'; sourceType: string; primaryKey: boolean
}
export type ModelMeasure = Provenance & {
 name: string; op: Measure['op']; empty?:'zero'|'null'; column?: string; sourceTable?: string; sourceSemantics?: string
}
export type ModelTable = Provenance & { name: string; sourceTable: string|null; dimensions: Dimension[]; measures: ModelMeasure[] }
export type ModelJoin = Provenance & { name: string; table: string; left: string; right: string; cardinality: 'many-to-one'|'one-to-one' }
export type Explore = Provenance & { name: string; table: string; joins: ModelJoin[]; filters?: Filter[]; boundFilters?: Filter[]; groupBy?: string[] }
export type ReadIssue = Provenance & { object: string; code: string; message: string }
/** Issues are unresolved obligations, never compatibility successes. Binding,
 * source execution and publication belong to the caller, not these readers. */
export type ProjectResource = Provenance & {
 id: string; name: string; kind: string; dependencies: string[]; definition: Record<string, unknown>
}
export type Project = { format: ProjectFormat; tables: ModelTable[]; explores: Explore[]; issues: ReadIssue[]; resources?: ProjectResource[] }
