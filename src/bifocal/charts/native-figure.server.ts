import {escapeHtml} from '../../app/shell'
import {figure} from '../../app/figure'
import type {ChartView} from './view'
import {nativeGeometry} from './geometry'
import {cellText,valueText} from './figure.server'

const names:Record<string,string>={'vertical-bar':'Vertical bars',line:'Line','stepped-line':'Stepped line',area:'Area'}
export function nativeFigure(view:ChartView,currency:string) {
 const geometry=nativeGeometry(view),unit=view.columns.find(column=>column.id===view.measure)!.unit
 const amount=(value:string)=>figure(value,unit,currency),position=(point:{x:number;y:number})=>(point.x+70)+','+(point.y+30)
 const zero=geometry.zero+30,barWidth=Math.min(50,420/Math.max(1,view.rows.length)),markName=names[view.mark]
 const marks=view.mark==='vertical-bar'?geometry.points.map(point=>point.y===null?'':point.y+30===zero?`<circle cx="${point.x+70}" cy="${zero}" r="4"/>`:`<rect x="${point.x+70-barWidth/2}" y="${Math.min(point.y+30,zero)}" width="${barWidth}" height="${Math.abs(point.y+30-zero)}"/>`).join(''):geometry.segments.map(segment=>{
  const points=segment.map(position).join(' '),path=view.mark==='area'?`<polygon class="native-area" points="${segment[0].x+70},${zero} ${points} ${segment[segment.length-1].x+70},${zero}"/>`:''
  return path+`<polyline class="native-line" points="${points}"/>`
 }).join('')+geometry.points.map(point=>point.y===null?'':`<circle cx="${point.x+70}" cy="${point.y+30}" r="4"/>`).join('')
 const heading=view.measure+' by '+view.dimension,legend=markName+' · '+view.measure+' · '+(unit==='money'?currency:unit)
 const alt=view.rows.map((row,index)=>(index+1)+'. '+cellText(row.label)+': '+valueText(row.values[view.measure],currency,true)).join('; ')
 return `<figure class="native-chart native-series panel" aria-labelledby="chart-heading"><h2 id="chart-heading">${escapeHtml(heading)}</h2><figcaption>${escapeHtml(markName)}. ${escapeHtml(view.order!.field)} ordered ${escapeHtml(view.order!.direction)}, missing values ${view.order!.nulls}. Unavailable values leave gaps. ${view.scale.zero?'The linear scale includes zero.':'The linear scale fits the available values.'} Numbered positions match the exact labeled values below.</figcaption><p class="chart-legend"><span aria-hidden="true">●</span> ${escapeHtml(legend)}</p>${view.rows.length?`<p class="series-scale">Top ${escapeHtml(amount(view.scale.reverse?geometry.low:geometry.high))} · Bottom ${escapeHtml(amount(view.scale.reverse?geometry.high:geometry.low))}</p><div class="plot-scroll" tabindex="0" role="region" aria-label="${escapeHtml(markName)} plot"><svg class="series-plot" viewBox="0 0 700 380" role="img" aria-labelledby="series-title series-description"><title id="series-title">${escapeHtml(legend)}</title><desc id="series-description">${escapeHtml(alt)}</desc>${zero>=30&&zero<=330?`<line class="chart-zero" x1="70" x2="670" y1="${zero}" y2="${zero}"/>`:''}<g class="series-marks">${marks}</g></svg><div class="series-axis" aria-hidden="true">${geometry.points.map(point=>`<span>${point.index%Math.max(1,Math.ceil(view.rows.length/12))===0||point.index===view.rows.length-1?point.index+1:''}</span>`).join('')}</div></div><ol class="series-values">${view.rows.map((row,index)=>`<li data-value-state="${row.values[view.measure].state}"><strong>${index+1}. ${escapeHtml(cellText(row.label))}</strong> · ${escapeHtml(valueText(row.values[view.measure],currency,true))}</li>`).join('')}</ol>`:'<p role="status">No matching groups.</p>'}</figure>`
}
