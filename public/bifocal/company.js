import { element, table, metadata } from './file-view.js'
import { clearErrors, explain, invalid, iso, json, validate } from './company-errors.js'
const $=id=>document.getElementById(id)
let company,pending=false
const field=(form,name)=>form.elements.namedItem(name).value
const number=(form,name)=>Number(field(form,name))
async function call(path,data,method=data===undefined?'GET':'POST') {
 const response=await fetch('/api/operator'+path,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),value=await response.json()
 if(!response.ok)throw Object.assign(Error(value.reason??value.error),{code:value.error,details:value.details});return value
}
function status(form,text,error=false){const node=$(form?form.getAttribute('id')+'-status':'status');node.textContent=text;node.dataset.error=String(error)}
async function action(form,work) {
 if(pending)return
 pending=true
 const active=document.activeElement,buttons=[...document.querySelectorAll('button')].map(button=>[button,button.disabled])
 if(form){clearErrors(form);form.setAttribute('aria-busy','true')}
 status(form,'Working…');buttons.forEach(([button])=>button.disabled=true)
 let failed=false
 try{if(form)validate(form);await work()}
 catch(error){failed=true;status(form,form?explain(form,error):'Company settings could not load. Reload the page to try again.',true)}
 finally{
  pending=false;buttons.forEach(([button,disabled])=>button.disabled=disabled);form?.removeAttribute('aria-busy')
  const first=form?.querySelector('[aria-invalid=true]')
  // Focus only after controls re-enable, in the form's natural field order.
  if(first)first.focus()
  else if(failed&&form)$(form.getAttribute('id')+'-status').focus()
  else if(document.activeElement===document.body&&active instanceof HTMLElement)active.focus()
 }
}
function on(id,handler){const form=$(id);form.noValidate=true;form.onsubmit=event=>{event.preventDefault();action(form,()=>handler(form))}}
async function latest(path,key){const result=await call(path);const rows=result[key];return rows.length?Math.max(...rows.map(row=>row.version)):null}
on('company-form',async form=>{
 company=await call('/company',{previousRevision:company.revision,settings:{name:field(form,'name'),currency:field(form,'currency'),timezone:field(form,'timezone'),reportCutoff:field(form,'cutoff')}},'PUT')
 status(form,'Company conventions saved. Existing answers retain their earlier revision.')
})
on('calendar-form',async form=>{
 // Validate the display year before creating an immutable saved definition.
 const month=number(form,'month'),day=number(form,'day')
 if(day>new Date(Date.UTC(2000,month,0)).getUTCDate())throw invalid(form,'day','Choose a day that exists in the selected start month. February can start on day 29.')
 const id=field(form,'id'),previousVersion=await latest('/calendars/'+encodeURIComponent(id),'versions')
 const saved=await call('/calendars',{id,previousVersion,definition:{name:field(form,'name'),kind:field(form,'kind'),startMonth:month,startDay:day,weekStartsOn:number(form,'week'),anchor:field(form,'anchor'),extraWeekPeriod:12}})
 const year=await call('/calendars/'+encodeURIComponent(id)+'/'+saved.version+'/year/'+number(form,'year'))
 $('calendar-result').replaceChildren(metadata([['Calendar',id],['Version',saved.version],['Start',year.start],['End (exclusive)',year.end],['Days',year.days],['Weeks',year.weeks??'Monthly fiscal']]),table('Fiscal periods',['Period','Quarter','Start','End','Days'],year.periods.map(row=>[row.period,row.quarter,row.start,row.end,row.days])))
 $('working-form').elements.id.value=id;$('working-form').elements.version.value=saved.version;status(form,'Calendar saved and year resolved.')
})
on('working-form',async form=>{
 const start=iso(form,'start'),end=iso(form,'end')
 const result=await call('/calendars/'+encodeURIComponent(field(form,'id'))+'/'+number(form,'version')+'/working-days',{start,end})
 $('working-result').replaceChildren(element('p',result.workingDays+' working days'),table('Working-day calculation',['Date','Working','Reason'],result.days.map(row=>[row.date,row.working?'Yes':'No',row.reason])))
 status(form,'Holiday-adjusted measure calculated.')
})
on('rates-form',async form=>{
 const rates=json(form,'rates'),id=field(form,'id'),previousVersion=await latest('/rates/'+encodeURIComponent(id),'versions')
 const saved=await call('/rates',{id,previousVersion,definition:{name:field(form,'name'),kind:'owner-imported',license:field(form,'license'),baseCurrency:'USD',rates}})
 $('rates-result').replaceChildren(metadata([['Source',saved.definition.name],['Version',saved.version],['Authorization',saved.definition.license]]));$('conversion-form').elements.source.value=id;$('conversion-form').elements.version.value=saved.version;status(form,'Named rate source saved as an immutable version.')
})
on('conversion-form',async form=>{
 const result=await call('/currency/convert',{sourceId:field(form,'source'),sourceVersion:number(form,'version'),targetCurrency:'USD',timezone:company.settings.timezone,reportCutoff:company.settings.reportCutoff,policy:{date:'transaction-date',lookup:'exact'},rounding:{scale:2,mode:field(form,'rounding'),stage:field(form,'stage')},transactions:json(form,'transactions')})
 $('conversion-result').replaceChildren(metadata([['USD total',result.total.amount],['Rate source',result.source.name],['Source version',result.rateSource.version],['Rounding',result.rounding.mode+', '+result.rounding.stage]]),table('Original and converted amounts',['Transaction','Original','Currency','Date','Rate date','USD'],result.transactions.map(row=>[row.id,row.original.amount,row.original.currency,row.original.date,row.rateDate,row.converted.rounded])))
 status(form,'Exact USD conversion calculated; original currencies remain separate.')
})
action(null,async()=>{company=await call('/company');const form=$('company-form');form.elements.name.value=company.settings.name;form.elements.currency.value=company.settings.currency;form.elements.timezone.value=company.settings.timezone;form.elements.cutoff.value=company.settings.reportCutoff;status(null,'US conventions loaded.')})
