import type { Bindings } from '../../../../auth.server'
import { sql } from '../../../../modules/import-kit/src/door/store.ts'
import { fail } from '../../../query/types'
import { importGuard, readMigrationProject } from '../store.server'
export type SigmaOrigin = { project_id: string; project_revision: string; element_id: string }
export async function sigmaDraft(env: Bindings, ownerId: string, projectId: string, revision: unknown, elementId: unknown) {
 const current = await readMigrationProject(env, ownerId, projectId), sigma = current.value.sigma
 const draft = sigma?.drafts.find(d => d.element === elementId)
 const item = current.value.items.find(i => i.source.id === draft?.itemId)
 if (revision !== current.revision || !sigma || !draft?.definition || draft.issues.length || !item || item.edited || item.conflict || current.value.items.some(i => i.conflict)) fail('exact_resolved_sigma_draft_required', 409)
 const guards = [importGuard(current)]
 for (const source of sigma.sources) {
  const row = await env.DB.prepare('SELECT revision FROM bf_file_tables WHERE id=?').bind(source.id).first<{ revision: string }>()
  if (row?.revision !== source.revision) fail('sigma_source_review_stale', 409)
  guards.push(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=?)', source.id, source.revision))
 }
 return { definition: draft.definition, current, guards, origin: { project_id: projectId, project_revision: current.revision, element_id: draft.element } }
}
export async function sigmaBranchGuards(env: Bindings, ownerId: string, revision: string) {
 const origin = await env.DB.prepare('SELECT project_id,project_revision,element_id FROM bf_migration_model_revisions WHERE revision_id=?').bind(revision).first<SigmaOrigin>()
 return origin ? (await sigmaDraft(env, ownerId, origin.project_id, origin.project_revision, origin.element_id)).guards : []
}
