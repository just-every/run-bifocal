import { object, providerJson, providerValue, requireValue } from '../analytics/protocol'
import type { Column } from '../../imports/files/csv'
import type { Lineage } from '../analytics/lineage'

export const jiraSchema = {
 url: 'https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json',
 version: '1001.0.0-SNAPSHOT-f6ec623db665dba9a1a91d84931962d66514d7f3',
 sha256: '5dc3ab3fb5735724ff4d815f2c8d776910dab5d7d6f97e11c224ddb0bf35aa72'
} as const
export const jiraCoverage = 'Jira search-index updates may be delayed. Only issues visible to this bearer under Browse projects and issue security are included. Missing issues do not establish deletion or whole-project coverage. Current status is not transition history or historical staffing evidence.'
const resourcesUrl = 'https://api.atlassian.com/oauth/token/accessible-resources'
export const jiraFields = ['project','issuetype','status','created','updated','resolutiondate']
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,19}$/.test(v)
const projectKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(v)
const site = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/.test(v)
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k))
export type JiraResource = {cloudId:string;siteUrl:string;scopes:string[]}
export type JiraSelection = JiraResource & {projectId:string;projectKey:string}
export function selection(input: Record<string, unknown>): JiraSelection {
 requireValue(uuid(input.cloudId) && site(input.siteUrl) && id(input.projectId) && projectKey(input.projectKey), 'jira_site_and_project_required')
 return {cloudId:input.cloudId,siteUrl:input.siteUrl,projectId:input.projectId,projectKey:input.projectKey,scopes:[]}
}
/** OAuth discovery is metadata only; names and avatars never leave this edge.
 * The bounded adapter supports the documented classic read scope. */
export async function jiraResources(grant: string, authorize: () => Promise<void>): Promise<JiraResource[]> {
 await authorize()
 const value = await providerValue(resourcesUrl, grant)
 requireValue(Array.isArray(value) && value.length <= 100, 'jira_resource_limit', 502)
 const seen = new Set<string>()
 return value.map(resource => {
  requireValue(object(resource) && keys(resource,['id','url','scopes','name','avatarUrl']) && uuid(resource.id) && site(resource.url) && Array.isArray(resource.scopes) && resource.scopes.length <= 100 && resource.scopes.every(scope => typeof scope === 'string' && /^[a-z][a-z0-9:.-]{0,127}$/.test(scope)), 'jira_resource_schema_mismatch', 502)
  // Atlassian IDs may repeat across Jira and Confluence containers. Only
  // Jira-readable containers participate in the selected Jira identity check.
  if (resource.scopes.includes('read:jira-work')) {
   requireValue(!seen.has(resource.id), 'jira_duplicate_resource', 502); seen.add(resource.id)
  }
  return {cloudId:resource.id,siteUrl:resource.url,scopes:resource.scopes as string[]}
 }).filter(resource => resource.scopes.includes('read:jira-work'))
}
function timestamp(value: unknown): string | null {
 if (value === null) return null
 requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'jira_timestamp_required',502)
 requireValue(new Date(value.slice(0,10)+'T00:00:00.000Z').toISOString().slice(0,10) === value.slice(0,10), 'jira_timestamp_required',502)
 return value
}
function label(value: unknown): string {
 requireValue(typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value), 'jira_label_required',502)
 return value
}
function reference(value: unknown, allowed: string[]) {
 requireValue(object(value) && keys(value,allowed) && id(value.id), 'jira_reference_schema_mismatch',502)
 return value
}
const headers = ['issue_id','issue_key','project_id','project_key','type_id','issue_type','status_id','status','created_at','updated_at','resolved_at','issue_count']
/** Constructed GETs only. No arbitrary JQL, redirects, retries, issue expansion,
 * people, custom fields, histories, writes or automatic deletion inference. */
