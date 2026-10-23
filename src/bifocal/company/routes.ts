import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { timezone } from '../calendars/timezone'
import { body, ConventionsError, object, requireValue } from './protocol'
import { companySettings } from './settings'
import { audit, guarded, sql, type Authority } from './store'
export interface CompanyRow { revision: string; value_json: string; updated_at: string; updated_by: string }
export async function readCompany(env: Bindings, owner: Authority) {
 const [rows] = await guarded<CompanyRow>(env, owner, [sql('SELECT * FROM bf_company_settings WHERE singleton=1')])
 if (!rows[0]) throw new ConventionsError('company_schema_unavailable', 503)
 return rows[0]
}
export function companyValue(row: CompanyRow) {
 return { revision: row.revision, settings: JSON.parse(row.value_json) as unknown, updatedAt: row.updated_at || null, updatedBy: row.updated_by }
}
export async function companyRoute(request: Request, env: Bindings, owner: Authority): Promise<unknown> {
 if (request.method === 'GET') return companyValue(await readCompany(env, owner))
 if (request.method !== 'PUT') throw new ConventionsError('method_not_allowed', 405)
 const input = object(await body(request), ['previousRevision', 'settings']), settings = companySettings(input.settings)
 requireValue(typeof input.previousRevision === 'string', 'previous_revision_required')
 const revision = randomUUID(), updatedAt = new Date().toISOString(), value = JSON.stringify(settings)
 await guarded(env, owner, [sql('INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM bf_company_settings WHERE singleton=1 AND revision=?) THEN 1 ELSE 0 END', input.previousRevision),
  sql('UPDATE bf_company_settings SET revision=?,value_json=?,updated_at=?,updated_by=? WHERE singleton=1', revision, value, updatedAt, owner.email), audit(owner, 'company', '1', revision, value, updatedAt)])
 return { revision, settings, updatedAt, updatedBy: owner.email }
}
export async function viewerTimezoneRoute(request: Request, env: Bindings, owner: Authority): Promise<unknown> {
 if (request.method === 'GET') {
  const [rows] = await guarded<{ revision: string | null; timezone: string }>(env, owner, [sql("SELECT p.revision,COALESCE(p.timezone,json_extract(c.value_json,'$.timezone')) AS timezone FROM bf_company_settings c LEFT JOIN bf_viewer_timezones p ON p.operator_email=? WHERE c.singleton=1", owner.email)])
  if (!rows[0]) throw new ConventionsError('company_schema_unavailable', 503)
  return { revision: rows[0].revision, timezone: rows[0].timezone, inherited: rows[0].revision === null }
 }
 if (request.method !== 'PUT') throw new ConventionsError('method_not_allowed', 405)
 const input = object(await body(request), ['previousRevision', 'timezone']), zone = timezone(input.timezone)
 requireValue(input.previousRevision === null || typeof input.previousRevision === 'string', 'previous_revision_required')
 const revision = randomUUID(), updatedAt = new Date().toISOString()
 await guarded(env, owner, [sql('INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN (SELECT revision FROM bf_viewer_timezones WHERE operator_email=?) IS ? THEN 1 ELSE 0 END', owner.email, input.previousRevision),
  sql('INSERT INTO bf_viewer_timezones(operator_email,timezone,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(operator_email) DO UPDATE SET timezone=excluded.timezone,revision=excluded.revision,updated_at=excluded.updated_at', owner.email, zone, revision, updatedAt), audit(owner, 'viewer-timezone', owner.email, revision, JSON.stringify({ timezone: zone }), updatedAt)])
 return { revision, timezone: zone, inherited: false }
}
