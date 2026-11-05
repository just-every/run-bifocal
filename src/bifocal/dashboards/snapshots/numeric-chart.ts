import {strToU8} from 'fflate'
import {exportTable} from '../../explore/table-export'
import {fail} from '../../query/types'
import type {ChartInput,ChartView} from '../../charts/view'

export type NumericChart={title:string;dimension:string;legend:string;unit:ChartView['columns'][number]['unit'];formatCode:string;rows:{label:string;value:string|null}[];x:number;y:number;w:number;h:number}
const xml=(value:string)=>{
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value)||[...value].some(c=>{const n=c.codePointAt(0)!;return n>=0xd800&&n<=0xdfff}))fail('chart_numeric_xml_character_refused',422)
 return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
}
/** No declarative transforms, interval scales or additional series are inferred. */
export function numericChart(chart:ChartInput&{title:string},view:ChartView):NumericChart{
 if(chart.visual.specification||view.mark!=='bar'||view.columns.length!==1||view.measure!==chart.visual.measure)fail('chart_numeric_requires_ordinary_single_series_bar',422)
 if(!view.rows.length||view.rows.length>40)fail('chart_numeric_category_limit_40',422)
 const column=view.columns[0],scale=column.scale
 if(column.unit==='money'&&chart.context.currency!=='USD')fail('chart_numeric_currency_not_supported',422)
 const digits='0'+(scale?'.'+'0'.repeat(scale):''),formatCode=column.unit==='money'?'"USD "'+digits+';-"USD "'+digits+';"USD "'+digits:digits+(column.unit==='percent'?'" %"':'')
 const rows=view.rows.map(row=>{
  const label=row.label===null?'NULL':String(row.label),value=row.values[view.measure]
  if(label.length>60||/[\r\n\t]/.test(label))fail('chart_numeric_category_label_does_not_fit',422)
  if(value.state!=='value'&&value.state!=='null')fail('chart_numeric_value_state_not_supported',422)
  if(value.state==='value'&&value.value===null)fail('chart_numeric_value_required',422)
  xml(label)
  return {label,value:value.state==='null'?null:value.value}
 })
 if(new Set(rows.map(row=>row.label)).size!==rows.length)fail('chart_numeric_ambiguous_category_labels',422)
 const result={title:chart.title,dimension:view.dimension,legend:view.measure,unit:column.unit,formatCode,rows,x:32,y:150,w:1216,h:650}
 // Reuse the typed export's XML and fifteen-digit precision refusals at review.
 numericWorkbook(result)
 xml(chart.title)
 return result
}
export function numericWorkbook(chart:NumericChart){
 return new Uint8Array(exportTable([{name:chart.dimension,type:'text'},{name:chart.legend,type:'number'}],chart.rows.map(row=>[row.label,row.value]),'xlsx').body as ArrayBuffer)
}
/** Internal worksheet references are chart bindings, never workbook formulas. */
export function numericChartXml(chart:NumericChart):Uint8Array{
 const c='http://schemas.openxmlformats.org/drawingml/2006/chart',a='http://schemas.openxmlformats.org/drawingml/2006/main',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships',n=chart.rows.length
 const rich=(text:string)=>'<c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>'+xml(text)+'</a:t></a:r></a:p></c:rich>'
 const textStyle='<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>'
 const strings='<c:strRef><c:f>Question!$A$2:$A$'+(n+1)+'</c:f><c:strCache><c:ptCount val="'+n+'"/>'+chart.rows.map((row,i)=>'<c:pt idx="'+i+'"><c:v>'+xml(row.label)+'</c:v></c:pt>').join('')+'</c:strCache></c:strRef>'
 const numbers='<c:numRef><c:f>Question!$B$2:$B$'+(n+1)+'</c:f><c:numCache><c:formatCode>'+xml(chart.formatCode)+'</c:formatCode><c:ptCount val="'+n+'"/>'+chart.rows.flatMap((row,i)=>row.value===null?[]:['<c:pt idx="'+i+'"><c:v>'+row.value+'</c:v></c:pt>']).join('')+'</c:numCache></c:numRef>'
 const format='<c:numFmt formatCode="'+xml(chart.formatCode)+'" sourceLinked="0"/>'
 return strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="'+c+'" xmlns:a="'+a+'" xmlns:r="'+r+'"><c:date1904 val="0"/><c:lang val="en-US"/><c:chart><c:title><c:tx>'+rich(chart.title)+'</c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Question!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>'+xml(chart.legend)+'</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="144073"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:cat>'+strings+'</c:cat><c:val>'+numbers+'</c:val></c:ser><c:dLbls>'+format+textStyle+'<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls><c:gapWidth val="150"/><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/>'+textStyle+'<c:crossAx val="2"/><c:crosses val="autoZero"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/>'+format+'<c:tickLblPos val="nextTo"/>'+textStyle+'<c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/>'+textStyle+'</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:externalData r:id="workbook"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>')
}
