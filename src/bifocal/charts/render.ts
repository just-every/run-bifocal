import type { Snapshot } from '../data/snapshots/store'
import { fail, type Value } from '../query/types'

export const chartTypes = ['vertical-bar','horizontal-bar','line','stepped-line','area','sparkline','table','kpi'] as const
export type ChartType = typeof chartTypes[number]
export type ChartOptions = { type: ChartType; measure: string; scale: 'linear' | 'log'; width: number }
const xml = (value: unknown): string => {
 const text=String(value)
 for(const character of text) {
  const code=character.codePointAt(0)!
  if ((code<32 && ![9,10,13].includes(code)) || (code>=0xd800 && code<=0xdfff) || [0xfffe,0xffff].includes(code)) fail('chart_text_not_xml')
 }
 return text.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]!))
}

/** Formatting preserves the exact decimal string; floating point is geometry only. */
export function displayValue(value: Value, currency: string): string {
 if (value.state !== 'value') return value.state === 'null' ? 'Missing' : value.state[0].toUpperCase() + value.state.slice(1)
 const decimal = value.value!, [integer, fraction] = decimal.split('.')
 const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction)
 return value.unit === 'money' ? `${currency} ${grouped}` : value.unit === 'percent' ? `${grouped}%` : grouped
}
export function chartOptions(snapshot: Snapshot, type: string, search: URLSearchParams): ChartOptions {
 if (!chartTypes.includes(type as ChartType)) fail('chart_type_not_supported')
 if ([...search.keys()].some(key => !['measure','scale','width'].includes(key)) || [...search.keys()].some(key => search.getAll(key).length !== 1)) fail('chart_option_not_supported',400)
 const requestedWidth=search.get('width') ?? '720'
 if(!/^[0-9]{3,4}$/.test(requestedWidth) || Number(requestedWidth)<320 || Number(requestedWidth)>1440) fail('chart_width_out_of_range')
 const measure = search.get('measure') ?? snapshot.definition.measures[0].id, scale = search.get('scale') ?? 'linear'
 if (!snapshot.definition.measures.some(item => item.id === measure)) fail('chart_measure_not_found')
 if (!['linear','log'].includes(scale)) fail('chart_scale_not_supported')
 if (scale === 'log' && !['line','stepped-line','sparkline'].includes(type)) fail('chart_log_requires_line')
 // Never discard extra groups or quietly take the first page.
 if (snapshot.answer.rows.length > 40) fail('chart_group_limit_40')
 return {type: type as ChartType, measure, scale: scale as ChartOptions['scale'], width:Number(requestedWidth)}
}
export function chartData(snapshot: Snapshot, options: ChartOptions) {
 const rows = snapshot.answer.rows.map(row => ({dimensions: row.dimensions, label: row.dimensions.map(cell => cell === null ? '(Missing dimension)' : String(cell)).join(' · ') || 'All rows', value: row.values[options.measure], formatted: displayValue(row.values[options.measure],snapshot.context.currency)}))
 const values = (options.type === 'kpi' ? [snapshot.answer.totals[options.measure]] : rows.map(row => row.value)).filter(value => value.state === 'value').map(value => Number(value.value))
 if (values.some(value => !Number.isFinite(value))) fail('chart_geometry_out_of_range')
 if (options.scale === 'log' && values.some(value => value <= 0)) fail('chart_log_requires_positive_values')
 return {version:1, renderer:'native-svg-v1', options, queryId:snapshot.queryId, digest:snapshot.digest, createdAt:snapshot.createdAt, filters:snapshot.definition.filters, modelVersion:snapshot.context.definitionVersions?.model, metricVersion:snapshot.context.definitionVersions?.metrics, sources:snapshot.answer.sourceWatermarks, rows, total:snapshot.answer.totals[options.measure], totalFormatted:displayValue(snapshot.answer.totals[options.measure],snapshot.context.currency), geometry:'IEEE-754 coordinates only; labels and data retain exact query decimals'}
}
export function chartSvg(snapshot: Snapshot, options: ChartOptions): string {
 const data = chartData(snapshot, options), width=options.width, left=76, right=width-36
 const chunks=(value:string,limit=Math.floor((width-left-24)/16))=>Array.from(value).reduce<string[]>((parts,character)=>{if(!parts.length||Array.from(parts.at(-1)!).length>=limit)parts.push('');parts[parts.length-1]+=character;return parts},[])
 const heading=chunks(options.measure), headingOffset=(heading.length-1)*22, plotTop=110+headingOffset, plotBottom=plotTop+260
 const numbers = data.rows.filter(row => row.value.state === 'value').map(row => Number(row.value.value))
 const transformed = numbers.map(value => options.scale === 'log' ? Math.log10(value) : value)
 let low = options.scale === 'log' ? Math.min(...transformed, 0) : Math.min(0,...transformed), high = Math.max(0,...transformed)
 if (options.scale === 'log' && transformed.length) { low = Math.min(...transformed); high = Math.max(...transformed) }
 if (low === high) {low -= options.scale === 'log' ? 1 : 0; high += 1}
 // Normalize before subtracting so opposite extreme finite values cannot overflow.
 const magnitude = Math.max(Math.abs(low),Math.abs(high),1), minimum=low/magnitude, range=high/magnitude-minimum
 const fraction=(value:number)=>((options.scale === 'log' ? Math.log10(value) : value)/magnitude-minimum)/range
 const y=(value:number)=>plotBottom-fraction(value)*(plotBottom-plotTop)
 const x=(index:number)=>left+(index+.5)*(right-left)/Math.max(data.rows.length,1)
 const text=(x:number,y:number,label:string,extra='')=>`<text x="${x}" y="${y}" ${extra}>${xml(label)}</text>`
 const line=(x1:number,y1:number,x2:number,y2:number,extra='')=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#43536b" ${extra}/>`
 const group=(label:string,content:string)=>`<g tabindex="0" role="img" aria-label="${xml(label)}"><title>${xml(label)}</title>${content}</g>`
 let graphic = ''
 if (!data.rows.length && options.type !== 'kpi') graphic=chunks('No groups match the retained query filters.').map((label,index)=>text(left,plotTop+60+index*22,label)).join('')
 else if (options.type === 'kpi') graphic=group(`${options.measure}: ${data.totalFormatted}`,chunks(data.totalFormatted,Math.floor((width-left-24)/32)).map((label,index)=>text(left,plotTop+50+index*38,label,'font-size="32"')).join(''))
 else if (options.type === 'table') graphic=chunks('Exact grouped values are listed below.').map((label,index)=>text(left,plotTop+50+index*22,label)).join('')
 else if (options.type === 'horizontal-bar') {
  const zero=left+fraction(0)*(right-left)
  graphic=line(zero,plotTop,zero,plotBottom)
  data.rows.forEach((row,index)=>{
   const cy=plotTop+(index+.5)*(plotBottom-plotTop)/data.rows.length, h=Math.min(24,(plotBottom-plotTop)/data.rows.length*.7)
   if(row.value.state!=='value') {graphic+=text(left,cy,row.formatted);return}
   const px=left+fraction(Number(row.value.value))*(right-left)
   graphic+=text(12,cy+5,String(index+1))
   graphic+=group(`${row.label}: ${row.formatted}`,`<rect x="${Math.min(zero,px)}" y="${cy-h/2}" width="${Math.abs(px-zero)}" height="${h}" fill="#175397" stroke="#102a43"/>`)
  })
 } else {
  const zero=options.scale==='log'?plotBottom:y(0)
  graphic=line(left,zero,right,zero)+line(left,plotTop,left,plotBottom)
  graphic+=text(4,plotTop+4,options.scale==='log'?`10^${high.toFixed(2)}`:String(high),'font-size="12"')+text(4,plotBottom+15,options.scale==='log'?`10^${low.toFixed(2)}`:String(low),'font-size="12"')
  let segment: {x:number;y:number}[]=[]
  const flush=()=>{
   if(!segment.length)return
   let path=`M ${segment[0].x} ${segment[0].y}`
   for(const point of segment.slice(1)) path+=options.type==='stepped-line'?` H ${point.x} V ${point.y}`:` L ${point.x} ${point.y}`
   if(options.type==='area')path+=` L ${segment.at(-1)!.x} ${zero} L ${segment[0].x} ${zero} Z`
   graphic+=`<path d="${path}" fill="${options.type==='area'?'#dbe8f6':'none'}" stroke="#175397" stroke-width="3"/>`;segment=[]
  }
  data.rows.forEach((row,index)=>{
   const cx=x(index)
   if(row.value.state!=='value') {flush();graphic+=group(`${row.label}: ${row.formatted}`,text(cx,plotBottom+26,'×','text-anchor="middle" font-size="16"'));return}
   const cy=y(Number(row.value.value))
   if(options.type==='vertical-bar') {
    const w=Math.min(42,(right-left)/data.rows.length*.7)
    graphic+=group(`${row.label}: ${row.formatted}`,`<rect x="${cx-w/2}" y="${Math.min(cy,zero)}" width="${w}" height="${Math.abs(cy-zero)}" fill="#175397" stroke="#102a43"/>`)
   } else segment.push({x:cx,y:cy})
  });flush()
  // Markers are drawn last so area fills never cover them.
  data.rows.forEach((row,index)=>{if(row.value.state==='value')graphic+=group(`${row.label}: ${row.formatted}`,`<circle cx="${x(index)}" cy="${y(Number(row.value.value))}" r="4" fill="#102a43"/>`);graphic+=text(x(index),plotBottom+52,String(index+1),'text-anchor="middle" font-size="12"')})
 }
 let tableY=plotBottom+110, table=''
 data.rows.forEach((row,index)=>{
  const labels=chunks(`${index+1}. ${row.label}`), values=chunks(row.formatted)
  const title=`${row.label}: ${row.formatted}`
  table+=`<g role="row" tabindex="0" aria-label="${xml(title)}"><g role="cell" aria-label="${xml(row.label)}">${labels.map((label,offset)=>text(left,tableY+offset*22,label)).join('')}</g><g role="cell" aria-label="${xml(row.formatted+' · '+row.value.state)}">${values.map((label,offset)=>text(left,tableY+(labels.length+offset)*22,label)).join('')}</g></g>`
  tableY+=(labels.length+values.length)*22+16
 })
 if(!data.rows.length)table=text(left,tableY,'No grouped rows.'); else tableY-=16
 const height=Math.max(560,tableY+80), title=`${options.measure} · ${options.type}`
 return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="chart-title chart-description"><title id="chart-title">${xml(title)}</title><desc id="chart-description">Retained exact query. ${xml(options.scale)} scale. Numbered marks correspond to the exact values below. Missing, unknown, suppressed and incomplete values have no numeric mark; a cross below the plot refers to their named state in the table. Line gaps are not connected. Source and filter metadata is embedded.</desc><metadata>${xml(JSON.stringify(data))}</metadata><rect width="${width}" height="${height}" fill="#ffffff"/><g fill="#102a43" font-family="sans-serif" font-size="16">${heading.map((label,index)=>text(left,28+index*22,label)).join('')}${text(left,52+headingOffset,options.type)}${text(left,76+headingOffset,`${options.scale} scale · ${data.rows.length} groups`,'font-size="13"')}${graphic}${text(left,plotBottom+80,'Exact values and data states','font-weight="bold" font-size="14"')}<g role="table" aria-label="Exact chart values">${table}</g>${text(12,height-24,'Retained owner snapshot; no live refresh.','font-size="12"')}</g></svg>`
}
