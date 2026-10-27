import {runtimeBindings,type Bindings} from '../../../auth.server'
import {assertion,sql,transact} from '../../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import {readChart} from '../../charts/store.server'
import {ownerIdentity,readQuery,readSources,sourceMatch} from '../../data/snapshots/store'
import {fileOwner} from '../../imports/files/owner.server'
import {discardBody,exactKeys,json,jsonBody,privateHeaders} from '../../models/validation/transport'
import {fail,QueryError} from '../../query/types'
import {chartSnapshotScene,type ChartSelection} from './chart-scene'
import {chartSnapshotScript} from './chart-script'
import {encodePdf} from './pdf'
import {encodePptx} from './pptx'
import {encodePng} from './png'

/** Current owner and source custody are fenced after encoding each file. */
export async function chartSnapshotResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url)
 if(url.pathname==='/bifocal/chart-snapshot.js')return ['GET','HEAD'].includes(request.method)?new Response(request.method==='HEAD'?null:chartSnapshotScript,{headers:{'content-type':'text/javascript; charset=utf-8','x-content-type-options':'nosniff'}}):new Response(null,{status:405})
 const match=/^\/api\/operator\/charts\/([a-f0-9-]{36})\/snapshot\/(review|download)$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original)
 try{
  const owner=await fileOwner(request,env);if(!owner)return json({error:'owner_required'},401)
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(url.search)fail('query_parameters_not_supported',400)
  const input=await jsonBody(request);exactKeys(input,['format','selection','exportedAt','reviewedDigest'])
  if(input.format!=='pdf'&&input.format!=='pptx'&&input.format!=='png')fail('chart_snapshot_format_required',400)
  if(input.selection!==undefined){
   if(!input.selection||typeof input.selection!=='object'||Array.isArray(input.selection))fail('chart_selection_required',400)
   const selected=input.selection as Record<string,unknown>;exactKeys(selected,['field','value'])
   if(typeof selected.field!=='string'||!(selected.value===null||['string','number','boolean'].includes(typeof selected.value)))fail('chart_selection_required',400)
  }
  const now=Date.now()
  if(input.exportedAt!==undefined&&(typeof input.exportedAt!=='string'||!Number.isFinite(Date.parse(input.exportedAt))||new Date(input.exportedAt).toISOString()!==input.exportedAt||Date.parse(input.exportedAt)>now||now-Date.parse(input.exportedAt)>600000))fail('chart_snapshot_review_expired',409)
  if(match[2]==='download'&&typeof input.exportedAt!=='string')fail('exact_chart_snapshot_review_required',409)
  const ownerId=await ownerIdentity(env,owner),chart=await readChart(env,owner,ownerId,match[1]),exportedAt=typeof input.exportedAt==='string'?input.exportedAt:new Date(now).toISOString()
  const {guard,sources}=await readQuery(env,owner,ownerId,chart.queryId),current=await readSources(env,chart.definition)
  // Review binds the current custody state while retaining the immutable answer.
  // Changed sources invalidate an earlier review; a fresh historical review is allowed.
  const sourceGuards=current.map(sourceMatch),observedSources=sources.map(source=>({dataset:source.id,snapshotRevision:source.revision,currentRevision:current.find(value=>value.id===source.id)!.revision,changed:!current.some(value=>value.id===source.id&&value.revision===source.revision&&value.value_json===source.value_json)}))
  const snapshot=chartSnapshotScene(chart,input.selection as ChartSelection|undefined,exportedAt,new URL('/app/charts/'+chart.id,url).href)
  snapshot.provenance={...snapshot.provenance as object,observedSources}
  const sourceState=observedSources.some(source=>source.changed)?'Source state at export: changed since the retained answer. Values remain the dated immutable answer.':'Source state at export: current sources match the retained answer.'
  for(const page of snapshot.pages)page.shapes.push({kind:'text',label:'Source state at export',x:32,y:826,w:1216,h:18,size:14,lines:[sourceState]})
  const digest=sha256(canonicalJson({format:input.format,snapshot,ownerId,sourceGuards})),bytes=input.format==='pdf'?encodePdf(snapshot):input.format==='png'?encodePng(snapshot):encodePptx(snapshot)
  if(bytes.length>16_000_000)fail('chart_snapshot_size_limit',413)
  if(match[2]==='download'&&input.reviewedDigest!==digest)fail('exact_chart_snapshot_review_required',409)
  await transact(env.DB,owner,[assertion(guard),...sourceGuards.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_charts WHERE id=? AND snapshot_id=? AND owner_id=? AND title=? AND visual_json=?)',chart.id,chart.snapshotId,ownerId,chart.title,canonicalJson(chart.visual)))])
  if(match[2]==='review')return json({digest,format:input.format,bytes:bytes.length,...snapshot})
  return new Response(new Uint8Array(bytes).buffer,{headers:{...privateHeaders,'content-type':input.format==='pdf'?'application/pdf':input.format==='png'?'image/png':'application/vnd.openxmlformats-officedocument.presentationml.presentation','content-disposition':'attachment; filename="chart-'+chart.id+'.'+input.format+'"','content-length':String(bytes.length)}})
 }catch(error){return error instanceof QueryError?json({error:error.code,withdraw:true},error.status):json({error:'chart_snapshot_conflict',withdraw:true},409)}finally{await discardBody(request)}
}
