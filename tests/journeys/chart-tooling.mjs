import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {unzipSync,strFromU8} from 'fflate'
import {DOMParser} from '@xmldom/xmldom'
import { proveRetainedExports } from './retained-export.mjs'

/** One retained chart, through the native CLI, actual provider and built page. */
export async function proveChartTooling({origin,context,page,call,upload,proveScreen,cli,tfRun,directory,tf}) {
 const dataset='synthetic-bifocal-chart-tools',calendar='synthetic-bifocal-chart-calendar'
 const csv='id,segment,amount\n1,Positive,$12.00\n2,Negative,-$4.00\n3,Zero,$0.00\n4,Missing,\n'
 await upload(dataset,csv)
 await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Chart calendar',kind:'fiscal',startMonth:1}})
 const document={version:1,title:'Retained segment amounts',definition:{version:1,dataset,joins:[],filters:[],groupBy:['segment'],measures:[{id:'amount',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD',empty:'null'}],context:{modelVersion:'native-chart-v1',metricVersion:'native-chart-v1',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}},visual:{kind:'bar',dimension:'segment',measure:'amount'}}
 const file=join(directory,'chart.native.json'),plan=join(directory,'chart.plan.json'),exported=join(directory,'chart-export.native.json')
 await writeFile(file,JSON.stringify(document))
 const denied=await fetch(origin+'/api/operator/chart-definitions/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({document})})
 assert.equal(denied.status,401)
 const foreign=await context.request.post(origin+'/api/operator/chart-definitions/create',{headers:{Origin:'https://foreign.example.test'},data:{document,reviewedDigest:'stale'}})
 assert.equal(foreign.status(),401)
 const invalid=await context.request.post(origin+'/api/operator/chart-definitions/review',{headers:{Origin:origin},data:{document:{...document,visual:{...document.visual,html:'<svg/>'}}}})
 assert.equal(invalid.status(),400,'A chart accepts a typed visual, never arbitrary markup')
 const wrongDimension=await context.request.post(origin+'/api/operator/chart-definitions/review',{headers:{Origin:origin},data:{document:{...document,visual:{...document.visual,dimension:'id'}}}})
 assert.equal(wrongDimension.status(),400)
 const review=await cli('chart-import',['--file',file,'--plan-file',plan])
 const chart=await cli('chart-import',['--file',file,'--approve',review.digest])
 await cli('chart-export',['--id',chart.id,'--output',exported])
 assert.deepEqual(JSON.parse(await readFile(exported,'utf8')),document)
 const native=await call('/charts/'+chart.id)
 assert.deepEqual(native.answer,review.answer)
 assert.equal(native.answer.totals.amount.value,'8.00')
 assert.deepEqual(Object.fromEntries(native.answer.rows.map(row=>[row.dimensions[0],[row.values.amount.state,row.values.amount.value]])),{Missing:['null',null],Negative:['value','-4.00'],Positive:['value','12.00'],Zero:['value','0.00']})
 assert.equal((await fetch(origin+'/api/operator/charts/'+chart.id)).status,401)
 await proveRetainedExports({origin,context,snapshotId:chart.queryId,summary:[['Missing',null],['Negative','-4.00'],['Positive','12.00'],['Zero','0.00']],underlying:[['1','Positive','12.00'],['2','Negative','-4.00'],['3','Zero','0.00'],['4','Missing',null]],parts:true})
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/charts/'+chart.id)
  await page.getByRole('heading',{name:document.title,exact:true}).waitFor()
  for(const scope of ['summary','underlying'])for(const format of ['CSV','XLSX'])await page.getByRole('button',{name:'Export '+scope+' '+format,exact:true}).waitFor()
  const download=page.waitForEvent('download');await page.getByRole('button',{name:width===1440?'Export summary CSV':'Export underlying XLSX',exact:true}).click();assert.match((await download).suggestedFilename(),/bifocal-retained-/)
  await page.getByRole('status').filter({hasText:'Export complete: 4'}).waitFor()
  const table=page.getByRole('table',{name:'Exact grouped values and totals'})
  await table.getByRole('rowheader',{name:'Negative',exact:true}).waitFor()
  assert.equal(await table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Negative',exact:true})}).getByRole('cell').innerText(),'-$4.00')
  assert.equal(await table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Zero',exact:true})}).getByRole('cell').innerText(),'$0.00')
  assert.equal(await table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Missing',exact:true})}).getByRole('cell').innerText(),'NULL')
  const plot=page.getByRole('figure',{name:'amount by segment'})
  const geometry=await plot.locator('li').evaluateAll(rows=>Object.fromEntries(rows.map(row=>{const rect=row.querySelector('rect'),line=row.querySelector('line');return [row.querySelector('strong').textContent,{start:rect?Number(rect.getAttribute('x')):null,end:rect?Number(rect.getAttribute('x'))+Number(rect.getAttribute('width')):null,zero:Number(line.getAttribute('x1')),dot:!!row.querySelector('circle')}]})))
  assert.ok(geometry.Negative.start<geometry.Negative.zero);assert.equal(geometry.Negative.end,geometry.Negative.zero)
  assert.equal(geometry.Positive.start,geometry.Positive.zero);assert.ok(geometry.Positive.end>geometry.Positive.zero)
  assert.equal(geometry.Zero.dot,true);assert.equal(geometry.Missing.start,null);assert.equal(geometry.Missing.dot,false)
  assert.ok(await plot.locator('svg').first().evaluate(svg=>{const bounds=svg.getBoundingClientRect();return bounds.width>bounds.height}),'The chart has a horizontal responsive plotting area')
  await proveScreen('native-retained-chart',{widths:[width],resize:false})
 }
 await proveNumericChartSnapshots({origin,context,page,call,upload,proveScreen,directory,document})
 await proveDeclarativeCharts({origin,context,page,call,upload,proveScreen,directory,document,numericChartId:chart.id})
 const writeConfig=async(digest)=>writeFile(tf,JSON.stringify({terraform:{required_providers:{bifocal:{source:'just-every/run-bifocal',version:'0.1.0'}}},provider:{bifocal:{origin}},resource:{bifocal_chart_snapshot:{main:{document:JSON.stringify(document),...(digest?{review_digest:digest}:{})}}}}))
 const terraform=async(args,ok=true)=>tfRun([args[0],'-state=chart.tfstate',...args.slice(1)],ok)
 await writeConfig()
 await terraform(['import','-input=false','-no-color','bifocal_chart_snapshot.main',chart.id])
 let state=JSON.parse(await readFile(join(directory,'chart.tfstate'),'utf8'))
 assert.equal(state.resources[0].instances[0].attributes.query_id,chart.queryId)
 await terraform(['plan','-input=false','-no-color','-detailed-exitcode'])
 await terraform(['destroy','-auto-approve','-input=false','-no-color'])
 assert.deepEqual((await call('/charts/'+chart.id)).answer,native.answer,'Releasing Terraform tracking retains chart history')
 const terraformReview=await cli('chart-import',['--file',file,'--plan-file',join(directory,'chart-tf.plan.json')])
 await writeConfig(terraformReview.digest)
 await terraform(['plan','-input=false','-no-color','-out=chart-stale.tfplan'])
 await upload(dataset,csv.replace('$12.00','$13.00'),true)
 const before=await call('/queries')
 await terraform(['apply','-input=false','-no-color','chart-stale.tfplan'],false)
 await cli('chart-import',['--file',file,'--approve',terraformReview.digest],false)
 assert.deepEqual(await call('/queries'),before,'Stale chart creation commits neither its answer nor its artifact')
 assert.deepEqual((await call('/charts/'+chart.id)).answer,native.answer,'A source replacement leaves historical chart values pinned')
 const currentReview=await cli('chart-import',['--file',file,'--plan-file',join(directory,'chart-current.plan.json')])
 await writeConfig(currentReview.digest)
 await terraform(['plan','-input=false','-no-color','-out=chart-current.tfplan'])
 await terraform(['apply','-input=false','-no-color','chart-current.tfplan'])
 state=JSON.parse(await readFile(join(directory,'chart.tfstate'),'utf8'))
 const created=await call('/charts/'+state.resources[0].instances[0].attributes.id)
 assert.notEqual(created.id,chart.id);assert.equal(created.answer.totals.amount.value,'9.00')
 const portable=await readFile(exported,'utf8'),stateText=await readFile(join(directory,'chart.tfstate'),'utf8')
 const cookies=(await context.cookies()).map(cookie=>cookie.value)
 for(const content of [portable,stateText])for(const cookie of cookies)if(cookie)assert.ok(!content.includes(cookie),'No session credential travels in chart definitions or state')
 assert.ok(!stateText.includes('answer_json'));assert.ok(!stateText.includes('securityScope'))
 await terraform(['destroy','-auto-approve','-input=false','-no-color'])
 assert.deepEqual((await call('/charts/'+created.id)).answer,created.answer)
 const source=await call('/datasets/'+dataset)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision})
 for(const id of [chart.id,created.id])assert.equal((await context.request.get(origin+'/api/operator/charts/'+id)).status(),404,'Source erasure withdraws retained charts')
 for(const id of [chart.queryId,created.queryId])assert.equal((await context.request.post(origin+'/api/operator/queries/'+id+'/export',{headers:{Origin:origin},data:{scope:'underlying',format:'xlsx'}})).status(),404,'Erasure withdraws retained visual exports')
 console.log('Native chart tools: CLI and Terraform round trips, typed positive, negative, zero and null rendering, source drift refusal, retained history and source erasure passed')
}


/** Native bounded specifications use only the retained authorized answer table. */
async function proveDeclarativeCharts({origin,context,page,call,upload,proveScreen,directory,document,numericChartId}) {
 const dataset='synthetic-bifocal-declarative-chart'
 await upload(dataset,'id,segment,amount,target\n1,North,$12.00,$10.00\n2,East,$8.00,$9.00\n3,West,$5.00,$5.00\n')
 const definition={...document.definition,dataset,measures:[document.definition.measures[0],{...document.definition.measures[0],id:'target',column:'target'}]}
 const transforms=[{calculate:'datum.amount - datum.target',as:'variance'},{window:[{op:'sum',field:'variance',as:'cumulative'}],frame:[null,0]},{calculate:'datum.cumulative - datum.variance',as:'start'},{joinaggregate:[{op:'sum',field:'variance',as:'totalVariance'}]},{filter:{field:'segment',oneOf:['East','North']}}]
 const vl={language:'vega-lite',selection:{field:'segment',label:'Chart segment'},spec:{data:{name:'answer'},mark:'bar',transform:transforms,encoding:{x:{field:'start',type:'quantitative',scale:{type:'linear',zero:true}},x2:{field:'cumulative'},y:{field:'segment',type:'nominal'}}}}
 const vega={language:'vega',selection:vl.selection,spec:{data:[{name:'answer',transform:[{type:'formula',expr:'datum.amount - datum.target',as:'variance'},{type:'window',ops:['sum'],fields:['variance'],as:['cumulative'],frame:[null,0]},{type:'formula',expr:'datum.cumulative - datum.variance',as:'start'},{type:'joinaggregate',ops:['sum'],fields:['variance'],as:['totalVariance']},{type:'filter',expr:'datum.segment !== "West"'}]}],scales:[{name:'x',type:'linear',domain:{data:'answer',field:'cumulative'},range:'width',zero:true},{name:'y',type:'band',domain:{data:'answer',field:'segment'},range:'height'}],marks:[{type:'rect',from:{data:'answer'},encode:{enter:{x:{scale:'x',field:'start'},x2:{scale:'x',field:'cumulative'},y:{scale:'y',field:'segment'}}}}]}}
 const chartDocument=specification=>({...document,title:'Retained operating variance',definition,visual:{...document.visual,specification}})
 const headers={Origin:origin},post=(path,data)=>context.request.post(origin+'/api/operator'+path,{headers,data})
 const reviewed=await call('/chart-definitions/review',{document:chartDocument(vl)})
 const unsafe=[
  {...vl,spec:{...vl.spec,data:{url:'https://invalid.example.test/data.json'}}},
  {...vl,spec:{...vl.spec,data:{name:'answer',values:[{amount:'invented'}]}}},
  {...vl,spec:{...vl.spec,mark:{type:'image',url:'https://invalid.example.test/image.png'}}},
  {...vl,spec:{...vl.spec,transform:[{calculate:'fetch("https://invalid.example.test")',as:'unsafe'}]}},
  {...vl,spec:{...vl.spec,transform:[{calculate:'datum.amount.constructor("return globalThis")()',as:'unsafe'}]}},
  {...vl,spec:{...vl.spec,transform:[{calculate:'datum.amount * datum.target',as:'unsafe'}]}},
  {...vl,spec:{...vl.spec,transform:[{calculate:'datum.amount / datum.target',as:'unsafe'}]}},
  {...vl,spec:{...vl.spec,transform:[{calculate:'datum.hiddenPayroll',as:'unsafe'}]}},
  {...vl,spec:{...vl.spec,encoding:{...vl.spec.encoding,color:{field:'segment'}}}},
  {...vl,spec:{...vl.spec,signals:[{name:'unsafe',on:[{events:'click',update:'window.location'}]}]}},
  {...vl,spec:{...vl.spec,encoding:{...vl.spec.encoding,x:{field:'start',type:'quantitative',scale:{type:'log'}}}}},
  {...vl,selection:{field:'hiddenPayroll',label:'Hidden'}},
  {...vega,spec:{...vega.spec,data:[{name:'answer',transform:[{type:'filter',expr:'fetch("https://invalid.example.test")'}]}]}},
  {...vega,spec:{...vega.spec,marks:[{...vega.spec.marks[0],encode:{enter:{...vega.spec.marks[0].encode.enter,href:{value:'https://invalid.example.test'}}}}]}}
 ]
 const before=await call('/queries')
 for(const specification of unsafe)for(const action of ['review','create'])assert.equal((await post('/chart-definitions/'+action,{document:chartDocument(specification),reviewedDigest:reviewed.digest})).status(),400,'Unknown or unsafe declarative constructs are refused before a chart can publish')
 assert.deepEqual(await call('/queries'),before,'Rejected specifications create no retained answer')
 const artifacts=[]
 for(const specification of [vl,vega]){
  const doc=chartDocument(specification),review=await call('/chart-definitions/review',{document:doc}),created=await call('/chart-definitions/create',{document:doc,reviewedDigest:review.digest}),native=await call('/charts/'+created.id)
  artifacts.push(native)
  assert.deepEqual(native.visual.specification,specification)
  assert.deepEqual(native.view.rows.map(row=>[row.label,row.values.variance.value,row.values.cumulative.value,row.values.start.value,row.values.totalVariance.value]),[['East','-1.00','-1.00','0.00','1.00'],['North','2.00','1.00','-1.00','1.00']])
  assert.equal(native.view.totals.variance.value,'1.00');assert.equal(native.view.totals.amount.value,'25.00')
  assert.equal((await fetch(origin+'/app/charts/'+created.id)).status,401)
 }
 assert.deepEqual(artifacts[0].view.rows,artifacts[1].view.rows,'The two bounded declarative languages preserve equivalent exact values')
 for(const role of ['admin','member']){
  const email='synthetic-bifocal-visual-'+role+'@example.test',mailHeaders={Origin:origin,'X-Bifocal-Test-Mail':'synthetic-bifocal-mail'}
  const invited=await context.request.post(origin+'/auth/invite',{headers:mailHeaders,data:{email,displayName:'Synthetic visual '+role,role}});assert.equal(invited.status(),202,await invited.text())
  const mail=await(await context.request.get(origin+'/__model-mail')).json(),message=mail.find(value=>value.to.includes(email));assert.ok(message)
  const token=new URL(message.text.match(/https?:[^\s]+/)[0]).searchParams.get('token');assert.ok(token)
  const reader=await context.browser().newContext()
  try{
   assert.equal((await reader.request.post(origin+'/auth/confirm',{headers:mailHeaders,data:{token},maxRedirects:0})).status(),303)
   assert.equal((await(await reader.request.get(origin+'/auth/session')).json()).operator.role,role)
   assert.equal((await reader.request.get(origin+'/api/operator/charts/'+artifacts[0].id)).status(),401)
   for(const action of ['review','download'])for(const data of [{format:'pdf'},{format:'pptx',rendition:'numeric'}])assert.equal((await reader.request.post(origin+'/api/operator/charts/'+(data.rendition==='numeric'?numericChartId:artifacts[0].id)+'/snapshot/'+action,{headers:{Origin:origin},data})).status(),401,'A signed-in non-owner cannot review or download a chart snapshot')
   assert.equal((await reader.request.post(origin+'/api/operator/chart-definitions/review',{headers:{Origin:origin},data:{document:chartDocument(vl)}})).status(),401)
  }finally{await reader.close()}
 }

 const point={...vl,spec:{data:{name:'answer'},mark:'point',encoding:{x:{field:'amount',type:'quantitative',scale:{type:'linear',zero:false,reverse:true,domain:['0','30']}},y:{field:'segment',type:'nominal'}}}}
 const pointReview=await call('/chart-definitions/review',{document:chartDocument(point)}),pointChart=await call('/chart-definitions/create',{document:chartDocument(point),reviewedDigest:pointReview.digest})
 await page.goto(origin+'/app/charts/'+pointChart.id);assert.equal(await page.locator('.native-chart circle').count(),3)
 await proveScreen('declarative-chart-points')
 const domainCharts=[]
 for(const reverse of [false,true]){
  const specification={language:'vega',spec:{data:[{name:'answer'}],scales:[{name:'x',type:'linear',domain:{data:'answer',field:'target'},range:'width',zero:false,reverse},{name:'y',type:'band',domain:{data:'answer',field:'segment'},range:'height'}],marks:[{type:'rect',from:{data:'answer'},encode:{enter:{x:{scale:'x',field:'amount'},x2:{scale:'x',field:'target'},y:{scale:'y',field:'segment'}}}}]}}
  const doc=chartDocument(specification),review=await call('/chart-definitions/review',{document:doc}),created=await call('/chart-definitions/create',{document:doc,reviewedDigest:review.digest})
  domainCharts.push(created)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/charts/'+created.id)
   const bars=await page.locator('.native-chart li').evaluateAll(rows=>Object.fromEntries(rows.map(row=>{const rect=row.querySelector('rect'),dot=row.querySelector('circle');return [row.querySelector('strong').textContent,rect?{x:Number(rect.getAttribute('x')),width:Number(rect.getAttribute('width'))}:{dot:dot?Number(dot.getAttribute('cx')):null}]})))
   assert.deepEqual(bars,{East:{x:reverse?120:360,width:120},North:{x:reverse?0:600,width:0},West:{dot:reverse?600:0}},'Only declared target values define the scale; out-of-domain amount values are clipped')
   assert.equal(await page.locator('.native-chart .chart-zero').count(),0,'A zero baseline outside the declared domain is omitted')
   const table=page.getByRole('table',{name:'Exact grouped values and totals'})
   assert.deepEqual(await table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'North',exact:true})}).getByRole('cell').allTextContents(),['USD 12.00','USD 10.00'],'Clipping preserves accessible exact values')
   const menu=page.locator('.menu > summary'),tooltip=page.locator('#settings-menu-tooltip')
   await menu.hover();await tooltip.waitFor({state:'visible'})
   await page.mouse.move(0,0);await tooltip.waitFor({state:'hidden'})
   await menu.focus();assert.equal(await tooltip.isVisible(),true,'The phone gear tooltip is available immediately on keyboard focus')
   await proveScreen('declarative-domain-'+(reverse?'reversed':'forward')+'-'+width,{widths:[width],resize:false})
  }
  for(const format of ['pdf','pptx']){
   const snapshot=await call('/charts/'+created.id+'/snapshot/review',{format})
   const east=snapshot.pages.flatMap(page=>page.shapes).filter(shape=>shape.label?.startsWith('Plot East |'))
   assert.equal(east.length,1);assert.equal(east[0].kind,'rect');assert.equal(east[0].x,reverse?264:664);assert.equal(east[0].w,200,'Protected snapshot geometry uses the same declared domain')
   assert.equal(snapshot.pages.flatMap(page=>page.shapes).filter(shape=>shape.label?.startsWith('Plot North |')).length,0,'The out-of-range interval contributes no export geometry')
  }
 }
 for(const artifact of artifacts){const refused=await post('/charts/'+artifact.id+'/snapshot/review',{format:'pptx',rendition:'numeric'});assert.equal(refused.status(),422);assert.equal((await refused.json()).error,'chart_numeric_requires_ordinary_single_series_bar')}
 const selected={field:'segment',value:'North'},endpoint='/charts/'+artifacts[0].id+'/snapshot',snapshots=[]
 for(const format of ['pdf','pptx']){
  const input={format,selection:selected},review=await call(endpoint+'/review',input)
  assert.deepEqual(review.provenance.view.rows.map(row=>row.label),['North']);assert.equal(review.provenance.view.rows[0].values.variance.value,'2.00')
  assert.ok(review.pages.some(page=>page.shapes.some(shape=>shape.kind==='text'&&shape.lines.join(' ').includes('variance: USD 2.00'))))
  const data={...input,exportedAt:review.exportedAt,reviewedDigest:review.digest},response=await post(endpoint+'/download',data)
  assert.equal(response.status(),200,await response.text());assert.equal(response.headers()['cache-control'],'no-store')
  const bytes=await response.body();await writeFile(join(directory,'declarative-chart.'+format),bytes)
  if(process.env.BIFOCAL_PROOF_DIR)await writeFile(join(process.env.BIFOCAL_PROOF_DIR,'declarative-chart.'+format),bytes)
  if(format==='pdf'){
   const pdf=bytes.toString('latin1').replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)))
   assert.ok(pdf.startsWith('%PDF-1.7'));assert.match(pdf,/North \| amount: USD 12.00/);assert.match(pdf,/variance: USD 2.00/);assert.match(pdf,/\/StructTreeRoot/)
   assert.ok(!pdf.includes('East | amount:'));assert.ok(!pdf.includes('"label":"East"'))
  }else{
   const parts=unzipSync(bytes),slides=Object.entries(parts).filter(([name])=>/^ppt\/slides\/slide\d+\.xml$/.test(name))
   assert.ok(slides.length>0)
   for(const [,part] of slides){const xml=strFromU8(part);assert.match(xml,/North \| amount: USD 12.00/);assert.match(xml,/variance: USD 2.00/);assert.ok(!xml.includes('East | amount:'))}
   for(const [name,part] of Object.entries(parts))if(name.endsWith('.xml'))assert.ok(!strFromU8(part).includes('&quot;label&quot;:&quot;East&quot;'))
  }
  assert.equal((await post(endpoint+'/download',{...data,selection:{field:'segment',value:'East'}})).status(),409,'A changed displayed selection needs its own exact snapshot review')
  snapshots.push(data)
 }
 assert.equal((await fetch(origin+'/api/operator'+endpoint+'/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({format:'pdf',selection:selected})})).status,401)
 assert.equal((await context.request.post(origin+'/api/operator'+endpoint+'/review',{headers:{Origin:'https://foreign.example.test'},data:{format:'pdf'}})).status(),401)
 assert.equal((await post(endpoint+'/review',{format:'pdf',selection:{field:'hiddenPayroll',value:'North'}})).status(),400)
 assert.equal((await post(endpoint+'/review',{format:'pdf',selection:{field:'segment',value:'Absent'}})).status(),400)
 for(const width of [1440,390])for(const artifact of artifacts){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/charts/'+artifact.id)
  const table=page.getByRole('table',{name:'Exact grouped values and totals'})
  assert.equal(await table.locator('tbody tr').count(),2)
  assert.deepEqual(await table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'North',exact:true})}).getByRole('cell').allTextContents(),['USD 12.00','USD 10.00','USD 2.00','USD 1.00','USD -1.00','USD 1.00'])
  const plot=page.getByRole('figure',{name:'start to cumulative by segment'})
  assert.equal(await plot.locator('li').count(),2);assert.equal(await plot.locator('rect').count(),2)
  await proveScreen('declarative-chart-'+artifact.view.language+'-'+width,{widths:[width],resize:false})
  await page.getByLabel('Chart segment',{exact:true}).selectOption({label:'North'});await page.getByRole('button',{name:'Apply selection',exact:true}).click()
  await page.waitForURL(url=>url.searchParams.has('selection'))
  assert.equal(await table.locator('tbody tr').count(),1);assert.equal(await table.getByRole('rowheader',{name:'East',exact:true}).count(),0)
  assert.deepEqual(JSON.parse(await page.locator('[data-chart-snapshot]').getAttribute('data-chart-selection')),selected)
  await page.getByLabel('Snapshot format',{exact:true}).selectOption(width===1440?'pdf':'pptx')
  await page.getByRole('button',{name:'Review chart snapshot',exact:true}).click()
  await page.waitForFunction(()=>!document.querySelector('[data-chart-snapshot-download]').disabled)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await proveScreen('declarative-chart-selected-'+artifact.view.language+'-'+width,{widths:[width],resize:false})
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download reviewed chart snapshot',exact:true}).click();assert.match((await download).suggestedFilename(),width===1440?/\.pdf$/:/\.pptx$/)
 }
 const source=await call('/datasets/'+dataset)
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision})
 for(const artifact of [...artifacts,pointChart,...domainCharts])assert.equal((await context.request.get(origin+'/api/operator/charts/'+artifact.id)).status(),404)
 for(const data of snapshots)assert.equal((await post(endpoint+'/download',data)).status(),404,'Erasure withdraws previously reviewed declarative chart snapshots')
 console.log('Declarative charts: retained exact variance and cumulative intervals, equivalent languages, safe point scales, native selections, protected files and unsafe specification refusal passed')
}


