import type { Bindings } from '../../auth.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { fail, type Context, type Query } from './types'
/** Freeze native conventions, never infer a calendar, rate source or currency. */
export async function queryContext(env: Bindings, query: Query, ownerId: string): Promise<Context> {
 const company = await env.DB.prepare('SELECT revision,value_json FROM bf_company_settings WHERE singleton=1').first<{revision:string;value_json:string}>()
 if (!company) fail('company_conventions_required',409)
 const settings = JSON.parse(company.value_json) as Record<string,unknown>
 if (typeof settings.timezone !== 'string' || typeof settings.currency !== 'string') fail('invalid_company_conventions',409)
 const guards = [sql('EXISTS(SELECT 1 FROM bf_company_settings WHERE singleton=1 AND revision=? AND value_json=?)',company.revision,company.value_json)]
 const load = async (table: 'bf_calendars' | 'bf_rate_sources', ref: {id:string;version:number}) => {
  const row = await env.DB.prepare(`SELECT value_json FROM ${table} WHERE id=? AND version=?`).bind(ref.id,ref.version).first<{value_json:string}>()
  if (!row) fail(table === 'bf_calendars' ? 'calendar_version_not_found' : 'rate_source_version_not_found',404)
  guards.push(sql(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=? AND value_json=?)`,ref.id,ref.version,row.value_json))
  return JSON.parse(row.value_json)
 }
 const calendar = {...query.context.calendar,definition:await load('bf_calendars',query.context.calendar)}
 const rateSource = query.context.rateSource ? {...query.context.rateSource,definition:await load('bf_rate_sources',query.context.rateSource)} : null
 return {ownerId,securityScope:{kind:'installation-owner',ownerId},company:{revision:company.revision,settings},calendar,rateSource,timezone:settings.timezone,currency:settings.currency,guards}
}
