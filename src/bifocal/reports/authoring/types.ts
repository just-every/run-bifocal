import type { Snapshot } from '../../data/snapshots/store.ts'
import type { PrintableSnapshot } from '../../dashboards/snapshots/scene.ts'
import type { Column } from '../../imports/files/csv.ts'
import type { Answer, Cell, Query, Value } from '../../query/types.ts'

export type NativeReportDefinition = {
 version: 1
 title: string
 header: string
 footer: string
 queryId: string
 groupBy: string | null
 pageBreakGroups: boolean
 parameters: { column: string; value: Cell }[]
}
export type NativeReportColumn = { name: string; type: Column['type']; unit?: Value['unit']; scale?: number }
export type NativeReportCell = { type: Column['type']; value: Cell; display: string }
export type NativeReportRow = { kind: 'detail' | 'subtotal' | 'grand-total'; cells: NativeReportCell[] }
export type NativeReportGroup = { value: Cell; values: Record<string, Value>; rowCount: number }
export type NativeReportManifest = {
 version: 1
 definition: NativeReportDefinition
 definitionDigest: string
 snapshot: Pick<Snapshot, 'queryId' | 'snapshotId' | 'digest' | 'createdAt'>
 query: Query
 context: Snapshot['context']
 sourceWatermarks: Answer['sourceWatermarks']
 answer: Answer
 groups: NativeReportGroup[]
 columns: NativeReportColumn[]
 rows: NativeReportRow[]
 pageCount: number
 pageSize: { width: 612; height: 792 }
}
export type NativeReportRender = {
 manifest: NativeReportManifest
 pdf: Uint8Array
 xlsx: Uint8Array
 csv: Uint8Array
 pages: PrintableSnapshot['pages']
}
export const NATIVE_REPORT_LIMITS = { resultRows: 2000, pages: 20, bytes: 2 * 1024 * 1024 } as const