/** Independent package inspection follows relationships and reads typed cells. */
async function proveNumericChartSnapshots({origin,context,page,call,upload,proveScreen,directory,document}){
 const dataset='synthetic-bifocal-numeric-chart',headers={Origin:origin}
 const csv='id,region,segment,amount\n1,Selected,Positive,$12.00\n2,Selected,Negative,-$4.00\n3,Selected,Zero,$0.00\n4,Selected,Missing,\n5,Withheld,Unselected category,$98765.43\n'
 await upload(dataset,csv)
 const doc={...document,title:'Reviewed numeric segment amounts',definition:{...document.definition,dataset,filters:[{column:'region',op:'eq',value:'Selected'}]}}
 const create=async document=>{const review=await call('/chart-definitions/review',{document});return call('/chart-definitions/create',{document,reviewedDigest:review.digest})}
 const chart=await create(doc),endpoint='/charts/'+chart.id+'/snapshot',post=(path,data,extra={})=>context.request.post(origin+'/api/operator'+path,{headers:{...headers,...extra},data})
 const expected=[['Missing',null],['Negative','-4.00'],['Positive','12.00'],['Zero','0.00']]
 const parse=bytes=>new DOMParser({onError:level=>{if(level!=='warning')throw Error('Invalid numeric presentation XML')}}).parseFromString(strFromU8(bytes),'application/xml')
 const values=(node,namespace,name)=>Array.from(node.getElementsByTagNameNS(namespace,name))
 const ns='http://schemas.openxmlformats.org/',cn=ns+'drawingml/2006/chart',sn=ns+'spreadsheetml/2006/main',rn=ns+'package/2006/relationships'
 const inspect=async bytes=>{
  const parts=unzipSync(bytes),chartNames=Object.keys(parts).filter(name=>/^ppt\/charts\/chart\d+\.xml$/.test(name))
  assert.equal(chartNames.length,1)
  const contentTypes=parse(parts['[Content_Types].xml'])
  assert.ok(strFromU8(parts['[Content_Types].xml']).includes('drawingml.chart+xml'))
  assert.ok(contentTypes.documentElement)
  const native=parse(parts[chartNames[0]])
  assert.equal(values(native,cn,'barDir')[0].getAttribute('val'),'bar')
  assert.equal(values(native,cn,'ser').length,1)
  assert.equal(values(native,cn,'title')[0].textContent,doc.title)
  assert.equal(values(values(values(native,cn,'ser')[0],cn,'tx')[0],cn,'v')[0].textContent,'amount')
  const categories=values(values(native,cn,'cat')[0],cn,'pt').map(pt=>values(pt,cn,'v')[0].textContent)
  assert.deepEqual(categories,expected.map(row=>row[0]))
  const numeric=values(values(native,cn,'val')[0],cn,'numCache')[0],points=values(numeric,cn,'pt')
  assert.deepEqual(points.map(pt=>[Number(pt.getAttribute('idx')),values(pt,cn,'v')[0].textContent]),[[1,'-4.00'],[2,'12.00'],[3,'0.00']])
  assert.equal(values(numeric,cn,'ptCount')[0].getAttribute('val'),'4','A missing value is a gap; zero is a numeric point')
  assert.equal(values(native,cn,'dispBlanksAs')[0].getAttribute('val'),'gap')
  assert.match(values(numeric,cn,'formatCode')[0].textContent,/USD/)
  assert.equal(values(native,cn,'autoUpdate')[0].getAttribute('val'),'0')
  const binding=values(native,cn,'externalData')[0].getAttributeNS(ns+'officeDocument/2006/relationships','id')
  const rels=parse(parts[chartNames[0].replace('/chart1.xml','/_rels/chart1.xml.rels')]),workbookRel=values(rels,rn,'Relationship').find(rel=>rel.getAttribute('Id')===binding)
  assert.ok(workbookRel.getAttribute('Type').endsWith('/package'));assert.ok(!workbookRel.getAttribute('TargetMode'))
  const workbookPath='ppt/'+workbookRel.getAttribute('Target').replace('../',''),workbook=unzipSync(parts[workbookPath])
  const sheet=parse(workbook['xl/worksheets/sheet1.xml']),rows=values(sheet,sn,'row')
  assert.deepEqual(rows.map(row=>values(row,sn,'c').map(cell=>cell.getAttribute('t')==='inlineStr'?values(cell,sn,'t')[0].textContent:values(cell,sn,'v')[0]?.textContent??null)),[['segment','amount'],...expected])
  assert.equal(values(sheet,sn,'f').length,0)
  assert.deepEqual(values(sheet,sn,'c').filter(cell=>cell.getAttribute('t')==='n').map(cell=>cell.getAttribute('r')),['B3','B4','B5'])
  const workbookRels=parse(workbook['xl/_rels/workbook.xml.rels']),stylesRel=values(workbookRels,rn,'Relationship').find(rel=>rel.getAttribute('Type').endsWith('/styles'))
  assert.ok(stylesRel&&!stylesRel.getAttribute('TargetMode'),'Number formats are embedded, with no external dependency')
  const styles=parse(workbook['xl/'+stylesRel.getAttribute('Target')]),formats=values(styles,sn,'numFmt'),cellStyles=values(values(styles,sn,'cellXfs')[0],sn,'xf')
  for(const cell of values(sheet,sn,'c').filter(cell=>/^B[2-5]$/.test(cell.getAttribute('r')))){
   const format=formats.find(format=>format.getAttribute('numFmtId')===cellStyles[Number(cell.getAttribute('s'))].getAttribute('numFmtId'))
   assert.equal(format?.getAttribute('formatCode'),'"USD "0.00;-"USD "0.00;"USD "0.00','Editing the numeric workbook preserves exact USD units, negative signs, zero and missing cells')
  }
  assert.ok(values(sheet,sn,'c').filter(cell=>cell.getAttribute('r').startsWith('A')||cell.getAttribute('r')==='B1').every(cell=>!cell.hasAttribute('s')),'Category labels and the measure header retain text semantics')
  const slide=parse(parts['ppt/slides/slide1.xml']),graphic=values(slide,ns+'presentationml/2006/main','graphicFrame')[0]
  assert.ok(graphic,'The numeric chart is editable DrawingML, not an image')
  assert.match(values(graphic,ns+'presentationml/2006/main','cNvPr')[0].getAttribute('descr'),/Missing: NULL; Negative: USD -4.00; Positive: USD 12.00; Zero: USD 0.00/)
  const slideRels=parse(parts['ppt/slides/_rels/slide1.xml.rels'])
  assert.ok(values(slideRels,rn,'Relationship').some(rel=>rel.getAttribute('Type').endsWith('/chart')&&rel.getAttribute('Target')==='../charts/chart1.xml'))
  const cookies=(await context.cookies()).map(cookie=>cookie.value)
  for(const [name,part] of [...Object.entries(parts),...Object.entries(workbook)]){
   assert.ok(!/connections|externalLinks|vbaProject|activeX|oleObject/i.test(name))
   if(!/\.(?:xml|rels)$/.test(name))continue
   const text=strFromU8(part),xml=parse(part)
   assert.ok(!text.includes('Unselected category'));assert.ok(!text.includes('98765.43'))
   for(const cookie of cookies)if(cookie)assert.ok(!text.includes(cookie),'Credentials never enter a chart package')
   for(const rel of values(xml,rn,'Relationship'))assert.notEqual(rel.getAttribute('TargetMode'),'External')
  }
 }
 const retained=await call('/charts/'+chart.id),reviews=[]
 for(const input of [{format:'pdf'},{format:'pptx'},{format:'pptx',rendition:'numeric'}]){
  const review=await call(endpoint+'/review',input),data={...input,exportedAt:review.exportedAt,reviewedDigest:review.digest},response=await post(endpoint+'/download',data)
  assert.equal(response.status(),200,await response.text());assert.equal(response.headers()['cache-control'],'no-store')
  const bytes=await response.body()
  if(input.rendition==='numeric'){
   assert.deepEqual(review.pages[0].numericChart.rows.map(row=>[row.label,row.value]),expected)
   await inspect(bytes)
   await writeFile(join(directory,'numeric-chart.pptx'),bytes)
   if(process.env.BIFOCAL_PROOF_DIR)await writeFile(join(process.env.BIFOCAL_PROOF_DIR,'numeric-chart.pptx'),bytes)
   assert.equal((await post(endpoint+'/download',{...data,rendition:'static'})).status(),409,'Changing the rendition invalidates exact review')
   assert.equal((await post(endpoint+'/download',{...data,selection:{field:'segment',value:'Positive'}})).status(),400,'An unreviewed selection cannot widen or change an ordinary chart')
   assert.equal((await post(endpoint+'/download',{...data,exportedAt:new Date(Date.parse(review.exportedAt)-600001).toISOString()})).status(),409,'Expired review cannot release bytes')
   for(const action of ['review','download'])assert.equal((await post(endpoint+'/'+action,data,{Authorization:'Bearer synthetic-bifocal-machine'})).status(),401,'A bearer plus an owner cookie has no export authority')
  }else if(input.format==='pdf'){
   const pdf=bytes.toString('latin1').replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)))
   assert.ok(pdf.includes(doc.title));for(const [label,value] of expected)assert.ok(pdf.includes(label+' | amount: '+(value===null?'NULL':'USD '+value)))
   assert.ok(!pdf.includes('Unselected category'));assert.ok(!pdf.includes('98765.43'))
  }else assert.equal(Object.keys(unzipSync(bytes)).filter(name=>name.startsWith('ppt/charts/')).length,0,'The existing static rendition is unchanged')
  reviews.push(data)
 }
 for(const input of [{format:'pdf',rendition:'numeric'},{format:'pptx',rendition:'unknown'}])assert.equal((await post(endpoint+'/review',input)).status(),400)
 assert.equal((await fetch(origin+'/api/operator'+endpoint+'/review',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({format:'pptx',rendition:'numeric'})})).status,401)
 assert.equal((await post(endpoint+'/review',{format:'pptx',rendition:'numeric'},{Origin:'https://foreign.example.test'})).status(),401)
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/charts/'+chart.id)
 await page.getByLabel('Snapshot format',{exact:true}).selectOption('pptx-numeric')
 await page.getByRole('button',{name:'Review chart snapshot',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-chart-snapshot-download]').disabled)
 const preview=page.getByLabel('Reviewed numeric chart',{exact:true})
 assert.match(await preview.innerText(),/Reviewed numeric segment amounts\nMeasure: amount/)
 for(const [label,value] of expected)assert.ok((await preview.innerText()).includes(label+': '+(value===null?'NULL':'USD '+value)))
 await page.getByLabel('Snapshot format',{exact:true}).selectOption('pptx');assert.equal(await page.getByRole('button',{name:'Download reviewed chart snapshot',exact:true}).isDisabled(),true)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.getByLabel('Snapshot format',{exact:true}).selectOption('pptx-numeric');await page.getByRole('button',{name:'Review chart snapshot',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-chart-snapshot-download]').disabled)
  await proveScreen('numeric-chart-reviewed-'+width,{widths:[width],resize:false})
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download reviewed chart snapshot',exact:true}).click();const download=await downloaded;if(width===1440){assert.match(download.suggestedFilename(),/\.pptx$/);await inspect(await readFile(await download.path()))}
 }
 for(const [suffix,data,error] of [
  ['many','id,segment,amount\n'+Array.from({length:41},(_,i)=>i+',Category '+i+',$1.00').join('\n')+'\n','chart_numeric_category_limit_40'],
  ['precision','id,segment,amount\n1,Precise,$12345678901234.56\n','xlsx_numeric_precision_limit'],
  ['label','id,segment,amount\n1,'+'x'.repeat(61)+',$1.00\n','chart_numeric_category_label_does_not_fit']
 ]){
  const id='synthetic-bifocal-numeric-'+suffix;await upload(id,data)
  const created=await create({...document,definition:{...document.definition,dataset:id}}),response=await post('/charts/'+created.id+'/snapshot/review',{format:'pptx',rendition:'numeric'})
  assert.equal(response.status(),422,await response.text());assert.equal((await response.json()).error,error)
 }
 const supportedId='synthetic-bifocal-numeric-forty'
 await upload(supportedId,'id,segment,amount\n'+Array.from({length:40},(_,i)=>i+',Category '+i+',$1.00').join('\n')+'\n')
 const forty=await create({...document,definition:{...document.definition,dataset:supportedId}}),fortyReview=await call('/charts/'+forty.id+'/snapshot/review',{format:'pptx',rendition:'numeric'})
 assert.equal(fortyReview.pages[0].numericChart.rows.length,40,'The complete supported category boundary is retained')
 const fortyFile=await post('/charts/'+forty.id+'/snapshot/download',{format:'pptx',rendition:'numeric',exportedAt:fortyReview.exportedAt,reviewedDigest:fortyReview.digest})
 assert.equal(fortyFile.status(),200)
 const fortyParts=unzipSync(await fortyFile.body()),fortyNative=parse(fortyParts['ppt/charts/chart1.xml']),fortyBook=unzipSync(fortyParts['ppt/embeddings/chart1.xlsx'])
 const fortyLabels=Array.from({length:40},(_,i)=>'Category '+i).sort()
 assert.deepEqual(values(values(fortyNative,cn,'cat')[0],cn,'v').map(value=>value.textContent),fortyLabels,'The downloaded chart keeps every category without truncation')
 assert.deepEqual(values(values(fortyNative,cn,'val')[0],cn,'v').map(value=>value.textContent),Array(40).fill('1.00'))
 assert.deepEqual(values(parse(fortyBook['xl/worksheets/sheet1.xml']),sn,'row').slice(1).map(row=>[values(row,sn,'t')[0].textContent,values(row,sn,'v')[0].textContent]),fortyLabels.map(label=>[label,'1.00']),'Every category has its independently typed numeric worksheet cell')
 const stateId='synthetic-bifocal-numeric-states';await upload(stateId,'id,segment,amount,quality\n1,Unknown,$1.00,unknown\n2,Suppressed,$2.00,suppressed\n3,Incomplete,$3.00,incomplete\n')
 const states=await create({...document,definition:{...document.definition,dataset:stateId,measures:[{...document.definition.measures[0],stateColumn:'quality'}]}}),refusedStates=await post('/charts/'+states.id+'/snapshot/review',{format:'pptx',rendition:'numeric'})
 assert.equal(refusedStates.status(),422);assert.equal((await refusedStates.json()).error,'chart_numeric_value_state_not_supported')
 const empty=await create({...doc,definition:{...doc.definition,filters:[{column:'region',op:'eq',value:'Absent'}]}})
 assert.equal((await post('/charts/'+empty.id+'/snapshot/review',{format:'pptx',rendition:'numeric'})).status(),422)
 const multiple=await create({...doc,definition:{...doc.definition,measures:[...doc.definition.measures,{...doc.definition.measures[0],id:'second'}]}})
 assert.equal((await post('/charts/'+multiple.id+'/snapshot/review',{format:'pptx',rendition:'numeric'})).status(),422)
 const literalId='synthetic-bifocal-numeric-literal';await upload(literalId,'id,segment,amount\n1,=1+1,$1.00\n')
 const literal=await create({...document,definition:{...document.definition,dataset:literalId}}),literalReview=await call('/charts/'+literal.id+'/snapshot/review',{format:'pptx',rendition:'numeric'}),literalFile=await post('/charts/'+literal.id+'/snapshot/download',{format:'pptx',rendition:'numeric',exportedAt:literalReview.exportedAt,reviewedDigest:literalReview.digest})
 assert.equal(literalFile.status(),200);const literalParts=unzipSync(await literalFile.body()),literalBook=unzipSync(literalParts['ppt/embeddings/chart1.xlsx']),literalSheet=parse(literalBook['xl/worksheets/sheet1.xml'])
 assert.equal(values(literalSheet,sn,'f').length,0);assert.equal(values(literalSheet,sn,'c').find(cell=>cell.getAttribute('r')==='A2').getAttribute('t'),'inlineStr');assert.equal(values(literalSheet,sn,'t').at(-1).textContent,'=1+1')
 assert.deepEqual((await call('/charts/'+chart.id)).answer,retained.answer,'Encoding does not change the immutable historical answer')
 const source=await call('/datasets/'+dataset),erase={confirmDataset:dataset,reviewedRevision:source.revision}
 let previousRevision=null
 for(const protection of [{legalHold:true,minimumRetainUntil:null},{legalHold:false,minimumRetainUntil:'2099-01-01T00:00:00.000Z'}]){
  const response=await context.request.put(origin+'/api/operator/retention/'+dataset,{headers,data:{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,...protection,releaseHold:true}})
  assert.equal(response.status(),200,await response.text());previousRevision=(await response.json()).revision
  assert.equal((await post('/datasets/'+dataset+'/erase',erase)).status(),423)
  assert.equal((await post(endpoint+'/download',reviews[2])).status(),200,'Held erasure preserves authorized exports')
 }
 assert.equal((await context.request.put(origin+'/api/operator/retention/'+dataset,{headers,data:{confirmDataset:dataset,reviewedDatasetRevision:source.revision,previousRevision,legalHold:false,minimumRetainUntil:null,releaseHold:true}})).status(),200)
 assert.equal((await post('/datasets/'+dataset+'/erase',erase)).status(),200)
 for(const data of reviews)assert.equal((await post(endpoint+'/download',data)).status(),404,'Eligible erasure withdraws all previously reviewed renditions')
 assert.equal((await post(endpoint+'/review',{format:'pptx',rendition:'numeric'})).status(),404)
 console.log('PROBE BIF-074 numeric: protected browser review and downloads -> editable chart, exact positive, negative, zero and missing cells, title, legend and matching PDF; unselected rows and credentials absent')
 console.log('PROBE BIF-074 refusal: changed rendition and selection, expired review, unsafe semantics, precision, overflow, bearer and foreign requests -> refused without release')
 console.log('PROBE BIF-074 erasure: legal hold and minimum retention -> 423; released eligible source erasure -> historical exports 404')
}
