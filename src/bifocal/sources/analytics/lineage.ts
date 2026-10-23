import { object, publicOrigin, requireValue } from './protocol'
export type Lineage = { kind:'vane-api'|'vane-export'|'product-table'|'revenue-table'; link:string; description:string; from:string; to:string; timezone:string; observedAt:string; schema:string }
/** Source references are inert, explicitly supplied provenance, never authority
 * or certification. Only a credential-free public HTTPS link can be rendered. */
export function lineage(value: unknown): Lineage | undefined {
 if (value === undefined) return undefined
 requireValue(object(value) && Object.keys(value).every(k => ['kind','link','description','from','to','timezone','observedAt','schema'].includes(k)), 'invalid_source_lineage')
 requireValue(['vane-api','vane-export','product-table','revenue-table'].includes(String(value.kind)), 'invalid_source_kind')
 requireValue(typeof value.link === 'string' && value.link.length <= 1024, 'source_link_required')
 const url = new URL(value.link)
 publicOrigin(url.origin)
 requireValue(!url.username && !url.password && [...url.searchParams.keys()].every(k => ['section','from','to','siteId','table'].includes(k)), 'credential_free_source_link_required')
 requireValue(typeof value.description === 'string' && value.description.length > 0 && value.description.length <= 240 && typeof value.schema === 'string' && value.schema.length <= 240, 'source_description_required')
 requireValue(typeof value.from === 'string' && typeof value.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.from) && /^\d{4}-\d{2}-\d{2}$/.test(value.to) && new Date(value.from).toISOString().slice(0,10) === value.from && new Date(value.to).toISOString().slice(0,10) === value.to && value.from < value.to, 'source_exclusive_date_window_required')
 requireValue(typeof value.timezone === 'string' && value.timezone.length <= 100, 'source_timezone_required')
 try { new Intl.DateTimeFormat('en-US',{timeZone:value.timezone}) } catch { requireValue(false, 'source_timezone_required') }
 requireValue(typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)), 'source_observation_time_required')
 return value as Lineage
}
