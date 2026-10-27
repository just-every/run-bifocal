import type { Bindings } from '../../../auth.server'
import type { Table } from '../../imports/files/csv'
import type { DependencySchema } from './dependencies'

/** Retained answers resolve against their own original physical schemas. */
export async function dependencySchemas(env:Bindings,snapshotId?:string):Promise<DependencySchema[]> {
 const rows=snapshotId
  ?(await env.DB.prepare('SELECT dataset_id AS dataset,value_json FROM bf_query_sources WHERE snapshot_id=?').bind(snapshotId).all<{dataset:string;value_json:string}>()).results
  :(await env.DB.prepare('SELECT id AS dataset,value_json FROM bf_file_tables').all<{dataset:string;value_json:string}>()).results
 return rows.map(row=>({dataset:row.dataset,columns:(JSON.parse(row.value_json) as Table).columns.map(column=>column.name)}))
}
