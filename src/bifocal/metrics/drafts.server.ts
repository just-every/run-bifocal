import type {Bindings} from '../../auth.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {sourceMatch} from '../data/snapshots/store'
import type {fileOwner} from '../imports/files/owner.server'
import {fail,QueryError} from '../query/types'
import {metricDefinition,metricGuard,metricValue,revision,type MetricRow,type Revision} from './store.server'

/** Native authoring and public tools share compilation and atomic revision guards. */
export async function prepareMetricDraft(env:Bindings,ownerId:string,id:string,value:unknown,previous:unknown) {
 const old=await env.DB.prepare('SELECT * FROM bf_metrics WHERE id=? AND owner_id=?').bind(id,ownerId).first<MetricRow>()
 if(old?.deprecated_at)fail('metric_deprecated',409)
 if(previous!==(old?.head_revision??null))fail('stale_metric_revision',409)
 const definition=metricDefinition(value),n=(old?.head_revision??0)+1,encoded=canonicalJson(definition),digest=sha256(encoded)
 const row:MetricRow={id,owner_id:ownerId,head_revision:n,published_revision:null,deprecated_at:null,deprecated_by:null,deprecated_reason:null}
 const draft:Revision={metric_id:id,revision:n,dataset_id:definition.query.dataset,document_json:encoded,digest,created_at:'',approved_at:null,annotation:null}
 const evaluation=await metricValue(env,ownerId,row,draft)
 const guards=[old?metricGuard(old):sql('NOT EXISTS(SELECT 1 FROM bf_metrics WHERE id=?)',id),...evaluation.sources.map(sourceMatch),...evaluation.context.guards??[]]
 let before:unknown=null
 if(old){
  const head=(await revision(env,id,old.head_revision))!
  try{
   const prior=await metricValue(env,ownerId,old,head)
   guards.push(...prior.sources.map(sourceMatch),...prior.context.guards??[])
   before={definition:prior.doc,value:prior.value,revision:head.revision}
  }catch(error){if(!(error instanceof QueryError))throw error;before={definition:JSON.parse(head.document_json),value:null,revision:head.revision,error:error.code}}
 }
 const document={version:1,id,definition},reviewDigest=sha256(canonicalJson({ownerId,kind:'metric-definition',document,previousRevision:previous,guards}))
 return {id,ownerId,old,n,encoded,digest,guards,review:{document,previousRevision:previous,digest:reviewDigest,before,after:{definition,value:evaluation.value,revision:n},productionSends:0,sourceWrites:0}}
}
export async function saveMetricDraft(env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,prepared:Awaited<ReturnType<typeof prepareMetricDraft>>) {
 const {id,ownerId,old,n,encoded,digest,guards,review}=prepared
 await transact(env.DB,owner,[...guards.map(assertion),old?sql('UPDATE bf_metrics SET head_revision=? WHERE id=?',n,id):sql('INSERT INTO bf_metrics(id,owner_id,head_revision) VALUES(?,?,?)',id,ownerId,n),sql('INSERT INTO bf_metric_revisions(metric_id,revision,dataset_id,document_json,digest,created_at) VALUES(?,?,?,?,?,?)',id,n,review.document.definition.query.dataset,encoded,digest,new Date().toISOString())])
 return {id,revision:n,digest,state:'draft'}
}
