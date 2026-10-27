import { escapeHtml } from '../../app/shell'
import type { Cell, Value } from '../query/types'
import type { ChartView } from './view'
import { chartPlot } from './plot'

export const cellText=(value:Cell)=>value===null?'NULL':String(value)
export function valueText(value:Value,currency:string) {
 if(value.state!=='value')return value.state.toUpperCase()+(value.reason?' · '+value.reason:'')
 return (value.unit==='money'?currency+' ':'')+value.value+(value.unit==='percent'?'%':'')
}
export function chartFigure(view:ChartView,currency:string,annotations:{point:string;body:string;revision:number}[]=[]) {
 const {points,zero}=chartPlot(view)
 const heading=view.measure+(view.end?' to '+view.end:'')+' by '+view.dimension
 return `<figure class="native-chart panel" aria-labelledby="chart-heading"><h2 id="chart-heading">${escapeHtml(heading)}</h2><figcaption>${view.language?escapeHtml(view.language)+' bounded native specification. ':''}${view.end?'Intervals show the declared start and end fields. ':view.mark==='point'?'Points show the declared quantitative field. ':'Horizontal bars share a zero baseline. Negative values extend left; positive values extend right. Zero is a dot; unavailable values have no bar. '}Exact values appear with their units and in the table.${view.language?' Supported constructs are field bindings, linear scales, exact arithmetic, sums, cumulative sums and retained-value filters. Other constructs are refused.':''}</figcaption>${view.rows.length?`<ol>${view.rows.map((row,index)=>{
  const point=points[index],value=row.values[view.end??view.measure],shown=(view.end?valueText(row.values[view.measure],currency)+' to ':'')+valueText(value,currency)
  const start=point.start,end=point.end,inside=(x:number)=>x>=0&&x<=600
  const mark=end===null||start===null?'':view.mark==='point'||start===end?(inside(end)?`<circle cx="${end}" cy="12" r="3"/>`:''):`<rect class="chart-bar" x="${Math.max(0,Math.min(start,end))}" y="4" width="${Math.max(0,Math.min(600,Math.max(start,end))-Math.max(0,Math.min(start,end)))}" height="16"/>`
  return `<li data-value-state="${value.state}"><p><strong>${escapeHtml(cellText(row.label))}</strong> · ${escapeHtml(shown)}</p><svg viewBox="-4 0 608 24" aria-hidden="true" focusable="false">${inside(zero)?`<line class="chart-zero" x1="${zero}" x2="${zero}" y1="0" y2="24"/>`:''}${mark}</svg>${annotations.filter(annotation=>annotation.point===row.label).map(annotation=>`<p class="metric-annotation">${escapeHtml(annotation.body)} · Metric revision ${annotation.revision}</p>`).join('')}</li>`
 }).join('')}</ol>`:'<p role="status">No matching groups.</p>'}</figure>`
}
export function chartTable(view:ChartView,currency:string) {
 return `<section class="panel tablepanel chart-table"><div class="tablewrap" tabindex="0" role="region" aria-label="Exact chart values"><table><caption>Exact grouped values and totals</caption><thead><tr><th scope="col">${escapeHtml(view.dimension)}</th>${view.columns.map(column=>`<th scope="col">${escapeHtml(column.id)} (${escapeHtml(column.unit+(column.unit==='money'?' · '+currency:''))})</th>`).join('')}</tr></thead><tbody>${view.rows.map(row=>`<tr><th scope="row">${escapeHtml(cellText(row.label))}</th>${view.columns.map(column=>{const value=row.values[column.id];return `<td data-state="${value.state}" data-unit="${value.unit}">${escapeHtml(valueText(value,currency))}</td>`}).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">${view.language?'Retained query totals':'Total'}</th>${view.columns.map(column=>`<td>${escapeHtml(valueText(view.totals[column.id],currency))}</td>`).join('')}</tr></tfoot></table></div></section>`
}
