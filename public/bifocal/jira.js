/** The bearer is never stored. Every read is an explicit human form submission. */
export function wireJira({action,request,load,call,renderPlan,dataset}) {
 const discovery=document.getElementById('jira-resources-form'),form=document.getElementById('jira-form')
 let resources=[]
 const invalidate=()=>{form.elements.accessToken.value='';form.elements.consent.checked=false}
 const reset=()=>{resources=[];form.elements.site.replaceChildren(new Option('Discover sites first',''));invalidate()}
 const discardReview=()=>document.getElementById('import-form').elements.dataset.dispatchEvent(new Event('input'))
 form.elements.site.addEventListener('change',()=>{invalidate();form.elements.projectId.value='';form.elements.projectKey.value='';discardReview()})
 for(const name of ['projectId','projectKey'])form.elements[name].addEventListener('input',()=>{invalidate();discardReview()})
 discovery.onsubmit=event=>{event.preventDefault();action(async()=>{
  const accessToken=discovery.elements.accessToken.value,confirmRead=discovery.elements.consent.checked
  discovery.elements.accessToken.value='';discovery.elements.consent.checked=false;reset();discardReview()
  const result=await request('/api/operator/work/jira/resources',{accessToken,confirmRead},'')
  resources=result.resources
  form.elements.site.replaceChildren(new Option('Choose a permitted site',''),...resources.map((resource,index)=>new Option(resource.siteUrl+' · '+resource.scopes.join(', '),String(index))))
  document.getElementById('status').textContent=resources.length ? 'Select one site and enter its exact project id and key.' : 'No site has the supported Jira read scope.'
 })}
 form.onsubmit=event=>{event.preventDefault();action(async()=>{
  const resource=resources[Number(form.elements.site.value)],datasetId=dataset()
  const accessToken=form.elements.accessToken.value,confirmRead=form.elements.consent.checked
  invalidate()
  if(form.elements.site.value===''||!resource)throw Error('Discover and select a permitted Jira site first.')
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(datasetId))throw Error('Enter the dataset id above.')
  discardReview();await load(datasetId)
  const history=await call('history',undefined,datasetId)
  const result=await request('/api/operator/work/jira/preview',{cloudId:resource.cloudId,siteUrl:resource.siteUrl,projectId:form.elements.projectId.value,projectKey:form.elements.projectKey.value,datasetId,accessToken,confirmRead,catchup:history.history.length>0},datasetId)
  renderPlan(result,datasetId)
 })}
}
