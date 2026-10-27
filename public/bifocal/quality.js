import {element,table} from './file-view.js'
import {stamp,figure,label} from './format.js'

/** Shared quality disclosure for an answer and every retained board card. */
export function qualityNotice(quality,zone) {
 const notice=element('div',undefined,'quality-notice')
 if(!quality)return notice
 notice.append(element('p','Quality '+quality.state,quality.state==='healthy'?'meta':'warning'))
 if(quality.lastGood) {
  const last=quality.lastGood,link=element('a','Retained last-good result');link.href='/app/queries/'+last.queryId
  const dated=element('p',undefined,'meta');dated.append(link,' · saved '+stamp(last.createdAt,zone)+' · checked '+stamp(last.checkedAt,zone));notice.append(dated)
  const values=element('details');values.append(element('summary','Last-good values'),table('Retained last-good totals',['Measure','Value'],Object.entries(last.answer.totals).map(([id,value])=>[label(id),value.state==='value'?figure(value.value,value.unit,last.currency):value.state])));notice.append(values)
 } else notice.append(element('p','No qualified last-good result has been retained for this answer.','meta'))
 const tests=element('ul')
 for(const test of quality.tests.filter(test=>test.state!=='passed')) {
  const row=element('li'),name=test.name??test.dataset
  if(test.href){const link=element('a',name+' · '+test.state);link.href=test.href;row.append(link)}else row.append(name+' · '+test.state)
  row.append(' · '+test.reason.replaceAll('_',' '))
  if(test.checkedAt)row.append(' · checked '+stamp(test.checkedAt,zone))
  if(test.waiver)row.append(' · waiver '+(test.waiver.active?'active':'expired')+': '+test.waiver.reason+' · expires '+stamp(test.waiver.expiresAt,zone))
  tests.append(row)
 }
 if(tests.childElementCount)notice.append(tests)
 if(quality.lineage) {
  const detail=element('details'),summary=element('summary','Source columns and definition lineage'),list=element('ul')
  for(const source of quality.lineage)list.append(element('li',source.dataset+': '+(source.columns.join(', ')||'row count')))
  list.append(element('li','Model revision: '+quality.modelRevision))
  if(quality.metric)list.append(element('li','Metric: '+quality.metric.id+' · revision '+quality.metric.revision))
  detail.append(summary,list);notice.append(detail)
 }
 return notice
}

export function promotionNotice(quality) {
 const panel=element('section')
 panel.append(element('h3','Current quality: '+quality.state),element('p',quality.policy))
 const tests=element('ul')
 for(const test of quality.tests) {
  const row=element('li',test.dataset+' · '+(test.name??test.reason.replaceAll('_',' '))+' · '+test.state)
  if(test.href){const link=element('a','Inspect exact quality evidence');link.href=test.href;row.append(' · ',link)}
  tests.append(row)
 }
 panel.append(tests,element('p','Retained answers keep their original dated results.'))
 return panel
}
