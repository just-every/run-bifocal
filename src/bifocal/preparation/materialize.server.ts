import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { fileOwner } from '../imports/files/owner.server'
import type { Table } from '../imports/files/csv'
import { fileDestination } from '../imports/files/targets'
import { sourceMatch } from '../data/snapshots/store'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, type Source } from '../query/types'
import { executePreparation, preparationDatasets, preparationInput } from './execute'
import { preparationOrigin } from './flow.server'

type Owner=NonNullable<Awaited<ReturnType<typeof fileOwner>>>
/** Publish into a new dataset only. No existing source or certified definition
 * is mutable through this door. Every input and saved draft is fenced again. */
export async function materializePreparation(request:Request,env:Bindings,owner:Owner,ownerId:string,id:string,action:string) {
 if(request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['dataset','version','reviewedDigest'])
 if(typeof input.dataset!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(input.dataset))fail('preparation_output_dataset_required',400)
 const dataset=input.dataset
 const row=await env.DB.prepare('SELECT p.version,r.document_json,r.sources_json FROM bf_preparations p JOIN bf_preparation_revisions r ON r.preparation_id=p.id AND r.version=p.version WHERE p.id=? AND p.owner_id=?').bind(id,ownerId).first<{version:number;document_json:string;sources_json:string}>()
 if(!row)fail('preparation_not_found',404)
 if(input.version!==row.version)fail('stale_preparation_version',409)
 const document=preparationInput(JSON.parse(row.document_json)),sources:Source[]=[]
 for(const dataset of preparationDatasets(document)){
  const source=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<Omit<Source,'table'>>()
  if(!source)fail('preparation_source_unavailable',404)
  sources.push({...source,table:JSON.parse(source.value_json)})
 }
 const pins=sources.map(source=>({dataset:source.id,revision:source.revision}))
 if(canonicalJson(pins)!==row.sources_json)fail('preparation_saved_source_changed',409)
 const result=executePreparation(document,sources)
 if(!result.compatible||!result.output)fail('preparation_output_incompatible',409)
 const destination=fileDestination(dataset),retired=sha256(canonicalJson([destination,'file-table',dataset]))
 const available=sql('NOT EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?) AND NOT EXISTS(SELECT 1 FROM ik_d1_erased_targets WHERE destination=? AND identity=?)',dataset,destination,retired)
 if(!await env.DB.prepare(`SELECT 1 WHERE ${available.sql}`).bind(...available.params??[]).first())fail('preparation_output_unavailable',409)
 const digest=sha256(canonicalJson({id,ownerId,version:row.version,dataset,document,pins,output:result.output}))
 const lineageAvailable=sql(`NOT EXISTS(WITH RECURSIVE parents(id) AS (
  SELECT value FROM json_each(?) UNION SELECT p.dataset_id FROM bf_preparation_output_sources p JOIN parents a ON p.output_id=a.id
 ) SELECT 1 FROM parents JOIN bf_preparation_erasing e ON e.dataset_id=parents.id)`,canonicalJson(sources.map(source=>source.id)))
 const guards=[assertion(sql('EXISTS(SELECT 1 FROM bf_preparations p JOIN bf_preparation_revisions r ON r.preparation_id=p.id AND r.version=p.version WHERE p.id=? AND p.owner_id=? AND p.version=? AND r.document_json=? AND r.sources_json=?)',id,ownerId,row.version,row.document_json,row.sources_json)),...sources.map(source=>assertion(sourceMatch(source))),assertion(available),assertion(lineageAvailable),...await preparationOrigin(env,ownerId,document)]
 const value={preparationId:id,version:row.version,dataset,digest,sources:pins,output:result.output,existingDefinitionsChanged:false,execution:'bounded-native',scheduled:false}
 if(action==='publish-review'){await transact(env.DB,owner,guards);return json({...value,published:false})}
 if(input.reviewedDigest!==digest)fail('exact_preparation_output_review_required',409)
 const createdAt=new Date().toISOString(),revision=sha256(canonicalJson({digest,createdAt}))
 const table:Table={columns:result.output.columns,rows:result.output.rows,key:null,source:{filename:'prepared-output.csv',sha256:sha256(canonicalJson(result.output)),delimiter:',',encoding:'utf-8',nullValue:'',formulaTreatment:'literal-text',preparation:{id,version:row.version,digest,lineage:result.output.lineage}},updatedAt:createdAt}
 await transact(env.DB,owner,[...guards,sql('INSERT INTO bf_file_tables(id,value_json,revision) VALUES(?,?,?)',dataset,canonicalJson(table),revision),sql('INSERT INTO bf_preparation_outputs(dataset_id,owner_id,preparation_id,version,digest,lineage_json,created_at) VALUES(?,?,?,?,?,?,?)',dataset,ownerId,id,row.version,digest,canonicalJson(result.output.lineage),createdAt),...pins.map(source=>sql('INSERT INTO bf_preparation_output_sources(output_id,dataset_id,revision) VALUES(?,?,?)',dataset,source.dataset,source.revision))])
 return json({...value,revision,published:true},201)
}

export async function preparationOutput(env:Bindings,dataset:string) {
 const row=await env.DB.prepare('SELECT * FROM bf_preparation_outputs WHERE dataset_id=?').bind(dataset).first<{preparation_id:string;version:number;digest:string;lineage_json:string;created_at:string}>()
 if(!row)return null
 const sources=(await env.DB.prepare(`WITH RECURSIVE parents(dataset,revision) AS (
  SELECT dataset_id,revision FROM bf_preparation_output_sources WHERE output_id=?
  UNION SELECT p.dataset_id,p.revision FROM bf_preparation_output_sources p JOIN parents a ON p.output_id=a.dataset
 ) SELECT p.dataset,p.revision,CASE WHEN f.revision=p.revision AND NOT EXISTS(SELECT 1 FROM bf_preparation_erasing e WHERE e.dataset_id=p.dataset) THEN 1 ELSE 0 END AS current
 FROM parents p LEFT JOIN bf_file_tables f ON f.id=p.dataset ORDER BY p.dataset,p.revision`).bind(dataset).all<{dataset:string;revision:string;current:number}>()).results
 return {preparationId:row.preparation_id,version:row.version,digest:row.digest,lineage:JSON.parse(row.lineage_json),createdAt:row.created_at,sources,current:sources.length>0&&sources.every(source=>source.current===1),immutable:true}
}

/** Parents retain a bounded acyclic graph: each publication has a new identity.
 * The caller uses the ordinary erasure door for every descendant, so originals,
 * models, metrics, reports and saved query copies receive the same withdrawal. */
export async function preparationDescendants(env:Bindings,dataset:string) {
 const rows=(await env.DB.prepare(`WITH RECURSIVE descendants(id) AS (
  SELECT output_id FROM bf_preparation_output_sources WHERE dataset_id=?
  UNION SELECT p.output_id FROM bf_preparation_output_sources p JOIN descendants d ON p.dataset_id=d.id
 ) SELECT id FROM descendants ORDER BY id LIMIT 101`).bind(dataset).all<{id:string}>()).results
 if(rows.length>100)fail('preparation_erasure_limit',413)
 return rows.map(row=>row.id)
}
