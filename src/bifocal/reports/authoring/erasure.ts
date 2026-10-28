import {sql} from '../../../modules/import-kit/src/door/store.ts'
const reports='SELECT report_id FROM bf_native_report_revisions WHERE snapshot_id IN (SELECT snapshot_id FROM bf_query_sources WHERE dataset_id=?)'
export const nativeReportErasureCounts=(dataset:string)=>[
 {store:'bf_native_reports',query:sql(`SELECT count(*) FROM bf_native_reports WHERE id IN (${reports})`,dataset)},
 {store:'bf_native_report_revisions',query:sql(`SELECT count(*) FROM bf_native_report_revisions WHERE report_id IN (${reports})`,dataset)},
 {store:'bf_native_report_runs',query:sql(`SELECT count(*) FROM bf_native_report_runs WHERE report_id IN (${reports})`,dataset)},
 {store:'bf_native_report_artifacts',query:sql(`SELECT count(*) FROM bf_native_report_artifacts WHERE run_id IN (SELECT id FROM bf_native_report_runs WHERE report_id IN (${reports}))`,dataset)},
 {store:'bf_native_report_audit',query:sql(`SELECT count(*) FROM bf_native_report_audit WHERE run_id IN (SELECT id FROM bf_native_report_runs WHERE report_id IN (${reports}))`,dataset)}
]
export const eraseNativeReports=(dataset:string)=>sql(`DELETE FROM bf_native_reports WHERE id IN (${reports})`,dataset)

/** Erasing a report also erases its other revisions and their controlled copies. */
export const nativeReportRetentionGuard=(dataset:string)=>sql(`NOT EXISTS(
 SELECT 1 FROM bf_native_report_revisions v
 JOIN bf_query_sources s ON s.snapshot_id=v.snapshot_id
 JOIN bf_source_retention h ON h.dataset_id=s.dataset_id
 WHERE v.report_id IN (${reports})
 AND (h.legal_hold=1 OR h.minimum_retain_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`,dataset)
