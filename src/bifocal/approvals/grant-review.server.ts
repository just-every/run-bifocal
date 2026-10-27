import type { Bindings } from '../../auth.server'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Authority } from '../catalog/authority.server'
import type { Run } from '../reports/store.server'
import { fail } from '../query/types'
import { classificationBindings } from './classifications.server'

/** This is a fresh owner review of a dated retained artifact, not permission to
 * deliver it or to read its sources. A later metric correction keeps its own bytes. */
export async function exactGrantReview(env:Bindings,actor:Authority,run:Run,reviewerId:string,reviewerVersion:number,expiresAt:string,revisions:unknown){
 const bindings=await classificationBindings(env,[actor.id,reviewerId])
 const expected=bindings.references.map(({operatorId,revision})=>({operatorId,revision}))
 if(canonicalJson(revisions)!==canonicalJson(expected))fail('grant_classification_review_changed',409)
 const artifact=JSON.parse(run.artifact_json!)
 return {guards:bindings.guards,context:{
  digest:run.artifact_digest,artifactRevision:run.revision,queryId:artifact.queryId,snapshotDigest:artifact.snapshotDigest,
  metric:artifact.metricRef,definitionVersions:artifact.definitionVersions,sourceContext:artifact.observedSources,securityContext:artifact.securityScope,
  classifications:bindings.references,approverId:actor.id,recipient:{id:reviewerId,version:reviewerVersion},
  destination:'existing-native-artifact-reader',format:'application/json',expiresAt,
 }}
}
