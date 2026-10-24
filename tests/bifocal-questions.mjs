import {proveQuestionContext} from './journeys/question-context.mjs'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {dump} from 'js-yaml'
import {questionCompanies} from './journeys/question-cases.mjs'
import {questionEdge,fixturePlan} from './journeys/question-edge.mjs'
import {questionRuntime} from './journeys/question-runtime.mjs'
import {questionReferences,sameQuestionAnswer} from './journeys/question-reference.mjs'
const live=process.env.BIFOCAL_QUESTIONS_LIVE==='1',model=live?process.env.BIFOCAL_QUESTIONS_MODEL:'synthetic-bifocal-planner'
if(live&&!model)throw Error('Live qualification requires an exact configured model')
const edge=await questionEdge({live,model,fixtures:questionCompanies.flatMap(c=>c.cases)})
let runtime
try{
 runtime=await questionRuntime(edge,model)
 const {origin,context,page,call,upload,screen}=runtime,report={sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),live,model,companies:[],responses:[]},saved=[]
 for(const company of questionCompanies){
  await call('/calendars',{id:company.calendar.id,previousVersion:null,definition:company.calendar.definition})
  await upload(company.id,company.csv)
  const definition={views:[{id:company.viewId,kind:'chart',query:{version:1,dataset:company.id,joins:[],filters:[],groupBy:[],measures:company.metrics,context:{calendar:{id:company.calendar.id,version:1},accountingBasis:'accrual',rounding:'half-even',modelVersion:'question-fixture',metricVersion:'question-fixture'},semantic:{grain:['invoice'],dimensions:company.dimensions,hierarchies:[['region','product'],['channel','customer']],slowlyChanging:'reject-duplicate-grain'}},rowRules:[{column:'region',op:'ne',value:'Restricted'}]}],quality:[]},document=dump(definition),review=await call('/model-authoring/review',{document},200)
  assert.equal(review.compatible,true,JSON.stringify(review));const model=await call('/model-authoring/create',{document,reviewedDigest:review.digest}),branch='/models/'+model.modelId+'/branches/'+model.branchId,promotion=await call(branch+'/validate',{},200)
  await call(branch+'/approve',{digest:promotion.digest},200);await call(branch+'/promote',{environment:'staging',digest:promotion.digest},200);await call(branch+'/promote',{environment:'production',digest:promotion.digest},200)
  const base={modelId:model.modelId,revision:model.revision,viewId:company.viewId,asOf:'2026-10-15',context:null},references=questionReferences(company),cases=live?company.cases:[...company.cases.slice(0,6),company.cases[36],company.cases[180],company.cases[188],company.cases[194]],failures=[]
  const ask=async(fixture,overrides={})=>{const input={...base,question:fixture.question,asOf:fixture.asOf,...overrides},preview=await call('/ask/preview',input,200);assert.ok(!JSON.stringify(preview.outbound).includes('SYSTEM OVERRIDE'));assert.ok(!JSON.stringify(preview.outbound).includes('Restricted Internal'));const result=await call('/ask/run',{...input,reviewedDigest:preview.digest,consent:true});report.responses.push(result.provider.responseId);return result}
  // A bounded pool runs independent owner questions; references were written
  // before these requests and never derive from provider plans or app output.
  let next=0,passed=0
  const work=async()=>{for(;;){const index=next++;if(index>=cases.length)return;const fixture=cases[index];try{const result=await ask(fixture),mismatch=sameQuestionAnswer(result,fixture,references[company.cases.indexOf(fixture)]);if(mismatch)failures.push({id:fixture.id,question:fixture.question,reason:mismatch,interpretation:result.interpretation,decision:result.decision});else passed++}catch(error){failures.push({id:fixture.id,question:fixture.question,reason:error.message})}}}
  await Promise.all(Array.from({length:live?6:1},work))
  report.companies.push({id:company.id,total:cases.length,passed,rate:passed/cases.length,failures});if(!live)assert.equal(failures.length,0,JSON.stringify(failures));console.log(company.label+': '+passed+'/'+cases.length+' exact question outcomes; live='+live)
  saved.push({company,base,ask})
 }
 if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await writeFile(join(process.env.BIFOCAL_PROOF_DIR,'question-qualification.json'),JSON.stringify(report,null,2)+'\n')}
 // The real browser uses the same owner preview and explicit consent workflow.
 const first=saved[0],fixture=first.company.cases[1]
 const explanation=await proveQuestionContext(first,edge,live,call)
 await page.goto(origin+'/app/queries');await page.getByRole('link',{name:'Ask a question',exact:true}).click();await page.getByRole('status').filter({hasText:'Choose'}).waitFor()
 const catalog=await call('/ask'),index=catalog.views.findIndex(v=>v.modelId===first.base.modelId);await page.getByLabel('Governed view',{exact:true}).selectOption(String(index));await page.getByLabel('As of date',{exact:true}).fill(first.base.asOf);await page.getByLabel('Your question',{exact:true}).fill(fixture.question);await page.getByRole('button',{name:'Review AI request',exact:true}).click();await page.getByRole('status').filter({hasText:'Review'}).waitFor();await screen('ask-consent')
 assert.equal(await page.getByRole('button',{name:'Send approved question',exact:true}).isDisabled(),true);await page.getByLabel('I approve sending this exact question and permitted definitions to the configured AI provider').check();await page.getByRole('button',{name:'Send approved question',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved native answer'}).waitFor();await screen('ask-answer')
 await page.getByRole('button',{name:'Use as follow-up context',exact:true}).click();await screen('ask-follow-up');assert.notEqual(await page.getByLabel('Question context (JSON)',{exact:true}).inputValue(),'null');await page.getByRole('button',{name:'Reset context',exact:true}).click();assert.equal(await page.getByLabel('Question context (JSON)',{exact:true}).inputValue(),'null')
 await page.goto(origin+'/app/ask?question='+explanation.id);await page.getByRole('status').filter({hasText:'Saved native answer'}).waitFor();await screen('ask-quality-drivers')
 const missing=first.company.cases[180],declined=await first.ask(missing);await page.goto(origin+'/app/ask?question='+declined.id);await page.getByRole('status').filter({hasText:'Question refused'}).waitFor();assert.equal(await page.locator('#ask-answer').isVisible(),false);await screen('ask-refused')
 if(!live){
  const input={...first.base,question:fixture.question},review=await call('/ask/preview',input,200),malicious=fixturePlan(fixture)
  malicious.groupBy=['salary'];edge.setNext(malicious)
  const count=edge.requests.length,denied=await call('/ask/run',{...input,reviewedDigest:review.digest,consent:true},502)
  assert.equal(denied.error,'planner_scope_invalid');assert.equal(edge.requests.length,count+1)
 }
 const input={...first.base,question:fixture.question},preview=await call('/ask/preview',input,200),before=edge.requests.length
 await call('/ask/run',{...input,reviewedDigest:preview.digest,consent:false},409);assert.equal(edge.requests.length,before)
 const foreign=await context.request.post(origin+'/api/operator/ask/run',{headers:{Origin:'https://synthetic-bifocal.invalid'},data:{...input,reviewedDigest:preview.digest,consent:true}});assert.equal(foreign.status(),401)
 assert.equal((await fetch(origin+'/api/operator/ask')).status,401)
 await upload(first.company.id,first.company.csv.replace('Delivered order','Source revised'),true);await call('/ask/run',{...input,reviewedDigest:preview.digest,consent:true},409);assert.equal(edge.requests.length,before)
 const source=await call('/datasets/'+first.company.id);await call('/datasets/'+first.company.id+'/erase',{confirmDataset:first.company.id,reviewedRevision:source.revision},200);await call('/ask/'+declined.id,undefined,404)
 if(process.env.BIFOCAL_PROOF_DIR){await mkdir(process.env.BIFOCAL_PROOF_DIR,{recursive:true});await writeFile(join(process.env.BIFOCAL_PROOF_DIR,'question-qualification.json'),JSON.stringify(report,null,2)+'\n')}
 for(const company of report.companies)assert.ok(company.rate>=(live?0.95:1),JSON.stringify(company))
 console.log(live?'Live question qualification passed through the actual governed question route':'Question provider-edge smoke passed; no live planning accuracy claim')
}finally{await runtime?.close();await edge.close()}
