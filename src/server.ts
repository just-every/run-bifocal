import { withDemo } from './modules/demo/index.mjs'
import { seedDemo } from './demo'
import { rejectedResponse } from './base/rejected-response'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { spreadsheetRangeResponse } from './bifocal/sources/spreadsheets/server'
import { fileImportPage } from './bifocal/imports/files/page.server'
import { companyPage } from './bifocal/company/page.server'
import { conventionsResponse } from './bifocal/company/server'
import { exactAnswerPage } from './bifocal/query/page.server'
import { exactQueryResponse } from './bifocal/query/server'
import { dashboardDefinitionResponse } from './bifocal/dashboards/definitions.server'
import { goalResponse } from './bifocal/goals/server'
import { qualityResponse } from './bifocal/quality/server'
import { metricResponse } from './bifocal/metrics/store.server'
import { metricDefinitionResponse } from './bifocal/metrics/definitions.server'
import { chartResponse } from './bifocal/charts/server'
import { policyDefinitionResponse } from './bifocal/policies/server'
import { policyDefinitionPage } from './bifocal/policies/page.server'
import { warehouseResponse } from './bifocal/exports/warehouse/server'
import { analyticsSourceResponse } from './bifocal/sources/analytics/server'
import { reportCustodyResponse } from './bifocal/reports/server'
import { reportRunPage } from './bifocal/reports/page.server'
import { catalogResponse } from './bifocal/catalog/server'
import { catalogPage } from './bifocal/catalog/page.server'
import { modelPage } from './bifocal/models/page.server'
import { modelAuthoringResponse } from './bifocal/models/authoring.server'
import { semanticResponse } from './bifocal/models/validation/server'
import { explorationResponse } from './bifocal/explore/server'
import { explorationPage } from './bifocal/explore/page.server'
import { questionPage } from './bifocal/questions/page.server'
import { questionResponse } from './bifocal/questions/server'
import { calculationPage } from './bifocal/calculations/page.server'
import { calculationResponse } from './bifocal/calculations/server'
import { calculationImportResponse } from './bifocal/calculations/library/import.server'
import { fileImportResponse } from './bifocal/imports/files/server'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', (context) => context.json({ status: 'ok', ...deploymentHealth(context.env) }))

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo<Bindings, ExportedHandler<Bindings>>({
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const auth = await authResponse(request, env)
    if (auth) return auth
    const settings = await companyPage(request, env)
    if (settings) return settings
    const conventions = await conventionsResponse(request, env)
    if (conventions) return conventions
    const goal = await goalResponse(request, env)
    if (goal) return goal
    const quality = await qualityResponse(request, env)
    if (quality) return quality
    const policyPage = await policyDefinitionPage(request, env)
    if (policyPage) return policyPage
    const policy = await policyDefinitionResponse(request, env)
    if (policy) return policy
    const chart = await chartResponse(request, env)
    if (chart) return chart
    const metricDefinition = await metricDefinitionResponse(request, env)
    if (metricDefinition) return metricDefinition
    const metrics = await metricResponse(request, env)
    if (metrics) return metrics
    const answer = await exactAnswerPage(request, env)
    if (answer) return answer
    const reportDocument = await reportRunPage(request,env)
    if(reportDocument)return reportDocument
    const custody = await reportCustodyResponse(request, env)
    if (custody) return custody
    const libraryDocument = await catalogPage(request,env)
    if(libraryDocument)return libraryDocument
    const catalog = await catalogResponse(request, env)
    if (catalog) return catalog
    const questionDocument = await questionPage(request,env)
    if(questionDocument)return questionDocument
    const naturalQuestion = await questionResponse(request,env)
    if(naturalQuestion)return naturalQuestion
    const calculationsDocument = await calculationPage(request,env)
    if(calculationsDocument)return calculationsDocument
    const calculations = await calculationResponse(request,env)
    if(calculations)return calculations
    const calculationImports = await calculationImportResponse(request,env)
    if(calculationImports)return calculationImports
    const modelsPage = await modelPage(request, env)
    if (modelsPage) return modelsPage
    const authoring = await modelAuthoringResponse(request, env)
    if (authoring) return authoring
    const semantic = await semanticResponse(request, env)
    if (semantic) return semantic
    const explorationDocument = await explorationPage(request, env)
    if (explorationDocument) return explorationDocument
    const exploration = await explorationResponse(request, env)
    if (exploration) return exploration
    const dashboardDefinition = await dashboardDefinitionResponse(request, env)
    if (dashboardDefinition) return dashboardDefinition
    const query = await exactQueryResponse(request, env)
    if (query) return query
    const warehouse = await warehouseResponse(request, env)
    if (warehouse) return warehouse
    const analyticsSource = await analyticsSourceResponse(request, env)
    if (analyticsSource) return analyticsSource
    const range = await spreadsheetRangeResponse(request, env)
    if (range) return range
    const page = await fileImportPage(request, env)
    if (page) return page
    const files = await fileImportResponse(request, env)
    if (files) return files
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    return rejectedResponse(request, await dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request))))
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
