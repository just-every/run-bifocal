import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { ownerIdentity } from '../../data/snapshots/store'
import { readBoard } from '../../dashboards/store.server'
import { fileOwner } from '../../imports/files/owner.server'
import { RangeError } from '../../sources/spreadsheets/protocol'
import { boundedText, inputBody, object, providerJson, requireValue, token } from '../../sources/analytics/protocol'
import { tableRef, tableSchema, tableUrl } from '../../sources/databases/bigquery'
import { exportFields, warehouseRows } from './rows'
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
type ExportRow={id:string;owner_id:string;board_id:string;destination_json:string;fingerprint:string;row_count:number;state:string;created_at:string;settled_at:string|null}
export async function warehouseResponse(request:Request,original:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!/^\/api\/operator\/warehouse\/(preview|send|history)$/.test(path))return null
 const env=runtimeBindings(original)
 try {
  const owner=await fileOwner(request,env)
  if(!owner){if(request.body)await boundedText(request.body,32768,'warehouse_request_limit');return Response.json({error:'owner_required'},{status:401,headers})}
  const ownerId=await ownerIdentity(env,owner)
  if(path.endsWith('/history')) {
   requireValue(request.method === 'GET','method_not_allowed',405)
   const rows=(await env.DB.prepare('SELECT id,board_id AS artifactId,destination_json AS destination,fingerprint,row_count AS rowCount,state,created_at AS createdAt,settled_at AS settledAt FROM bf_warehouse_exports WHERE owner_id=? ORDER BY created_at DESC LIMIT 100').bind(ownerId).all()).results
   await transact(env.DB,owner,[])
   return Response.json({exports:rows},{headers})
  }
  requireValue(request.method === 'POST','method_not_allowed',405)
  const input=await inputBody(request)
  if(path.endsWith('/preview')) {
   requireValue(Object.keys(input).every(k=>['artifactId','project','dataset','table'].includes(k)) && typeof input.artifactId === 'string','warehouse_destination_required')
   const destination=tableRef(input),board=await readBoard(env,owner,ownerId,input.artifactId)
   requireValue(board,'artifact_not_found',404)
   const rows=warehouseRows(board),id=randomUUID(),fingerprint=sha256(canonicalJson({board:board.digest,destination,rows}))
   await transact(env.DB,owner,[...board.guards.map(assertion),sql('INSERT INTO bf_warehouse_exports(id,owner_id,board_id,destination_json,fingerprint,row_count,state,created_at) VALUES(?,?,?,?,?,?,?,?)',id,ownerId,board.id,canonicalJson(destination),fingerprint,rows.length,'review',new Date().toISOString())])
   return Response.json({id,fingerprint,rowCount:rows.length,destination,link:tableUrl(destination),fields:exportFields,rows:rows.map(row=>row.json)},{headers})
  }
  requireValue(Object.keys(input).every(k=>['id','fingerprint','accessToken','confirmExport'].includes(k)) && typeof input.id === 'string' && typeof input.fingerprint === 'string' && input.confirmExport === true,'exact_export_consent_required')
  const grant=token(input.accessToken)
  const record=await env.DB.prepare('SELECT * FROM bf_warehouse_exports WHERE id=? AND owner_id=?').bind(input.id,ownerId).first<ExportRow>()
  requireValue(record && record.state === 'review' && record.fingerprint === input.fingerprint,'export_already_attempted_or_stale',409)
  const board=await readBoard(env,owner,ownerId,record.board_id)
  requireValue(board,'artifact_withdrawn',409)
  const destination=tableRef(JSON.parse(record.destination_json)),rows=warehouseRows(board)
  requireValue(sha256(canonicalJson({board:board.digest,destination,rows})) === record.fingerprint,'export_snapshot_changed',409)
  requireValue(!JSON.stringify(rows).includes(grant) && !record.destination_json.includes(grant),'credential_in_export')
  // Claim the one attempt before egress. A crashed sender remains visibly
  // sending/unknown and cannot be blindly replayed, including across restarts.
  await transact(env.DB,owner,[...board.guards.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_warehouse_exports WHERE id=? AND owner_id=? AND state=? AND fingerprint=?)',record.id,ownerId,'review',record.fingerprint)),sql('UPDATE bf_warehouse_exports SET state=? WHERE id=?','sending',record.id)])
  let state='unknown'
  try {
   const fields=await tableSchema(destination,grant)
   requireValue(fields.length === exportFields.length && exportFields.every(name=>fields.some(field=>object(field) && field.name === name && field.type === 'STRING' && (field.mode === undefined || ['NULLABLE','REQUIRED'].includes(String(field.mode))))),'warehouse_exact_string_schema_required',502)
   // Recheck current session and source custody immediately before the write.
   await transact(env.DB,owner,board.guards.map(assertion))
   const result=await providerJson(tableUrl(destination)+'/insertAll',grant,{skipInvalidRows:false,ignoreUnknownValues:false,rows})
   requireValue(result.kind === 'bigquery#tableDataInsertAllResponse' && (result.insertErrors === undefined || Array.isArray(result.insertErrors)),'warehouse_acknowledgement_required',502)
   state=Array.isArray(result.insertErrors) && result.insertErrors.length ? 'partial' : 'acknowledged'
  } catch { /* The outcome is deliberately unknown; no automatic retry. */ }
  // Settlement is metadata only, even when authorization was revoked in flight.
  // No data or source/destination grant is retained in the receipt.
  await env.DB.prepare('UPDATE bf_warehouse_exports SET state=?,settled_at=? WHERE id=? AND state=?').bind(state,new Date().toISOString(),record.id,'sending').run()
  const current=await fileOwner(request,env)
  requireValue(current,'owner_required',401)
  await transact(env.DB,current,[])
  return Response.json({id:record.id,state,rowCount:rows.length,fingerprint:record.fingerprint,link:tableUrl(destination),reason:state === 'acknowledged'?'The warehouse acknowledged every submitted row.':state === 'partial'?'The warehouse reported row errors. Inspect the destination; no automatic retry is allowed.':'The outcome is unknown or the request was refused. Inspect the destination before taking another action; no automatic retry is allowed.'},{headers})
 }catch(error){return Response.json({error:error instanceof RangeError?error.code:'warehouse_export_conflict'},{status:error instanceof RangeError?error.status:409,headers})}
}
