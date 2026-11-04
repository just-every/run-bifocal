import type { Bindings } from '../../../../auth.server'
import { canonicalJson, sha256 } from '../../../../modules/import-kit/src/provenance/identity.ts'
import { assertion, sql, transact } from '../../../../modules/import-kit/src/door/store.ts'
import { prepareMetricDraft, saveMetricDraft } from '../../../metrics/drafts.server'
import { fail } from '../../../query/types'
import { exactKeys, json, jsonBody } from '../../../models/validation/transport'
import { importGuard } from '../store.server'
import type { ImportRow } from '../targets'
import type { MigrationProject } from '../compile'
import type { fileOwner } from '../../files/owner.server'

export async function tableauDraftOperation(request:Request,env:Bindings,owner:NonNullable<Awaited<ReturnType<typeof fileOwner>>>,ownerId:string,current:ImportRow&{value:MigrationProject},operation:string){
 if(request.method!=='POST')fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['reviewedRevision','sourceMetric','previousRevision','reviewedDigest'])
 if(input.reviewedRevision!==current.revision)fail('migration_review_stale',409)
 const tableau=current.value.tableau,draft=tableau?.drafts.find(d=>d.sourceMetric===input.sourceMetric)
 if(!tableau||!draft||current.value.items.some(i=>i.edited||i.conflict))fail('tableau_unresolved_native_draft',409)
 const guards=[importGuard(current),...tableau.sources.map(s=>sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=?)',s.id,s.revision))]
 await transact(env.DB,owner,guards.map(assertion))
 const prepared=await prepareMetricDraft(env,ownerId,draft.document.id,draft.document.definition,input.previousRevision)
 // No source claim or imported certification is authority. A fresh owner must
 // review this exact project, native metric revision and current source context.
 prepared.guards.push(...guards)
 prepared.review.digest=sha256(canonicalJson({review:prepared.review,project:current.revision,guards}))
 if(operation==='tableau-review')return json(prepared.review)
 if(input.reviewedDigest!==prepared.review.digest)fail('exact_current_tableau_review_required',409)
 return json(await saveMetricDraft(env,owner,prepared,[sql('INSERT OR IGNORE INTO bf_tableau_migration_drafts(project_id,metric_id) VALUES(?,?)',current.id,draft.document.id)]),201)
}
