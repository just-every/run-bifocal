import { appDocument, appPolicy, escapeHtml } from '../../app/shell'
import { referenceWorkload } from './workload'

const workloadFields = [
 ['internalReaders','Internal readers'],['refreshesPerSourceDaily','Refreshes per source daily'],
 ['portalTenants','Portal tenants'],['portalReaders','Portal readers per tenant'],
 ['retainedGB','Retained analytical data (GB)'],['newGBMonthly','New data monthly (GB)'],
 ['dashboards','Dashboards'],['tilesPerDashboard','Tiles per dashboard'],
 ['dashboardOpensDaily','Dashboard opens daily'],['peakUsers','Users at peak'],
 ['dailyChangeMBPerSource','Daily change set per source (MB)'],['weeklyBurstRuns','Weekly burst runs'],
 ['burstRecipients','Recipients per burst'],['alertEvaluationsDaily','Alert evaluations daily'],
 ['agentRunsMonthly','Bounded agent runs monthly'],
] as const
const rateFields = [
 ['product','Product fees','installation month'],['control','Cloudflare control plane','request'],
 ['compute','Analytical compute','compute hour'],['scan','Analytical scans','GB scanned'],
 ['storage','Analytical storage','GB month'],['refresh','Refresh and ingestion','GB ingested'],
 ['delivery','PDF and PPTX delivery','recipient burst'],['agents','External-model and agent infrastructure','run'],
 ['portal','Portal capacity','tenant month'],
] as const

export function costEstimatorPage(request: Request): Response | null {
 if(new URL(request.url).pathname !== '/cost-estimator')return null
 const headers = {'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}})
 const main = `<div class="pagehead"><div><h1>Monthly cost estimator</h1><p class="lead">Review a reference estate or enter your buyer workload before setup or source activation.</p></div></div>
<p class="note">Assumptions, not measurements. This calculator uses your dated USD rates. It starts no work, activates no source, reserves no budget and contacts no provider. Estimates are not guaranteed bills.</p>
<form id="cost-estimator" novalidate>
<section class="panel"><h2>Compute and rate provenance</h2><p>Enter the intended provider, size and region, then the rates you reviewed. No rate is prefilled or fetched.</p><div class="fields">
<label>Compute provider<input name="provider" maxlength="120" autocomplete="off"></label><label>Compute size<input name="size" maxlength="120"></label><label>Compute region<input name="region" maxlength="120"></label>
<label>Rate date<input name="rateDate" type="date"></label></div><label>Rate provenance or rate-card link<textarea name="reference" maxlength="500" placeholder="Where these owner-entered rates came from"></textarea></label><p class="hint">The date and provenance apply to all rates unless you supply an individual override below. Rates may exclude free allowances; account-specific tiers must be reflected in the entered rate.</p></section>
<details class="panel" id="workload"><summary>Buyer workload · reference estate</summary><p>All quantities are assumptions. Source count is derived from your named sources. Refreshes use the daily change set at hourly cadence; a different frequency scales ingestion proportionally.</p>
<label>Named sources (one per line)<textarea name="sources" rows="10">${referenceWorkload.sources.map(escapeHtml).join('\n')}</textarea></label><p id="source-count">Source count: ${referenceWorkload.sources.length}</p><div class="fields">${workloadFields.map(([name,label])=>`<label>${label}<input name="${name}" inputmode="numeric" value="${referenceWorkload[name]}"></label>`).join('')}</div><p>Each burst sends both PDF and PPTX in one recipient burst. Quantities use a 30-day refresh and scan month, four-week delivery month and 730 continuous compute hours.</p></details>
<section class="panel" id="rates"><h2>Owner-entered USD rates</h2><p>Supply every rate, including an explicit zero for a free line. Use up to six decimal places.</p>
${rateFields.map(([id,label,unit])=>`<fieldset data-rate="${id}"><legend>${label}</legend><label>${label} (USD per ${unit})<input name="rate-${id}" inputmode="decimal" autocomplete="off"></label><details><summary>Individual date and provenance</summary><div class="fields"><label>${label} rate date<input name="date-${id}" type="date"></label><label>${label} provenance<input name="reference-${id}" maxlength="500"></label></div></details></fieldset>`).join('')}
</section><details class="panel" id="licences"><summary>Source licences and tax</summary><p>Source-vendor licences and tax are excluded from the core total. Tax remains excluded from the full comparison. Enter your monthly licence total to compare it separately.</p><label class="checkbox"><input name="includeLicences" type="checkbox">Include source licences in full comparison</label><label>Source licences monthly (USD)<input name="licences" inputmode="decimal"></label></details>
<div class="actions"><button type="submit" class="primary">Calculate monthly estimate</button></div></form>
<p id="quote-status" class="status" role="status" aria-live="polite">Enter your rates to calculate an estimate.</p>
<section id="quote-result" hidden aria-labelledby="quote-heading"><h2 class="section" id="quote-heading">Monthly estimate</h2><p id="quote-context"></p><p class="quote-total">Core total: USD <output id="quote-total"></output></p><p id="quote-comparison" hidden></p><p>Source-vendor licences and tax are excluded from the core total. Every quantity below is assumed; rates are owner-entered.</p><div id="quote-lines"></div><details class="panel"><summary>Assumptions and limitations</summary><ul id="quote-assumptions"></ul><p id="quote-rounding"></p><p id="quote-uncertainty"></p><p id="quote-pricing"></p><p id="quote-spending"></p></details></section>
<noscript><p class="warning">Enable JavaScript to enter rates and calculate this estimate.</p></noscript>`
 const html=appDocument({title:'Monthly cost estimator · Bifocal',viewer:null,place:'settings',side:'<nav class="sidelist" aria-label="Settings and installation"><p class="side-heading">Settings</p><a href="/cost-estimator" aria-current="page">Monthly cost estimator</a><a href="/app/settings">Your settings</a><p class="side-heading">This installation</p><a href="/docs">Installation guide</a><a href="/">Lobby</a></nav>',main,head:'<link rel="stylesheet" href="/bifocal/cost-estimator.css"><script type="module" src="/bifocal/cost-estimator.js"></script>'})
 return new Response(request.method==='HEAD'?null:html,{headers})
}
