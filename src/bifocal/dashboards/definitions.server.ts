import {randomUUID} from 'node:crypto'
import {runtimeBindings,type Bindings} from '../../auth.server'
import {assertion,sql,transact} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {fileOwner} from '../imports/files/owner.server'
import {ownerIdentity,prepareQuery,readSources,sourceMatch} from '../data/snapshots/store'
import {queryContext} from '../query/context'
import {execute} from '../query/execute'
import {fail,QueryError} from '../query/types'
import {discardBody,exactKeys,json,jsonBody} from '../models/validation/transport'
import {documentQueries,snapshotDocument} from './documents'
import {boardDocument,readBoard} from './store.server'

/** Every answer and its single or multi-card artifact commit in one batch. */
export async function dashboardDefinitionResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/operator\/(dashboard|report)-definitions\/(review|create)$/.exec(url.pathname)
 if(!match)return null
 const kind=match[1] as 'dashboard'|'report',env=runtimeBindings(original)
 try{
  const owner=await fileOwner(request,env);if(!owner)return json({error:'owner_required'},401)
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(url.search)fail('query_parameters_not_supported',400)
  const ownerId=await ownerIdentity(env,owner),input=await jsonBody(request);exactKeys(input,['document','reviewedDigest'])
  const document=snapshotDocument(input.document),evaluations=[]
  for(const definition of documentQueries(document)){
   const context=await queryContext(env,definition,ownerId),sources=await readSources(env,definition)
   evaluations.push({definition,context,sources})
  }
  const guards=evaluations.flatMap(value=>[...value.context.guards??[],...value.sources.map(sourceMatch)])
  const digest=sha256(canonicalJson({ownerId,kind,document,guards}))
  if(match[2]==='review'){
   const answers=evaluations.map(value=>execute(value.definition,value.sources,value.context))
   await transact(env.DB,owner,guards.map(assertion))
   return json({document,digest,...('cards' in document?{answers}:{answer:answers[0]})})
  }
  if(input.reviewedDigest!==digest)fail('exact_current_dashboard_review_required',409)
  const retained=evaluations.map(value=>prepareQuery(value.definition,value.context,value.sources)),id=randomUUID(),createdAt=new Date().toISOString()
  const changes=retained.flatMap(value=>value.changes)
  if('cards' in document){
   await transact(env.DB,owner,[...changes,sql('INSERT INTO bf_analytics_boards(id,kind,owner_id,title,created_at) VALUES(?,?,?,?,?)',id,kind,ownerId,document.title,createdAt),...retained.map((value,position)=>sql('INSERT INTO bf_analytics_cards(board_id,position,snapshot_id) VALUES(?,?,?)',id,position,value.snapshot.snapshotId))])
   return json(boardDocument((await readBoard(env,owner,ownerId,id,kind))!),201)
  }
  await transact(env.DB,owner,[...changes,sql('INSERT INTO bf_query_artifacts(id,kind,snapshot_id,title,owner_id,created_at) VALUES(?,?,?,?,?,?)',id,kind,retained[0].snapshot.snapshotId,document.title,ownerId,createdAt)])
  return json({id,kind,title:document.title,artifactCreatedAt:createdAt,...retained[0].snapshot},201)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'dashboard_definition_conflict'},409)}finally{await discardBody(request)}
}
