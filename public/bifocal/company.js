import { element, table, metadata } from './file-view.js'
const $=id=>document.getElementById(id)
let company,pending=false
const field=(form,name)=>form.elements[name].value
const number=(form,name)=>Number(field(form,name))
async function call(path,data,method=data===undefined?'GET':'POST') {
 const response=await fetch('/api/operator'+path,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),value=await response.json()
 if(!response.ok)throw Error(value.reason??value.error);return value
}
function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error)}
async function action(work){if(pending)return;pending=true;status('Working…');document.querySelectorAll('button').forEach(button=>button.disabled=true);try{await work()}catch(error){status(error.message,true)}finally{pending=false;document.querySelectorAll('button').forEach(button=>button.disabled=false)}}
function on(id,handler){$(id).onsubmit=event=>{event.preventDefault();action(()=>handler(event.currentTarget))}}
function iso(value){const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);if(!match)throw Error('Enter dates as MM/DD/YYYY.');return `${match[3]}-${match[1]}-${match[2]}`}
function json(form,name){try{return JSON.parse(field(form,name))}catch{throw Error('Enter valid JSON for '+name+'.')}}
async function latest(path,key){const result=await call(path);const rows=result[key];return rows.length?Math.max(...rows.map(row=>row.version)):null}
on('company-form',async form=>{company=await call('/company',{previousRevision:company.revision,settings:{name:field(form,'name'),currency:field(form,'currency'),timezone:field(form,'timezone'),reportCutoff:field(form,'cutoff')}},'PUT');status('Company conventions saved. Existing answers retain their earlier revision.')})
on('calendar-form',async form=>{
 const id=field(form,'id'),previousVersion=await latest('/calendars/'+encodeURIComponent(id),'versions')
 const saved=await call('/calendars',{id,previousVersion,definition:{name:field(form,'name'),kind:field(form,'kind'),startMonth:number(form,'month'),startDay:number(form,'day'),weekStartsOn:number(form,'week'),anchor:field(form,'anchor'),extraWeekPeriod:12}})
 const year=await call(`/calendars/${id}/${saved.version}/year/${number(form,'year')}`)
 $('calendar-result').replaceChildren(metadata([['Calendar',id],['Version',saved.version],['Start',year.start],['End (exclusive)',year.end],['Days',year.days],['Weeks',year.weeks??'Monthly fiscal']]),table('Fiscal periods',['Period','Quarter','Start','End','Days'],year.periods.map(row=>[row.period,row.quarter,row.start,row.end,row.days])))
 $('working-form').elements.id.value=id;$('working-form').elements.version.value=saved.version;status('Calendar saved and year resolved.')
})
on('working-form',async form=>{const result=await call(`/calendars/${field(form,'id')}/${number(form,'version')}/working-days`,{start:iso(field(form,'start')),end:iso(field(form,'end'))});$('working-result').replaceChildren(element('p',`${result.workingDays} working days`),table('Working-day calculation',['Date','Working','Reason'],result.days.map(row=>[row.date,row.working?'Yes':'No',row.reason])));status('Holiday-adjusted measure calculated.')})
on('rates-form',async form=>{
 const id=field(form,'id'),previousVersion=await latest('/rates/'+encodeURIComponent(id),'versions')
 const saved=await call('/rates',{id,previousVersion,definition:{name:field(form,'name'),kind:'owner-imported',license:field(form,'license'),baseCurrency:'USD',rates:json(form,'rates')}})
 $('rates-result').replaceChildren(metadata([['Source',saved.definition.name],['Version',saved.version],['Authorization',saved.definition.license]]));$('conversion-form').elements.source.value=id;$('conversion-form').elements.version.value=saved.version;status('Named rate source saved as an immutable version.')
})
on('conversion-form',async form=>{
 const result=await call('/currency/convert',{sourceId:field(form,'source'),sourceVersion:number(form,'version'),targetCurrency:'USD',timezone:company.settings.timezone,reportCutoff:company.settings.reportCutoff,policy:{date:'transaction-date',lookup:'exact'},rounding:{scale:2,mode:field(form,'rounding'),stage:field(form,'stage')},transactions:json(form,'transactions')})
 $('conversion-result').replaceChildren(metadata([['USD total',result.total.amount],['Rate source',result.source.name],['Source version',result.rateSource.version],['Rounding',`${result.rounding.mode}, ${result.rounding.stage}`]]),table('Original and converted amounts',['Transaction','Original','Currency','Date','Rate date','USD'],result.transactions.map(row=>[row.id,row.original.amount,row.original.currency,row.original.date,row.rateDate,row.converted.rounded])));status('Exact USD conversion calculated; original currencies remain separate.')
})
action(async()=>{company=await call('/company');const form=$('company-form');form.elements.name.value=company.settings.name;form.elements.currency.value=company.settings.currency;form.elements.timezone.value=company.settings.timezone;form.elements.cutoff.value=company.settings.reportCutoff;status('US conventions loaded.')})
