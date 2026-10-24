import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Revision, MetricDocument } from '../metrics/store.server'
import { fail } from '../query/types'
/** The scorecard and its metric-change preview use the same dated query. */
export function goalPeriod(rev:Revision,def:{from:string;to:string;dateColumn:string},asOf:string) {
 const cutoff=asOf<def.to?new Date(Date.parse(asOf)+86400000).toISOString().slice(0,10):def.to
 if(cutoff<=def.from)fail('period_not_started',409)
 const through=new Date(Date.parse(cutoff)-86400000).toISOString().slice(0,10)
 const doc=JSON.parse(rev.document_json) as MetricDocument
 doc.query.filters.push({column:def.dateColumn,op:'gte',value:def.from},{column:def.dateColumn,op:'lte',value:through})
 return {cutoff,revision:{...rev,document_json:canonicalJson(doc)}}
}
