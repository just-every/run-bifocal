import type { Bindings } from '../../auth.server'
import { body, ConventionsError, identifier, integer, object } from '../company/protocol'
import { companyValue, readCompany } from '../company/routes'
import { readVersion, saveVersion, versions, versionValue, type Authority } from '../company/store'
import { convertCurrency } from './convert'
import { rateSource, type RateSource } from './rates'
export async function currencyRoute(request: Request, env: Bindings, owner: Authority, path: string): Promise<unknown> {
 if (path === '/api/operator/currency/convert') {
  if (request.method !== 'POST') throw new ConventionsError('method_not_allowed', 405)
  const input = object(await body(request), ['sourceId', 'sourceVersion', 'targetCurrency', 'policy', 'rounding', 'transactions', 'timezone', 'reportCutoff'])
  const id = identifier(input.sourceId), version = integer(input.sourceVersion, 'sourceVersion', 1, 1000000000)
  const row = await readVersion(env, owner, 'bf_rate_sources', id, version), company = companyValue(await readCompany(env, owner))
  const { sourceId: _id, sourceVersion: _version, ...conversion } = input
  return { rateSource: { id, version }, company, ...convertCurrency(JSON.parse(row.value_json) as RateSource, conversion) }
 }
 if (path === '/api/operator/rates') {
  if (request.method === 'GET') return { sources: await versions(env, owner, 'bf_rate_sources') }
  if (request.method !== 'POST') throw new ConventionsError('method_not_allowed', 405)
  const input = object(await body(request), ['id', 'previousVersion', 'definition'])
  return saveVersion(env, owner, 'bf_rate_sources', identifier(input.id), input.previousVersion, rateSource(input.definition))
 }
 const parts = path.slice('/api/operator/rates/'.length).split('/')
 if (parts.length === 1 && request.method === 'GET') return { versions: await versions(env, owner, 'bf_rate_sources', identifier(parts[0])) }
 if (parts.length === 2 && request.method === 'GET') return versionValue(await readVersion(env, owner, 'bf_rate_sources', identifier(parts[0]), integer(Number(parts[1]), 'version', 1, 1000000000)))
 throw new ConventionsError('not_found', 404)
}
