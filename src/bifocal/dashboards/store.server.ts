import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { readQuery } from '../data/snapshots/store'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail } from '../query/types'
type Owner=D1Sql & {email:string}
type Row={id:string;kind:'dashboard'|'report';owner_id:string;title:string;created_at:string}
export async function readBoard(env:Bindings,owner:Owner,ownerId:string,id:string,kind?:string) {
 const row=await env.DB.prepare('SELECT * FROM bf_analytics_boards WHERE id=? AND owner_id=?').bind(id,ownerId).first<Row>()
 if(!row || kind && row.kind !== kind)return null
 const refs=(await env.DB.prepare('SELECT position,snapshot_id FROM bf_analytics_cards WHERE board_id=? ORDER BY position').bind(id).all<{position:number;snapshot_id:string}>()).results
 if(refs.length < 2 || refs.length > 4)fail('dashboard_custody_conflict',409)
 const cards=[],guards:D1Sql[]=[sql('EXISTS(SELECT 1 FROM bf_analytics_boards WHERE id=? AND owner_id=? AND title=? AND kind=?)',id,ownerId,row.title,row.kind),sql('(SELECT count(*) FROM bf_analytics_cards WHERE board_id=?)=?',id,refs.length)]
 for(const ref of refs) {
  const {snapshot,sources,guard}=await readQuery(env,owner,ownerId,ref.snapshot_id)
  cards.push({...snapshot,provenance:sources.map(s=>({dataset:s.id,revision:s.revision,source:s.table.source,updatedAt:s.table.updatedAt}))})
  guards.push(guard,sql('EXISTS(SELECT 1 FROM bf_analytics_cards WHERE board_id=? AND position=? AND snapshot_id=?)',id,ref.position,ref.snapshot_id))
 }
 await transact(env.DB,owner,guards.map(assertion))
 const digest=sha256(canonicalJson({id,title:row.title,kind:row.kind,cards:cards.map(card=>card.digest)}))
 return {id,kind:row.kind,title:row.title,createdAt:row.created_at,cards,digest,guards}
}
export async function saveBoard(env:Bindings,owner:Owner,ownerId:string,kind:'dashboard'|'report',input:Record<string,unknown>) {
 if(Object.keys(input).some(k=>!['queryIds','title'].includes(k)) || !Array.isArray(input.queryIds) || input.queryIds.length < 2 || input.queryIds.length > 4 || new Set(input.queryIds).size !== input.queryIds.length || !input.queryIds.every(id=>typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160)fail('dashboard_requires_title_and_two_to_four_answers',400)
 const id=randomUUID(),guards:D1Sql[]=[]
 for(const queryId of input.queryIds) {const query=await readQuery(env,owner,ownerId,queryId);guards.push(query.guard)}
 await transact(env.DB,owner,[...guards.map(assertion),sql('INSERT INTO bf_analytics_boards(id,kind,owner_id,title,created_at) VALUES(?,?,?,?,?)',id,kind,ownerId,input.title,new Date().toISOString()),...input.queryIds.map((qid,position)=>sql('INSERT INTO bf_analytics_cards(board_id,position,snapshot_id) VALUES(?,?,?)',id,position,qid))])
 return (await readBoard(env,owner,ownerId,id,kind))!
}
export const boardDocument=(board:NonNullable<Awaited<ReturnType<typeof readBoard>>>) => {const {guards,...document}=board;return document}
