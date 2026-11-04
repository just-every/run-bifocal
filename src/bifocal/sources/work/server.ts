import { runtimeBindings, type Bindings } from '../../../auth.server'
import { transact } from '../../../modules/import-kit/src/door/store.ts'
import { fileOwner } from '../../imports/files/owner.server'
import { RangeError } from '../spreadsheets/protocol'
import { boundedText, datasetId, inputBody, requireValue, token } from '../analytics/protocol'
import { readAudit } from '../analytics/audit.server'
import { planSource } from '../analytics/door.server'
import { lineage } from '../analytics/lineage'
import { jiraResources, readJira, selection, jiraCoverage } from './jira'
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
export async function jiraResponse(request: Request, original: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (!['/api/operator/work/jira/resources','/api/operator/work/jira/preview'].includes(path)) return null
 try {
  const env = runtimeBindings(original)
  // A machine bearer never borrows an accompanying native owner cookie.
  requireValue(!request.headers.has('authorization'), 'human_owner_required',401)
  const owner = await fileOwner(request,env)
  if (!owner) { if (request.body) await boundedText(request.body,32768,'analytics_request_limit'); requireValue(false,'owner_required',401) }
  requireValue(request.method === 'POST','method_not_allowed',405)
  const input = await inputBody(request), discovery = path.endsWith('/resources')
  requireValue(Object.keys(input).every(key => (discovery ? ['accessToken','confirmRead'] : ['accessToken','confirmRead','datasetId','cloudId','siteUrl','projectId','projectKey','catchup']).includes(key)), 'unsupported_source_field')
  requireValue(input.confirmRead === true, 'explicit_source_read_required')
  const grant = token(input.accessToken), {accessToken,...meaning} = input
  requireValue(!JSON.stringify(meaning).includes(grant),'credential_in_source')
  if (!discovery) requireValue(datasetId(input.datasetId) && (input.catchup === undefined || typeof input.catchup === 'boolean'),'jira_dataset_required')
  const chosen = discovery ? null : selection(input)
  const audit = readAudit(env,owner,discovery ? 'jira-discovery' : String(input.datasetId),meaning)
  const authorize = () => transact(env.DB,owner,[])
  await audit('consented')
  try {
   if (discovery) {
    const resources = await jiraResources(grant,authorize)
    await audit('staged') // This rechecks current owner authority before returning metadata.
    return Response.json({resources,coverage:jiraCoverage},{headers})
   }
   const data = await readJira(chosen!,grant,authorize)
   lineage(data.source)
   const response = await planSource(request,env,String(input.datasetId),data.rows,data.columns,data.source,input.catchup === true,data.options)
   await audit(response.ok ? 'staged' : 'refused')
   return response
  } catch(error) { await audit('failed'); throw error }
 } catch(error) {
  return Response.json({error:error instanceof RangeError ? error.code : 'jira_source_conflict'},{status:error instanceof RangeError ? error.status : 409,headers})
 }
}
