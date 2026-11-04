import { element } from './file-view.js'

// Keep instructions in the description when adding or removing a field error.
export function fieldError(form,name,text) {
 const input=form.elements.namedItem(name),id=form.getAttribute('id')+'-'+name+'-error'
 document.getElementById(id)?.remove()
 const descriptions=(input.getAttribute('aria-describedby')??'').split(/\s+/).filter(value=>value&&value!==id)
 input.removeAttribute('aria-invalid')
 if(text) {
  const label=input.closest('label')
  let cell=label.parentElement
  if(!cell.classList.contains('control')){cell=element('div',undefined,'control');label.replaceWith(cell);cell.append(label)}
  const note=element('p',text,'field-error');note.id=id;cell.append(note)
  input.setAttribute('aria-invalid','true');descriptions.push(id)
 }
 if(descriptions.length)input.setAttribute('aria-describedby',descriptions.join(' '))
 else input.removeAttribute('aria-describedby')
}
export function clearErrors(form) {
 for(const input of form.querySelectorAll('[aria-invalid]'))fieldError(form,input.name,'')
}
export function invalid(form,name,message) {
 fieldError(form,name,message)
 return Error('Check the highlighted fields. Your entries have been kept.')
}
export function validate(form) {
 let refused=false
 for(const input of form.querySelectorAll('input,select,textarea')) {
  if(!input.checkValidity()||(input.required&&!input.value.trim())) {
   const message=input.validity.valueMissing||!input.value.trim()?'Enter a value before continuing.':
    input.validity.patternMismatch?'Use the format shown in the instructions.':
    input.type==='number'?'Enter a whole number from '+input.min+' to '+input.max+'.':'Enter a valid value.'
   fieldError(form,input.name,message);refused=true
  }
 }
 if(refused)throw Error('Check the highlighted fields. Your entries have been kept.')
}
export function iso(form,name) {
 const value=form.elements.namedItem(name).value,match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
 const result=match?match[3]+'-'+match[1]+'-'+match[2]:''
 const time=Date.parse(result+'T00:00:00Z')
 if(!match||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==result||Number(match[3])<1971||Number(match[3])>9998)
  throw invalid(form,name,'Enter a real date as MM/DD/YYYY, from 01/01/1971 through 12/31/9998.')
 return result
}
export function json(form,name) {
 try{return JSON.parse(form.elements.namedItem(name).value)}
 catch{throw invalid(form,name,'Enter a valid JSON array. Use double quotes around field names and text; remove trailing commas.')}
}
// Suggest a nearby IANA name while leaving the entered value untouched.
function nearestZone(text) {
 const a=text.toLowerCase();let best=null,score=Infinity
 for(const zone of Intl.supportedValuesOf('timeZone')){
  const b=zone.toLowerCase(),row=[...Array(b.length+1).keys()]
  for(let i=1;i<=a.length;i++){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const above=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=above}}
  if(row[b.length]<score){score=row[b.length];best=zone}
 }
 return score<=Math.max(2,Math.floor(text.length/4))?best:null
}
const common={
 invalid_id:['id','Start the id with a lowercase letter; use up to 64 lowercase letters, numbers or hyphens.'],
 invalid_fiscal_start:['day','Choose a day that exists in the selected start month. February can start on day 29.'],
 invalid_calendar_kind:['kind','Choose a listed calendar type.'],
 invalid_retail_anchor:['anchor','Choose a listed retail anchor.'],
 invalid_working_day_range:['end','Use an end date on or after the start, no more than 3660 days later.'],
 invalid_currency:['currency','Enter a supported three-letter currency code, like USD.'],
 invalid_clock:['cutoff','Enter the report cutoff as a time, like 17:00.']
}
const rateErrors={
 invalid_rates:'Enter between 1 and 1000 dated rates.',
 invalid_date:'Give each rate a real ISO date, like 2026-06-19.',
 invalid_currency:'Give each rate a supported foreign currency code, like EUR.',
 exact_decimal_string_required:'Write each rate as a decimal string, like "0.8", with at most 24 decimal places.',
 invalid_or_duplicate_rate:'Use one positive rate per foreign currency and date. Remove duplicates; do not include USD.',
 object_required:'Give each rate currency, date and rate fields in a JSON object.',
 unknown_field:'Use only currency, date and rate in each rate object.'
}
const transactionErrors={
 explicit_offset_instant_required:'Give sourceInstant an ISO timestamp with an explicit UTC offset, or omit it.',
 invalid_instant:'Give sourceInstant a real ISO timestamp with an explicit UTC offset.',
 invalid_transactions:'Enter between 1 and 1000 original transactions.',
 invalid_date:'Give each transaction a real ISO date, like 2026-06-19.',
 invalid_currency:'Give each transaction a supported three-letter currency code.',
 exact_decimal_string_required:'Write each amount as a decimal string, like "100.00", with at most 24 decimal places.',
 duplicate_transaction_id:'Give each transaction a different id.',
 invalid_text:'Give each transaction a nonempty id of up to 160 characters.',
 object_required:'Give each transaction id, amount, currency and date fields in a JSON object.',
 unknown_field:'Use only id, amount, currency, date and optional sourceInstant in each transaction.'
}
export function explain(form,error) {
 const code=error.code,details=error.details??{}
 if(!code)return error.message
 let mapped
 if(form.getAttribute('id')==='rates-form'&&rateErrors[code])mapped=['rates',rateErrors[code]]
 else if(form.getAttribute('id')==='conversion-form'&&transactionErrors[code])mapped=['transactions',transactionErrors[code]]
 else if(code==='invalid_integer') {
  const name=({startMonth:'month',startDay:'day',weekStartsOn:'week',sourceVersion:'version'})[details.field]??details.field
  if(form.elements.namedItem(name))mapped=[name,'Enter a whole number from '+details.min+' to '+details.max+'.']
 } else if(code==='invalid_text'&&form.elements.namedItem(details.field))mapped=[details.field,'Enter text of up to '+details.max+' characters.']
 else if(code==='version_not_found')mapped=[form.getAttribute('id')==='working-form'?'id':'source','Choose an existing saved id and its exact version. Check both fields before calculating.']
 else if(code==='rate_unavailable')mapped=['transactions','No exact '+details.currency+' quote exists for '+details.requestedDate+'. Choose a transaction date with an authorized saved quote, or save that dated quote and select its version.']
 else if((code==='invalid_timezone'||code==='iana_timezone_required')&&form.elements.namedItem('timezone')) {
  const near=nearestZone(form.elements.namedItem('timezone').value.trim())
  mapped=['timezone','Use a known IANA time zone. Check its spelling'+(near?' (like '+near+').':'; use a name like America/New_York.')]
 }
 else mapped=code==='invalid_id'&&form.getAttribute('id')==='conversion-form'?['source',common.invalid_id[1]]:common[code]
 if(mapped&&form.elements.namedItem(mapped[0])) {
  fieldError(form,...mapped)
  return 'Check the highlighted fields. Your entries have been kept.'
 }
 if(code==='owner_required')return 'Sign in as the current installation owner before trying again. Your entries have been kept.'
 if(code==='conventions_conflict')return 'The saved revision or your authority changed. Keep a copy of your entries, reload the current definitions and review before trying again.'
 return 'This request could not be completed. Check the saved definitions and try again. Your entries have been kept.'
}
