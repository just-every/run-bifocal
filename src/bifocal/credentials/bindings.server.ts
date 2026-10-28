import type { Bindings } from '../../auth.server'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { readModel, readDefinition, modelGuard } from '../models/validation/store.server'
import { readSources, sourceMatch } from '../data/snapshots/store'
import { fail } from '../query/types'
import { sourceRules, intersectSources } from './sources.server'
import type { Credential } from './store.server'

/** Rotation and every read intersect the same current published bindings. */
export async function credentialBindings(env: Bindings, credential: Credential) {
 const scope = credential.scope, model = await readModel(env, credential.owner_id, scope.modelId)
 if (model.production !== scope.revision) fail('credential_scope_changed', 409)
 const view = (await readDefinition(env, scope.revision)).views.find(value => value.id === scope.viewId)
 if (!view?.query.semantic) fail('credential_scope_changed', 409)
 const sources = await readSources(env, view.query), rules = await sourceRules(env, sources)
 if (canonicalJson(rules.map(rule => ({id: rule.source.id, revision: rule.source.revision, digest: sha256(rule.source.value_json), ...rule.digest ? {policyDigest: rule.digest, policyVersion: rule.version} : {}}))) !== canonicalJson(scope.sources)) fail('credential_scope_changed', 409)
 intersectSources({...view.query, groupBy: scope.dimensions, filters: [...view.query.filters, ...view.rowRules, ...scope.filters], measures: view.query.measures.filter(measure => scope.measures.includes(measure.id))}, rules)
 return {model, view, sources, rules, fences: [modelGuard(model), ...sources.map(sourceMatch), ...rules.map(rule => rule.guard)]}
}
