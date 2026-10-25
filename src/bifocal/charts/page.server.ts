import { appDocument, appPolicy, escapeHtml, type Viewer } from '../../app/shell'
import type { Cell, Value } from '../query/types'
import type { readChart } from './store.server'
type Chart=Awaited<ReturnType<typeof readChart>>
const cell=(value:Cell)=>value===null?'NULL':String(value)
function valueText(value:Value,currency:string) {
 if(value.state!=='value')return value.state.toUpperCase()+(value.reason?' · '+value.reason:'')
 return (value.unit==='money'?currency+' ':'')+value.value+(value.unit==='percent'?'%':'')
}
// All plotted measures share one declared scale. BigInt retains arbitrarily
// large exact decimal magnitudes; only bounded pixel coordinates become Number.
function magnitude(value:Value):bigint|null {
 if(value.state!=='value'||value.value===null)return null
 return BigInt(value.value.replace('.',''))
}
function figure(chart:Chart) {
 const values=chart.answer.rows.map(row=>magnitude(row.values[chart.visual.measure]))
 let low=0n,high=0n
 for(const value of values)if(value!==null){if(value<low)low=value;if(value>high)high=value}
 const range=high-low,coordinate=(value:bigint)=>range?Number((value-low)*600000n/range)/1000:300
 const zero=coordinate(0n)
 return `<figure class="native-chart panel" aria-labelledby="chart-heading"><h2 id="chart-heading">${escapeHtml(chart.visual.measure)} by ${escapeHtml(chart.visual.dimension)}</h2><figcaption>Horizontal bars share a zero baseline. Negative values extend left; positive values extend right. Zero is a dot; unavailable values have no bar. Exact values appear with their units and in the table.</figcaption>${chart.answer.rows.length?`<ol>${chart.answer.rows.map((row,index)=>{
  const value=values[index],shown=valueText(row.values[chart.visual.measure],chart.context.currency)
  const mark=value===null?'':value===0n?`<circle cx="${zero}" cy="12" r="3"/>`:`<rect class="chart-bar" x="${Math.min(zero,coordinate(value))}" y="4" width="${Math.abs(coordinate(value)-zero)}" height="16"/>`
  return `<li data-value-state="${row.values[chart.visual.measure].state}"><p><strong>${escapeHtml(cell(row.dimensions[0]))}</strong> · ${escapeHtml(shown)}</p><svg viewBox="-4 0 608 24" aria-hidden="true" focusable="false"><line class="chart-zero" x1="${zero}" x2="${zero}" y1="0" y2="24"/>${mark}</svg></li>`
 }).join('')}</ol>`:'<p role="status">No matching groups.</p>'}</figure>`
}
export function chartPage(chart:Chart,viewer:Viewer) {
 const measures=chart.definition.measures,unit=(value:Value)=>value.unit+(value.unit==='money'?' · '+chart.context.currency:'')
 const table=`<section class="panel tablepanel chart-table"><div class="tablewrap" tabindex="0" role="region" aria-label="Exact chart values"><table><caption>Exact grouped values and totals</caption><thead><tr><th scope="col">${escapeHtml(chart.visual.dimension)}</th>${measures.map(measure=>`<th scope="col">${escapeHtml(measure.id)} (${escapeHtml(unit(chart.answer.totals[measure.id]))})</th>`).join('')}</tr></thead><tbody>${chart.answer.rows.map(row=>`<tr><th scope="row">${escapeHtml(cell(row.dimensions[0]))}</th>${measures.map(measure=>{const value=row.values[measure.id];return `<td data-state="${value.state}" data-unit="${value.unit}">${escapeHtml(valueText(value,chart.context.currency))}</td>`}).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">Total</th>${measures.map(measure=>`<td>${escapeHtml(valueText(chart.answer.totals[measure.id],chart.context.currency))}</td>`).join('')}</tr></tfoot></table></div></section>`
 const main=`<h1>${escapeHtml(chart.title)}</h1><p class="meta">Retained chart · ${escapeHtml(chart.createdAt)} · not certified</p><p class="note">This immutable chart keeps its original answer, source snapshots and conventions.</p>${figure(chart)}${table}<p><a href="/app/queries/${chart.queryId}">Open the retained exact answer</a></p><details class="panel"><summary>Definition, exact values and retained context</summary><pre>${escapeHtml(JSON.stringify({definition:chart.definition,visual:chart.visual,answer:chart.answer,context:chart.context,digest:chart.digest},null,2))}</pre></details>`
 return new Response(appDocument({title:chart.title+' · Bifocal',viewer,place:'answers',head:'<link rel="stylesheet" href="/bifocal/charts.css">',main}),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ${appPolicy}`}})
}
