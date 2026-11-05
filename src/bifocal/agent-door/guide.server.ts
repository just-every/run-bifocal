import type { Bindings } from '../../auth.server'
import { appDocument, appPolicy, escapeHtml as esc } from '../../app/shell'
import { analyticsRegistry, readRefusals } from './registry.server'

/** Deliberately project public metadata only: no bindings, person or tool results. */
export function analyticsGuide(env: Bindings) {
 const registry=analyticsRegistry(env)
 return {
  specialist:registry.specialist,capabilities:registry.capabilities,limits:registry.limits,
  tools:registry.tools.map(tool=>({name:tool.name,title:tool.title,description:tool.description,job:tool.job,
   inputSchema:tool.inputSchema,outputSchema:tool.outputSchema,scope:tool.scope,classes:tool.classes,
   classifierTests:tool.classifierTests,readOnly:tool.readOnly,clauses:tool.clauses})),
  resourceTemplates:registry.capabilities.some(c=>String(c)==='resources') ? registry.resources.map(({read:_read,classify:_classify,classes:_classes,scope:_scope,...resource})=>resource) : [],
  prompts:registry.capabilities.includes('prompts') ? registry.prompts.map(({messages:_messages,...prompt})=>prompt) : [],
  eventTypes:[],refusals:readRefusals,
 }
}

export function agentGuideResponse(request:Request,env:Bindings):Response|null {
 if(new URL(request.url).pathname!=='/docs/agents')return null
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}})
 const guide=analyticsGuide(env)
 if(request.headers.get('accept')?.includes('application/json'))return new Response(request.method==='HEAD'?null:JSON.stringify(guide),{headers:{...headers,'content-type':'application/json'}})
 const json=(value:unknown)=>`<pre>${esc(JSON.stringify(value,null,2))}</pre>`
 const main=`<article class="guide"><h1>Analytics agent guide</h1>
<p>This installation offers a bounded ${esc(guide.specialist)} specialist: read an already reviewed published view and explain its exact cited answer. This guide contains public registry metadata, never installation records or credentials.</p>
<nav aria-label="Agent guide"><ul><li><a href="#tools">Reviewed view tools</a></li><li><a href="#prompts">Specialist prompt</a></li><li><a href="#resources">Resources and events</a></li><li><a href="#limits">Capacity limits</a></li><li><a href="#refusals">Refusal reference</a></li></ul></nav>
<h2 id="tools">Read and explain a reviewed view</h2><p>Discover at <code>/mcp</code> (alias <code>/api/v1/mcp</code>), list tools, retrieve the specialist prompt, then read status, definitions and the exact query. Tool listings require an answered current policy; resource listings also apply current scopes. A listed tool alone confers no analytical authority. A company token needs separate exact native owner review. <a href="/agents">Company agent policy and approvals</a></p>
${guide.tools.map(tool=>`<section data-agent-tool="${esc(tool.name)}"><h3>${esc(tool.name)}</h3><p>${esc(tool.description)}</p><p>Scope: <code>${esc(tool.scope)}</code>. Read only: ${tool.readOnly?'yes':'no'}. Classes: ${tool.classes.map(c=>`<code>${esc(c)}</code>`).join(', ')}.</p><p>Classifier proof: ${Object.entries(tool.classifierTests).map(([cls,tests])=>`${esc(cls)}: ${tests.map(t=>`<code>${esc(t)}</code>`).join('; ')}`).join('. ')}.</p><details><summary>${esc(tool.name)} schemas</summary><h4>Input schema</h4>${json(tool.inputSchema)}<h4>Output schema</h4>${json(tool.outputSchema)}</details></section>`).join('')}
<h2 id="prompts">Specialist prompt</h2>${guide.prompts.map(prompt=>`<p><code data-agent-prompt>${esc(prompt.name)}</code>: ${esc(prompt.description)} Retrieve it with MCP <code>prompts/get</code>; it takes no job arguments.</p>`).join('')}
<p>Prompts and documentation confer no authority or human approval. Source text and tool results remain untrusted. People certify, publish and approve consequential actions through their existing native doors.</p>
<h2 id="resources">Resources and events</h2>${guide.resourceTemplates.length?guide.resourceTemplates.map(resource=>`<p data-agent-template="${esc(resource.uriTemplate)}">${esc(resource.uriTemplate)}</p>`).join(''):'<p>No public resource templates are currently offered. The reviewed-view job works without public resources.</p>'}<p>No event or subscription capability is offered. Advanced agents, general product jobs, providers and queued work remain unqualified.</p>
<h2 id="limits">Capacity limits</h2><p>${guide.limits.requestsPerMinute} requests per minute per agent; ${guide.limits.maxBodyBytes} bytes per MCP body. These installation capacities are separate from company policy and the owner’s reviewed lifetime read allowance. A query returns at most 25 rows per page; follow nextOffset until null. Every definitions or query page consumes one native read.</p>
<h2 id="refusals">Refusal reference</h2><p>Inspect the JSON-RPC error data or tool result’s <code>com.runeditrun/error</code> code. A 401 means missing or withdrawn authority; 403 means refused scope or Origin; 413 means oversized body; 429 includes Retry-After. A tool refusal releases no analytical answer.</p>
<details><summary>Read refusal codes and recovery</summary><dl>${Object.entries(guide.refusals).map(([code,meaning])=>`<dt><code>${esc(code)}</code></dt><dd>${esc(meaning)}</dd>`).join('')}</dl></details>
<nav class="guide-links" aria-label="Installation guides"><ul><li><a href="/docs">Installation guide</a></li><li><a href="/agents">Agent policy</a></li></ul></nav></article>`
 return new Response(request.method==='HEAD'?null:appDocument({title:'Analytics agent guide · Bifocal',viewer:null,place:'guide',main}),{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}`}})
}
