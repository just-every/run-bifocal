import { object, publicOrigin, requireValue } from './protocol'
export type Lineage = { kind:'vane-api'|'vane-export'|'product-table'|'revenue-table'|'easel-export'|'jira-work'; link:string; description:string; from:string; to:string; timezone:string; observedAt:string; schema:string; jira?:{cloudId:string;projectId:string;projectKey:string;pages:number;issues:number} }
/** Source references are inert, explicitly supplied provenance, never authority
 * or certification. Only a credential-free public HTTPS link can be rendered. */
export function lineage(value: unknown): Lineage | undefined {
 if (value === undefined) return undefined
 requireValue(object(value) && Object.keys(value).every(k => ['kind','link','description','from','to','timezone','observedAt','schema','jira'].includes(k)), 'invalid_source_lineage')
 requireValue(['vane-api','vane-export','product-table','revenue-table','easel-export','jira-work'].includes(String(value.kind)), 'invalid_source_kind')
 requireValue(typeof value.link === 'string' && value.link.length <= 1024, 'source_link_required')
 const url = new URL(value.link)
 publicOrigin(url.origin)
 requireValue(!url.username && !url.password && [...url.searchParams.keys()].every(k => ['section','from','to','siteId','table'].includes(k)), 'credential_free_source_link_required')
 requireValue(typeof value.description === 'string' && value.description.length > 0 && value.description.length <= 240 && typeof value.schema === 'string' && value.schema.length <= 240, 'source_description_required')
 if (value.kind !== 'jira-work') requireValue(typeof value.from === 'string' && typeof value.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.from) && /^\d{4}-\d{2}-\d{2}$/.test(value.to) && new Date(value.from).toISOString().slice(0,10) === value.from && new Date(value.to).toISOString().slice(0,10) === value.to && value.from < value.to, 'source_exclusive_date_window_required')
 else {
  requireValue(value.from === '' && value.to === '', 'jira_snapshot_has_no_historical_window')
  requireValue(object(value.jira) && Object.keys(value.jira).every(key=>['cloudId','projectId','projectKey','pages','issues'].includes(key)) && typeof value.jira.cloudId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.jira.cloudId) && typeof value.jira.projectId === 'string' && /^[1-9][0-9]{0,19}$/.test(value.jira.projectId) && typeof value.jira.projectKey === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.jira.projectKey) && Number.isSafeInteger(value.jira.pages) && Number(value.jira.pages)>=1 && Number(value.jira.pages)<=20 && Number.isSafeInteger(value.jira.issues) && Number(value.jira.issues)>=0 && Number(value.jira.issues)<=2000, 'invalid_jira_lineage')
 }
 requireValue(value.kind === 'jira-work' || value.jira === undefined, 'unexpected_jira_lineage')
 requireValue(typeof value.timezone === 'string' && value.timezone.length <= 100, 'source_timezone_required')
 try { new Intl.DateTimeFormat('en-US',{timeZone:value.timezone}) } catch { requireValue(false, 'source_timezone_required') }
 requireValue(typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)), 'source_observation_time_required')
 return value as Lineage
}
