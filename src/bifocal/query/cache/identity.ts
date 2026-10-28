import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import type {Context,Query,Source} from '../types'

// Change this identity when execution or scope semantics change. HTTP responses
// remain private and no-store; this identity is never a browser cache key.
export const resultSemantics='exact-v1:scoped-result-v1'
export type CacheReceipt={status:'hit'|'miss';key:string;createdAt:string;ageMs:number;principalId:string;principalVersion:number}
export function resultKey(query:Query,context:Context,sources:Source[],principal:unknown,grant:unknown) {
 const {guards=[],...frozen}=context
 return sha256(canonicalJson({semantics:resultSemantics,query,context:frozen,
  sources:sources.map(s=>({id:s.id,revision:s.revision,fingerprint:sha256(s.value_json)})).sort((a,b)=>a.id.localeCompare(b.id)),
  principal,grant:grant??null,evidence:sha256(canonicalJson(guards))}))
}
