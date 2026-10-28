import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { decimal } from '../../currency/decimal.ts'
import type { Snapshot } from '../../data/snapshots/store.ts'
import { encodePdf } from '../../dashboards/snapshots/pdf.ts'
import { execute } from '../../query/execute.ts'
import { fail, type Cell, type Query, type Source, type Value } from '../../query/types.ts'
import { validateDefinition } from './definition.ts'
import { boundedBytes, encodeNativeCsv, encodeNativeXlsx } from './formats.ts'
import { paginateReport, type ReportSection } from './layout.ts'
import { NATIVE_REPORT_LIMITS, type NativeReportCell, type NativeReportColumn, type NativeReportDefinition, type NativeReportGroup, type NativeReportManifest, type NativeReportRender, type NativeReportRow } from './types.ts'

export type { NativeReportDefinition, NativeReportManifest, NativeReportRender } from './types.ts'
function retainedSources(snapshot: Snapshot, sources: Source[]): void {
 const {digest, ...content} = snapshot
 if (digest !== sha256(canonicalJson(content)) || snapshot.context.ownerId !== snapshot.context.securityScope.ownerId) fail('native_report_snapshot_integrity_failed', 409)
 const expected = [...new Set([snapshot.definition.dataset, ...snapshot.definition.joins.map(join => join.dataset)])].sort()
 if (canonicalJson(expected) !== canonicalJson(sources.map(source => source.id).sort())) fail('native_report_source_integrity_failed', 409)
 for (const source of sources) {
  const watermark = snapshot.answer.sourceWatermarks.find(value => value.dataset === source.id)
  if (!watermark || watermark.revision !== source.revision || watermark.sha256 !== sha256(source.value_json) || canonicalJson(source.table) !== canonicalJson(JSON.parse(source.value_json))) fail('native_report_source_integrity_failed', 409)
 }
}
const show = (value: Cell) => value === null ? 'NULL' : String(value)
const labelCell = (value: string): NativeReportCell => ({type: 'text', value, display: value})
const valueCell = (value: Value): NativeReportCell => value.state === 'value'
 ? {type: value.unit === 'money' ? 'money' : 'number', value: value.value, display: String(value.value) + (value.unit === 'percent' ? ' %' : '')}
 : {type: 'text', value: value.state === 'null' ? null : value.state.toUpperCase(), display: value.state.toUpperCase()}

/** Recompute every aggregation from retained native sources and frozen context. */
export function renderNativeReport(input: NativeReportDefinition, snapshot: Snapshot, sources: Source[]): NativeReportRender {
 const definition = validateDefinition(input, snapshot)
 retainedSources(snapshot, sources)
 const query: Query = {...snapshot.definition, filters: [...snapshot.definition.filters, ...definition.parameters.map(parameter => ({column: parameter.column, op: 'eq' as const, value: parameter.value}))]}
 const answer = execute(query, sources, snapshot.context)
 if (answer.rows.length > NATIVE_REPORT_LIMITS.resultRows) fail('native_report_result_row_limit')
 const dimensionColumns: NativeReportColumn[] = query.groupBy.map(name => {
  const alias = name.includes('.') ? name.slice(0, name.indexOf('.')) : 'base', local = name.includes('.') ? name.slice(name.indexOf('.') + 1) : name
  const dataset = alias === 'base' ? query.dataset : query.joins.find(join => join.as === alias)?.dataset
  const column = sources.find(source => source.id === dataset)?.table.columns.find(column => column.name === local)
  if (!column) fail('native_report_dimension_unavailable', 409)
  return {name, type: column.type}
 })
 const columns: NativeReportColumn[] = [{name: 'Row type', type: 'text'}, ...dimensionColumns, ...query.measures.map(measure => ({name: measure.id, type: measure.unit === 'money' ? 'money' as const : 'number' as const, unit: measure.unit, scale: measure.scale}))]
 const row = (kind: NativeReportRow['kind'], dimensions: Cell[], values: Record<string, Value>): NativeReportRow => ({kind, cells: [labelCell(kind === 'detail' ? 'Detail' : kind === 'subtotal' ? 'Subtotal' : 'Grand total'), ...dimensions.map((value, index) => ({type: dimensionColumns[index].type, value, display: show(value)})), ...query.measures.map(measure => valueCell(values[measure.id]))]})
 const sections: ReportSection[] = [], groups: NativeReportGroup[] = []
 if (definition.groupBy !== null) {
  const groupIndex = query.groupBy.indexOf(definition.groupBy), groupType = dimensionColumns[groupIndex].type
  const key = (value: Cell) => {
   if (value !== null && (groupType === 'number' || groupType === 'money')) { const exact = decimal(value); return canonicalJson([exact.numerator.toString(), exact.denominator.toString()]) }
   return canonicalJson(value)
  }
  const grouped = execute({...query, groupBy: query.groupBy.slice(groupIndex, groupIndex + 1)}, sources, snapshot.context)
  const details = new Map<string, typeof answer.rows>()
  for (const detail of answer.rows) { const identity = key(detail.dimensions[groupIndex]), current = details.get(identity) ?? []; current.push(detail); details.set(identity, current) }
  for (const group of grouped.rows) {
   const members = details.get(key(group.dimensions[0])) ?? []
   const dimensions = query.groupBy.map((_, index) => index === groupIndex ? group.dimensions[0] : null)
   groups.push({value: group.dimensions[0], values: group.values, rowCount: members.length})
   sections.push({label: definition.groupBy + ' = ' + show(group.dimensions[0]), rows: [...members.map(detail => row('detail', detail.dimensions, detail.values)), row('subtotal', dimensions, group.values)]})
  }
 } else sections.push({label: null, rows: answer.rows.map(detail => row('detail', detail.dimensions, detail.values))})
 const grand = execute({...query, groupBy: []}, sources, snapshot.context).rows[0].values
 sections.push({label: null, rows: [row('grand-total', query.groupBy.map(() => null), grand)]})
 const pages = paginateReport(definition, columns, sections)
 const manifest: NativeReportManifest = {
  version: 1, definition, definitionDigest: sha256(canonicalJson(definition)),
  snapshot: {queryId: snapshot.queryId, snapshotId: snapshot.snapshotId, digest: snapshot.digest, createdAt: snapshot.createdAt},
  query, context: snapshot.context, sourceWatermarks: answer.sourceWatermarks, answer: {...answer, totals: grand}, groups,
  columns, rows: sections.flatMap(section => section.rows), pageCount: pages.length, pageSize: {width: 612, height: 792},
 }
 const xlsx = encodeNativeXlsx(definition, columns, manifest.rows, manifest), csv = encodeNativeCsv(columns, manifest.rows)
 const pdf = boundedBytes(encodePdf({pages, provenance: manifest, exportedAt: snapshot.createdAt, backLink: '', pageSize: manifest.pageSize}), 'pdf')
 return {manifest, pdf, xlsx, csv, pages}
}
