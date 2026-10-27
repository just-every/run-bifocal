import {element,metadata,table} from './file-view.js'
import {impactSentence,stepProblem} from './preparation-errors.js'
import {operations} from './preparation-graph.js'

const operation=op=>operations[op]??op

export function showPreparationReview(box,value,previousVersion,restoreVersion){
 box.replaceChildren(metadata([
  ['Result',value.compatible?'Compatible draft':'Blocked draft'],['Current saved version',previousVersion??'New preparation'],
  ['Action',restoreVersion?'Restore revision '+restoreVersion+' as a new draft':'Save draft revision'],['Reviewed digest',value.digest],
  ['Output rows',value.output?.rows.length??'Unavailable'],['Output columns',value.output?.columns.length??'Unavailable']
 ]))
 box.append(table('Exact input source revisions',['Dataset','Revision'],value.sources.map(source=>[source.dataset,source.revision])))
 box.append(table('Step row counts',['Step','Operation','Input rows','Output rows'],value.diagnostics.map(step=>[step.step,step.operation,step.inputRows,step.outputRows])))
 // The blocked step reads as its plain sentence; its code stays on the table as data.
 if(value.error){const wrap=table('Preparation validation error',['Step','Operation','Error'],[[value.error.step,operation(value.error.operation),stepProblem(value.error.code,value.document?.steps[value.error.step-1])[1]]]);wrap.querySelector('table').dataset.code=value.error.code;box.append(wrap)}
 if(!value.error)box.append(element('p','No preparation validation errors.'))
 if(value.impact){
  const shown=value=>value===null?'Unavailable':Object.entries(value).map(([key,item])=>key+': '+(item.value??item.state)).join(', ')
  const impactTable=(...args)=>{const wrap=table(...args);wrap.classList.add('preparation-impact');return wrap}
  box.append(impactTable('Certified metric impact',['Metric','Certified revision','Published value','Staged value','Error','Published changed'],value.impact.metrics.map(metric=>[metric.name,metric.revision,shown(metric.before),shown(metric.after),metric.error?impactSentence(metric.error):'None','No'])))
  box.append(impactTable('Affected charts',['Chart','Published totals','Staged totals','Error','Published changed'],value.impact.charts.map(chart=>[chart.title,shown(chart.before),shown(chart.after),chart.error?impactSentence(chart.error):'None','No'])))
 }
 if(value.output){
  const {columns,rows,lineage}=value.output
  box.append(table('Output schema and column lineage',['Column','Type','Source dataset','Source revision','Source column'],columns.flatMap(column=>lineage[column.name].map(ref=>[column.name,column.type,ref.dataset,ref.revision,ref.column]))))
  const output=element('div'),navigation=element('div',undefined,'actions'),count=element('p')
  let page=0
  const back=element('button','Previous output rows'),next=element('button','Next output rows')
  back.type=next.type='button';back.id='prep-rows-previous';next.id='prep-rows-next'
  const render=()=>{const start=page*100,end=Math.min(start+100,rows.length);output.replaceChildren(table('Reviewed output rows',columns.map(column=>column.name),rows.slice(start,end)));count.textContent=rows.length?`Rows ${start+1}–${end} of ${rows.length}. NULL is shown explicitly.`:'0 output rows.';back.disabled=page===0;next.disabled=end>=rows.length}
  back.onclick=()=>{page--;render()};next.onclick=()=>{page++;render()}
  navigation.append(back,next);box.append(count,output,navigation);render()
 }
 const sql=element('details'),summary=element('summary','Reviewed equivalent native SQL')
 sql.append(summary,element('pre',value.sql));box.append(sql)
}