export async function readJira(input: JiraSelection, grant: string, authorize: () => Promise<void>) {
 const resources = await jiraResources(grant,authorize)
 requireValue(resources.some(resource => resource.cloudId === input.cloudId && resource.siteUrl === input.siteUrl), 'jira_selected_site_not_authorized',403)
 const root = `https://api.atlassian.com/ex/jira/${input.cloudId}/rest/api/3/search/jql`
 const rows: (string | null)[][] = [headers], seen = new Set<string>(), cursors = new Set<string>(), issueKeys = new Set<string>()
 let cursor: string | undefined
 for (let page = 0; page < 20; page++) {
  const params = new URLSearchParams({jql:`project = ${input.projectId} ORDER BY id ASC`,maxResults:'100',fields:jiraFields.join(','),failFast:'true'})
  if (cursor) params.set('nextPageToken',cursor)
  await authorize()
  const data = await providerJson(root+'?'+params,grant)
  requireValue(keys(data,['issues','isLast','nextPageToken','warnings']) && (data.warnings === undefined || Array.isArray(data.warnings) && data.warnings.length === 0), 'jira_warning_or_unexpected_response',502)
  requireValue(Array.isArray(data.issues) && data.issues.length <= 100 && typeof data.isLast === 'boolean', 'jira_incomplete_page',502)
  for (const issue of data.issues) {
   requireValue(object(issue) && keys(issue,['id','key','fields','self','expand']) && id(issue.id) && typeof issue.key === 'string' && new RegExp('^'+input.projectKey+'-[1-9][0-9]{0,19}$').test(issue.key) && object(issue.fields) && keys(issue.fields,jiraFields) && jiraFields.every(field => Object.hasOwn(issue.fields as object,field)), 'jira_issue_fields_refused',502)
   requireValue(issue.self === undefined || issue.self === input.siteUrl+'/rest/api/3/issue/'+issue.id || issue.self === `https://api.atlassian.com/ex/jira/${input.cloudId}/rest/api/3/issue/${issue.id}`, 'jira_foreign_issue_site',502)
   requireValue(!seen.has(issue.id) && !issueKeys.has(issue.key), 'jira_duplicate_issue',502)
   seen.add(issue.id); issueKeys.add(issue.key)
   const fields = issue.fields
   const project = reference(fields.project,['id','key','name','self','avatarUrls','projectTypeKey','simplified','style','projectCategory','insight'])
   requireValue(project.id === input.projectId && project.key === input.projectKey, 'jira_foreign_project',502)
   // Documented decorative metadata is discarded, including type and status
   // descriptions. No issue description or other unrequested field is admitted.
   const type = reference(fields.issuetype,['id','name','self','description','iconUrl','subtask','avatarId','hierarchyLevel','scope','entityId'])
   const status = reference(fields.status,['id','name','self','description','iconUrl','statusCategory','scope'])
   const times = [timestamp(fields.created),timestamp(fields.updated),timestamp(fields.resolutiondate)]
   const row = [issue.id,issue.key,input.projectId,input.projectKey,type.id as string,label(type.name),status.id as string,label(status.name),...times,'1']
   requireValue(!row.some(cell => cell?.includes(grant)), 'provider_credential_in_response',502)
   rows.push(row)
  }
  requireValue(seen.size <= 2000, 'jira_issue_limit',413)
  if (data.isLast) {
   requireValue(data.nextPageToken === undefined || data.nextPageToken === null || data.nextPageToken === '', 'jira_inconsistent_cursor',502)
   const columns = Object.fromEntries(headers.map(name => [name,name === 'issue_count' ? 'number' : 'text'])) as Record<string,Column['type']>
   const source: Lineage = {kind:'jira-work',link:input.siteUrl+'/plugins/servlet/project-config/'+input.projectKey,description:'Permission-filtered current Jira work outcomes; search indexing may lag. No deletion, complete project or historical staffing inference.',from:'',to:'',timezone:'UTC',observedAt:new Date().toISOString(),schema:'Jira REST v3 '+jiraSchema.version+' sha256 '+jiraSchema.sha256,jira:{cloudId:input.cloudId,projectId:input.projectId,projectKey:input.projectKey,pages:page+1,issues:seen.size}}
   const retainedCells = new Set(rows.flat())
   let nullMarker = '__BIFOCAL_NULL__', markerIndex = 0
   while (retainedCells.has(nullMarker)) nullMarker = 'BIFOCAL_NULL_'+(++markerIndex)
   const csvRows = rows.map(row => row.map(cell => cell === null ? nullMarker : cell))
   return {rows:csvRows,columns,source,options:{nullValue:nullMarker,key:'issue_id'}}
  }
  requireValue(data.issues.length > 0 && typeof data.nextPageToken === 'string' && /^[A-Za-z0-9._~+=\/-]{1,2048}$/.test(data.nextPageToken) && !cursors.has(data.nextPageToken), 'jira_inconsistent_cursor',502)
  cursors.add(data.nextPageToken); cursor = data.nextPageToken
 }
 requireValue(false,'jira_page_limit',413)
}
