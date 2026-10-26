import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {writeFile} from 'node:fs/promises'
import {unzipSync,strFromU8} from 'fflate'
import {DOMParser} from '@xmldom/xmldom'
const canonical=v=>{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v)}
const displayedDigest=run=>createHash('sha256').update(canonical({id:run.id,revision:run.revision,selection:run.selection,inherited:run.inherited,cards:run.cards})).digest('hex')
/** One public flow proves owner review, native files and guarded withdrawal. */
export async function proveDashboardSnapshots({origin,context,page,upload,proveScreen,directory}){
 const headers={Origin:origin},api=async(path,data,expected=data===undefined?200:201)=>{const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers,...(data===undefined?{}:{data})});assert.equal(response.status(),expected,await response.text());return response.json()}
 const dataset='synthetic-bifocal-dashboard-snapshots';await upload(dataset,'invoice,date,region,revenue\n1,10/01/2026,West,10.01\n2,10/02/2026,East,20.02\n')
 const calendar='synthetic-bifocal-snapshot-calendar';await api('/calendars',{id:calendar,previousVersion:null,definition:{name:'Snapshot calendar',kind:'fiscal',startMonth:1}},201)
 const query={version:1,dataset,joins:[],filters:[],groupBy:['region'],measures:[{id:'revenue',op:'sum',column:'revenue',unit:'number',scale:2}],semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'number'},{column:'date',type:'date'},{column:'region',type:'text'},{column:'revenue',type:'number'}],hierarchies:[['region']],slowlyChanging:'reject-duplicate-grain'},fiscal:{column:'date',asOf:'2026-10-15',window:'quarter-to-date'},context:{modelVersion:'snapshot-source',metricVersion:'snapshot-source',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const model=await api('/models',{definition:{views:[{id:'sales',kind:'chart',query,rowRules:[]}],quality:[]}}),branch='/models/'+model.modelId+'/branches/'+model.branchId,validated=await api(branch+'/validate',{},200)
 assert.equal(validated.compatible,true,JSON.stringify(validated));await api(branch+'/approve',{digest:validated.digest},200);await api(branch+'/promote',{environment:'staging',digest:validated.digest},200);await api(branch+'/promote',{environment:'production',digest:validated.digest},200)
 query.context.modelVersion=model.revision
 const cards=[{key:'sales',definition:query},{key:'comparison',definition:query}],document={version:2,title:'Five-tab snapshot review',cards,layout:{desktop:[{key:'sales',x:0,y:0,w:6,h:4},{key:'comparison',x:6,y:0,w:6,h:4}],phone:[{key:'sales',x:0,y:0,w:1,h:4},{key:'comparison',x:0,y:4,w:1,h:4}]},interactions:{tabs:Array.from({length:5},(_,i)=>({id:'tab-'+(i+1),label:'Tab '+(i+1),cards:cards.map(c=>c.key),tiles:['explanation','marker']})),tiles:[{key:'explanation',kind:'text',text:'Exact regional operating totals.'},{key:'marker',kind:'image',alt:'Inert snapshot marker',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII='}],tileLayout:{desktop:[{key:'explanation',x:0,y:4,w:12,h:1},{key:'marker',x:0,y:5,w:12,h:1}],phone:[{key:'explanation',x:0,y:8,w:1,h:1},{key:'marker',x:0,y:9,w:1,h:1}]},dimensions:['region'],fiscalParameters:[{id:'period',label:'Snapshot fiscal period',cards:cards.map(c=>c.key),default:{asOf:'2026-10-15',window:'quarter-to-date'}}]}}
 const draftReview=await api('/dashboard-authoring/review',{document},200),saved=await api('/dashboard-authoring/apply',{document,reviewedDigest:draftReview.digest}),endpoint='/dashboard-authoring/'+saved.id,publish=await api(endpoint+'/publication/review',{revision:1,previousGeneration:saved.generation,action:'publish'},200)
 await api(endpoint+'/publish',{revision:1,previousGeneration:saved.generation,reviewedDigest:publish.digest},200)
 const selection={tab:'tab-3',fiscal:{period:{asOf:'2026-10-20',window:'year-to-date'}},filters:[{column:'region',op:'eq',value:'West'}]},run=await api(endpoint+'/run',{selection},200),tabs=document.interactions.tabs.map(t=>t.id),base={selection:run.selection,displayedDigest:displayedDigest(run),filterState:'current',tabs,layout:'desktop'},reviewed=[]
 assert.equal(run.cards[0].answer.totals.revenue.value,'10.01')
 for(const format of ['pdf','pptx'])for(const chosen of [tabs,['tab-3']]){
  const input={...base,tabs:chosen,format},review=await api(endpoint+'/snapshot/review',input,200);assert.equal(review.pages.length,chosen.length);assert.equal(review.provenance.cards[0].answer.totals.revenue.value,'10.01');assert.deepEqual(review.selection.filters,run.selection.filters);assert.deepEqual(review.selection.fiscal,run.selection.fiscal);assert.ok(review.pages.every(p=>p.shapes.some(s=>s.kind==='text'&&s.lines.join(' ').includes('year-to-date through 2026-10-20'))));assert.match(review.backLink,/\/app\/dashboard-authoring\//);assert.ok(review.pages.every(p=>p.shapes.some(s=>s.label==='Inert snapshot marker')))
  const data={...input,exportedAt:review.exportedAt,reviewedDigest:review.digest},response=await context.request.post(origin+'/api/operator'+endpoint+'/snapshot/download',{headers,data});assert.equal(response.status(),200,await response.text());const bytes=await response.body();assert.equal(response.headers()['cache-control'],'no-store')
  if(format==='pdf'){const pdf=bytes.toString('latin1');assert.ok(pdf.startsWith('%PDF-1.7'));assert.equal((pdf.match(/\/Type \/Page\b/g)??[]).length,chosen.length);assert.match(pdf,/\/StructTreeRoot/);assert.match(pdf,/\/Subtype \/Image/);assert.match(pdf,/snapshot-provenance.json/);assert.ok(!pdf.includes('20.02'))}else{const files=unzipSync(bytes),slides=Object.keys(files).filter(k=>/^ppt\/slides\/slide\d+\.xml$/.test(k));assert.equal(slides.length,chosen.length);for(const path of Object.keys(files).filter(k=>k.endsWith('.xml'))){const xml=strFromU8(files[path]),parsed=new DOMParser({onError:level=>{if(level==='fatalError')throw Error('Invalid native presentation XML')}}).parseFromString(xml,'application/xml');assert.ok(parsed.documentElement);assert.ok(!xml.includes('20.02'));if(path.includes('/slides/slide')){assert.match(xml,/10.01/);assert.match(xml,/Inert snapshot marker/);assert.match(xml,/Observed/)}}assert.equal(Object.keys(files).filter(k=>k.startsWith('ppt/media/')).length,chosen.length)}
  if(directory)await writeFile(join(directory,'dashboard-snapshot-'+chosen.length+'.'+format),bytes)
  reviewed.push({input,data,review})
 }
 const defaults=await api(endpoint+'/snapshot/review',{...base,filterState:'default',format:'pdf'},200);assert.equal(defaults.provenance.cards[0].answer.totals.revenue.value,'30.03');assert.deepEqual(defaults.selection.filters,[])
 const stale=reviewed[0];await api(endpoint+'/snapshot/download',{...stale.data,tabs:['tab-1']},409);await api(endpoint+'/snapshot/download',{...stale.data,selection:{filters:[{column:'region',op:'eq',value:'East'}]}},409)
 assert.equal((await fetch(origin+'/api/operator'+endpoint+'/snapshot/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify(stale.input)})).status,401)
 assert.equal((await context.request.post(origin+'/api/operator'+endpoint+'/snapshot/review',{headers:{Origin:'https://foreign.example.test'},data:stale.input})).status(),401)
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/dashboard-authoring/'+saved.id+'/view');await page.getByRole('table',{name:'Exact sales results',exact:true}).waitFor();await page.getByText('Whole-dashboard snapshots',{exact:true}).click();await page.getByRole('button',{name:'Review snapshot',exact:true}).click();await page.getByRole('button',{name:'Download reviewed snapshot',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#dashboard-snapshots button:last-of-type')?.disabled);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await proveScreen('dashboard-snapshot-reviewed-'+width,{widths:[width],resize:false});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download reviewed snapshot',exact:true}).click();assert.match((await download).suggestedFilename(),/\.pdf$/)}
 // A larger native table and long text tile cannot fit the fixed grid.
 // The explicit readable layout repeats headings and retains every scoped row.
 const denseDataset='synthetic-bifocal-readable-snapshots',denseCsv='invoice,date,region,revenue\n'+Array.from({length:70},(_,i)=>(i+1)+',10/01/2026,West,1.00').join('\n')+'\n999,10/01/2026,East,98765.43\n'
 await upload(denseDataset,denseCsv)
 const denseQuery={...query,dataset:denseDataset,groupBy:['invoice'],context:{...query.context,modelVersion:'dense-source'}}
 const denseModel=await api('/models',{definition:{views:[{id:'sales',kind:'chart',query:denseQuery,rowRules:[]}],quality:[]}}),denseBranch='/models/'+denseModel.modelId+'/branches/'+denseModel.branchId,denseValidation=await api(denseBranch+'/validate',{},200)
 assert.equal(denseValidation.compatible,true);await api(denseBranch+'/approve',{digest:denseValidation.digest},200);await api(denseBranch+'/promote',{environment:'staging',digest:denseValidation.digest},200);await api(denseBranch+'/promote',{environment:'production',digest:denseValidation.digest},200)
 denseQuery.context.modelVersion=denseModel.revision
 const denseDocument=structuredClone(document);denseDocument.title='Readable regional detail';denseDocument.cards=denseDocument.cards.map(c=>({key:c.key,definition:denseQuery}));denseDocument.interactions.tiles[0].text=Array.from({length:75},(_,i)=>'Explanation line '+String(i+1).padStart(3,'0')+'.').join('\n')
 const denseReview=await api('/dashboard-authoring/review',{document:denseDocument},200),denseSaved=await api('/dashboard-authoring/apply',{document:denseDocument,reviewedDigest:denseReview.digest}),denseEndpoint='/dashboard-authoring/'+denseSaved.id,densePublish=await api(denseEndpoint+'/publication/review',{revision:1,previousGeneration:denseSaved.generation,action:'publish'},200)
 await api(denseEndpoint+'/publish',{revision:1,previousGeneration:denseSaved.generation,reviewedDigest:densePublish.digest},200)
 const denseRun=await api(denseEndpoint+'/run',{selection},200),denseBase={...base,tabs:['tab-3'],selection:denseRun.selection,displayedDigest:displayedDigest(denseRun)}
 assert.equal(denseRun.cards[0].answer.totals.revenue.value,'70.00');assert.equal(denseRun.cards[0].answer.rows.length,70)
 await api(denseEndpoint+'/snapshot/review',{...denseBase,format:'pdf'},422)
 let denseArtifact
 for(const format of ['pdf','pptx']){
  const input={...denseBase,layout:'readable',format},review=await api(denseEndpoint+'/snapshot/review',input,200)
  assert.equal(review.pages.length,10,'Three pages per 70-row card, three text pages and one image page')
  for(const key of ['sales','comparison']){
   const resultPages=review.pages.flatMap(p=>p.shapes.filter(s=>s.label==='Exact results '+key));assert.equal(resultPages.length,3)
   const allLines=resultPages.flatMap(s=>s.lines),records=allLines.filter(line=>/^\d+ \| 1\.00$/.test(line))
   assert.deepEqual(records.map(line=>line.split(' | ')[0]).sort((a,b)=>Number(a)-Number(b)),Array.from({length:70},(_,i)=>String(i+1)))
   assert.ok(resultPages.every(s=>s.lines.includes('invoice | revenue')&&s.lines.includes('revenue: 70.00')),'Repeated headings and totals on every continuation')
  }
  const explanation=review.pages.flatMap(p=>p.shapes.filter(s=>s.label==='Text tile explanation').flatMap(s=>s.lines));assert.deepEqual(explanation,Array.from({length:75},(_,i)=>'Explanation line '+String(i+1).padStart(3,'0')+'.'))
  assert.ok(review.pages.every(p=>['Dashboard title','Snapshot state','Effective filters and parameters','Source versions','Open authenticated dashboard'].every(label=>p.shapes.some(s=>s.label===label))))
  assert.ok(review.pages.every(p=>p.shapes.every((s,i)=>i===0||p.shapes[i-1].y<=s.y)),'Accessible reading order follows page positions')
  assert.ok(review.pages.every(p=>p.shapes.every(s=>s.x>=0&&s.y>=0&&s.x+s.w<=1280&&s.y+s.h<=900)))
  const data={...input,exportedAt:review.exportedAt,reviewedDigest:review.digest},response=await context.request.post(origin+'/api/operator'+denseEndpoint+'/snapshot/download',{headers,data});assert.equal(response.status(),200);const bytes=await response.body()
  if(format==='pdf'){assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g)??[]).length,10)}else{const files=unzipSync(bytes);assert.equal(Object.keys(files).filter(k=>/^ppt\/slides\/slide\d+\.xml$/.test(k)).length,10);for(const [path,value] of Object.entries(files))if(path.endsWith('.xml'))assert.ok(!strFromU8(value).includes('98765.43'),'No forbidden row in slides or notes')}
  if(directory)await writeFile(join(directory,'dashboard-readable.'+format),bytes)
  denseArtifact=data
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/dashboard-authoring/'+denseSaved.id+'/view');await page.getByRole('table',{name:'Exact sales results',exact:true}).waitFor()
  await page.getByText('Filters and parameters',{exact:true}).click();await page.getByLabel('Filter value',{exact:true}).fill('West');await page.getByRole('button',{name:'Apply filter',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#dashboard-reader-context')?.textContent.includes('West'))
  await page.getByText('Whole-dashboard snapshots',{exact:true}).click();await page.getByLabel('Snapshot tabs',{exact:true}).selectOption('current');await page.getByLabel('Snapshot layout',{exact:true}).selectOption('readable')
  await page.getByRole('button',{name:'Review snapshot',exact:true}).click();await page.getByRole('button',{name:'Download reviewed snapshot',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#dashboard-snapshots button:last-of-type')?.disabled)
  await proveScreen('dashboard-readable-reviewed-'+width,{widths:[width],resize:false})
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download reviewed snapshot',exact:true}).click();assert.match((await download).suggestedFilename(),/\.pdf$/)
 }
 const denseSource=await api('/datasets/'+denseDataset);await api('/datasets/'+denseDataset+'/erase',{confirmDataset:denseDataset,reviewedRevision:denseSource.revision},200);await api(denseEndpoint+'/snapshot/download',denseArtifact,404)
 const source=await api('/datasets/'+dataset);await api('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200);await api(endpoint+'/snapshot/download',stale.data,404)
 console.log('Dashboard snapshots: five native pages and slides, current tab, exact filtered and default totals, source provenance, alt text, guarded review, private downloads and erasure withdrawal passed')
}
