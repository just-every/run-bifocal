import type { Bindings } from '../../../auth.server'
import { assertion, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys, json, jsonBody, privateHeaders } from '../../models/validation/transport'
import { fail } from '../../query/types'
import { bindRdlQueries } from './bindings.server'
import { compileRdl, type RdlProject } from './parse'
import { renderRdl } from './render'
import { encodeReport, formats, type ReportFormat } from './formats'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'

/** Rendering is bounded and synchronous. Durable jobs and subscriptions still
 * require their Base doors; a preview never activates or accepts the draft. */
export async function rdlPreviewResponse(request: Request, env: Bindings, owner: D1Sql & {email: string}, ownerId: string, project: RdlProject, revision: string, guard: D1Sql, action: string) {
 if (request.method !== 'POST') fail('method_not_allowed', 405)
 const input = await jsonBody(request)
 exactKeys(input, ['reviewedRevision', 'bindings', 'parameters', 'format', 'exportedAt', 'reviewedDigest'])
 if (input.reviewedRevision !== revision) fail('current_rdl_revision_required', 409)
 if (!formats.includes(input.format as ReportFormat)) fail('rdl_format_required', 400)
 if (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters)) fail('rdl_parameters_required', 400)
 const format = input.format as ReportFormat
 // Recompile the retained originals rather than trusting a stored AST.
 const parsed = compileRdl(project.input, project.input.reportId, ownerId)
 const bound = await bindRdlQueries(env, owner, ownerId, parsed, input.bindings)
 const rendered = renderRdl(parsed, bound.tables, input.parameters as Record<string, unknown>)
 if (input.exportedAt !== undefined && (typeof input.exportedAt !== 'string' || !Number.isFinite(Date.parse(input.exportedAt)) || new Date(input.exportedAt).toISOString() !== input.exportedAt || Date.parse(input.exportedAt) > Date.now() || Date.now() - Date.parse(input.exportedAt) > 600000)) fail('rdl_preview_expired', 409)
 if (action === 'download' && typeof input.exportedAt !== 'string') fail('exact_rdl_preview_required', 409)
 const exportedAt = typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(), backLink = new URL('/app/import', request.url).href
 const provenance = {reportId: project.input.reportId, revision, sourceDigest: parsed.digest, layout: 'readable', parameters: rendered.parameters, bindings: bound.provenance}
 const run = {...rendered, exportedAt, backLink, provenance}, output = encodeReport(run, format)
 if (output.bytes.length > 16000000) fail('rdl_interactive_artifact_limit', 413)
 const digest = sha256(canonicalJson({run, format, ownerId, guards: [guard, ...bound.guards]}))
 if (action === 'download' && input.reviewedDigest !== digest) fail('exact_rdl_preview_required', 409)
 await transact(env.DB, owner, [guard, ...bound.guards].map(assertion))
 if (action === 'preview') return json({digest, format, bytes: output.bytes.length, ...run, switchReady: false, sourceReconciliation: 'pending', delivery: 'inactive'})
 return new Response(new Uint8Array(output.bytes).buffer, {headers: {...privateHeaders, 'content-type': output.type, 'content-disposition': `attachment; filename="report-${project.input.reportId}.${format}"`, 'content-length': String(output.bytes.length)}})
}
