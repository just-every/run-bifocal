import {operatorAuth,runtimeBindings,type Bindings} from '../../auth.server'
import {appDocument,appPolicy,escapeHtml} from '../../app/shell'
import {transact} from '../../modules/import-kit/src/door/store.ts'
import {fileOwner} from '../imports/files/owner.server'
import {displayZone} from '../company/display-zone'

export async function dashboardTVPage(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/app\/dashboards\/([a-f0-9-]{36})\/tv$/.exec(url.pathname)
 if(!match)return null
 const env=runtimeBindings(original),session=await operatorAuth(env).getSession(request)
 if(!session)return new Response(null,{status:303,headers:{location:'/signin?returnTo='+encodeURIComponent(url.pathname),'cache-control':'no-store'}})
 const owner=await fileOwner(request,env)
 if(!owner)return new Response('Dashboard TV requires the current installation owner.',{status:403,headers:{'cache-control':'no-store'}})
 if(request.method!=='GET')return new Response(null,{status:405})
 if(url.search)return new Response('Query parameters are not supported.',{status:400})
 await transact(env.DB,owner,[])
 const main=`<section id="dashboard-tv" class="dashboard-tv" data-id="${match[1]}"><nav aria-label="Dashboard navigation"><a href="/app/dashboards/${match[1]}">Back to saved dashboard</a></nav><h1 id="tv-title">Dashboard TV</h1><p class="lead">Current source results beside their freshness and last successful refresh.</p><form id="tv-controls" class="panel"><div class="fields"><label>Refresh interval (seconds)<input id="tv-interval" aria-label="Refresh interval (seconds)" type="number" min="1" max="86400" step="1" value="60" required></label><label>Maximum source age (seconds)<input id="tv-max-age" aria-label="Maximum source age (seconds)" type="number" min="1" max="31536000" step="1" value="86400" required></label></div><div class="actions"><button id="tv-start" type="button" class="primary">Start</button><button id="tv-pause" type="button" disabled>Pause</button><button id="tv-refresh" type="submit">Refresh now</button><button id="tv-fullscreen" type="button">Enter fullscreen</button></div><p id="tv-timer" class="hint">Automatic refresh paused. Start runs only while this page is open.</p></form><p id="tv-status" class="status" role="status" aria-live="polite">Loading the current dashboard once. Automatic refresh is paused.</p><p class="note">Each tile refreshes independently. Retained dashboard snapshots stay unchanged. Failed tiles may show clearly dated last-good values; withdrawn access clears displayed values.</p><div id="tv-cards" class="tv-cards" aria-label="Dashboard tiles"></div><noscript><p>Enable JavaScript to refresh this dashboard.</p></noscript></section>`
 return new Response(appDocument({title:'Dashboard TV · Bifocal',viewer:session.operator,place:'answers',body:` data-dashboard-tv="true" data-zone="${escapeHtml(await displayZone(env,session.operator.email))}"`,head:'<link rel="stylesheet" href="/bifocal/dashboard-tv.css"><script type="module" src="/bifocal/dashboard-tv.js"></script>',main}),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`}})
}
