import {element} from './file-view.js'

const operations={dedupe:'Deduplicate complete rows',cast:'Repair column type',calculate:'Calculate column',join:'Join dataset',lookup:'Look up dataset',union:'Union dataset',pivot:'Pivot',unpivot:'Unpivot'}
const fields={
 dedupe:[],
 cast:[['column','Column'],['type','Target type',['text','number','money','date','boolean']]],
 calculate:[['name','New column name'],['left','Left numeric column'],['operator','Arithmetic',['add','subtract','multiply']],['right','Right numeric column']],
 join:[['dataset','Other dataset ID'],['left','Input key column'],['right','Other dataset key column'],['prefix','Prefix for other columns'],['kind','Join kind',['left','inner']]],
 lookup:[['dataset','Lookup dataset ID'],['left','Input key column'],['right','Lookup key column'],['prefix','Prefix for lookup columns'],['kind','Join kind',['left','inner']]],
 union:[['dataset','Other dataset ID']],
 pivot:[['groupBy','Group columns, one per line','list'],['column','Label column'],['value','Value column'],['values','Explicit pivot labels, one per line','list']],
 unpivot:[['columns','Columns to unpivot, one per line','list'],['name','New label column'],['value','New value column']]
}
export function newStep(op){
 const step={op}
 for(const [key,,type] of fields[op])step[key]=Array.isArray(type)?type[0]:type==='list'?[]:''
 return step
}
export function renderGraph(box,steps,onChange){
 box.replaceChildren()
 if(!steps.length){box.append(element('li','No transformation steps. The output contains the unchanged source rows.'));return}
 steps.forEach((step,index)=>{
  const item=element('li',undefined,'panel'),heading=element('h4',`Step ${index+1}: ${operations[step.op]}`)
  item.dataset.step=String(index+1)
  item.append(heading,element('p',`Input: ${index?'step '+index:'source dataset'} → output: ${index===steps.length-1?'draft output':'step '+(index+2)}`,'muted'))
  if(step.op==='dedupe')item.append(element('p','Remove identical complete rows. Numeric values compare exactly.'))
  if(['join','lookup'].includes(step.op))item.append(element('p','The other key must be unique. Duplicate matching keys are refused; a left join keeps unmatched input rows with NULL values.'))
  if(step.op==='union')item.append(element('p','Both datasets must have the same ordered column names and types.'))
  if(step.op==='pivot')item.append(element('p','Each group and pivot label must identify at most one value. Unknown labels and duplicate cells are refused.'))
  const controls=element('div',undefined,'fields')
  for(const [key,title,type] of fields[step.op]){
   const label=element('label',title),input=element(Array.isArray(type)?'select':type==='list'?'textarea':'input')
   input.name=key;input.dataset.field=key;input.setAttribute('aria-label',`Step ${index+1}: ${title}`)
   if(Array.isArray(type))for(const value of type){const option=element('option',value);option.value=value;input.append(option)}
   if(type==='list')input.rows=3
   else if(!Array.isArray(type)){input.maxLength=key==='dataset'?64:128;input.required=true}
   input.value=type==='list'?step[key].join('\n'):step[key]
   input.addEventListener('input',()=>{step[key]=type==='list'?input.value.split('\n').filter(value=>value.length):input.value;onChange()})
   label.append(input);controls.append(label)
  }
  item.append(controls)
  const actions=element('div',undefined,'actions')
  for(const [title,target] of [['Move up',index-1],['Move down',index+1],['Remove step',null]]){
   const button=element('button',title);button.type='button';button.setAttribute('aria-label',`${title} ${index+1}`)
   button.disabled=target!==null&&(target<0||target>=steps.length)
   button.addEventListener('click',()=>{if(target===null)steps.splice(index,1);else [steps[index],steps[target]]=[steps[target],steps[index]];onChange();renderGraph(box,steps,onChange)})
   actions.append(button)
  }
  item.append(actions);box.append(item)
 })
}
const quote=value=>'"'+String(value).replaceAll('"','""')+'"'
const literal=value=>"'"+String(value).replaceAll("'","''")+"'"
export function graphSQL(steps){
 return steps.map(step=>{
  if(step.op==='dedupe')return 'SELECT DISTINCT * FROM INPUT'
  if(step.op==='cast')return `SELECT * REPLACE (CAST(${quote(step.column)} AS ${step.type.toUpperCase()}) AS ${quote(step.column)}) FROM INPUT`
  if(step.op==='calculate')return `SELECT *, (${quote(step.left)} ${{add:'+',subtract:'-',multiply:'*'}[step.operator]} ${quote(step.right)}) AS ${quote(step.name)} FROM INPUT`
  if(step.op==='union')return `SELECT * FROM INPUT UNION ALL SELECT * FROM ${quote(step.dataset)}`
  if(['join','lookup'].includes(step.op))return `SELECT * FROM INPUT ${step.kind==='left'?'LEFT':'INNER'} JOIN ${quote(step.dataset)} AS ${quote(step.prefix)} ON INPUT.${quote(step.left)} = ${quote(step.prefix)}.${quote(step.right)}`
  if(step.op==='unpivot')return `SELECT * FROM INPUT UNPIVOT INCLUDE NULLS (${quote(step.value)} FOR ${quote(step.name)} IN (${step.columns.map(quote).join(', ')}))`
  if(step.op==='pivot')return `SELECT ${step.groupBy.map(quote).join(', ')}, ${step.values.map(quote).join(', ')} FROM INPUT PIVOT (SINGLE(${quote(step.value)}) FOR ${quote(step.column)} IN (${step.values.map(literal).join(', ')}))`
  throw Error('Unsupported preparation operation.')
 }).join(';\n')+(steps.length?';':'')
}
