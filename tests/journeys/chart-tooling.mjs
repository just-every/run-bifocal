import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {unzipSync,strFromU8} from 'fflate'
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
 await proveNativeChartBuilder({origin,context,page,call,upload,proveScreen})
 await proveDeclarativeCharts({origin,context,page,call,upload,proveScreen,directory,document})
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
async function proveDeclarativeCharts({origin,context,page,call,upload,proveScreen,directory,document}) {
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
   for(const action of ['review','download'])assert.equal((await reader.request.post(origin+'/api/operator/charts/'+artifacts[0].id+'/snapshot/'+action,{headers:{Origin:origin},data:{format:'pdf'}})).status(),401,'A signed-in non-owner cannot review or download a chart snapshot')
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

/** Four native charts are created with real controls over independently checked USD rows. */
export async function proveNativeChartBuilder({origin,context,page,upload,proveScreen}) {
 const call=async(path,data)=>{const response=await context.request.fetch(origin+'/api/operator'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin},...(data===undefined?{}:{data})});assert.ok(response.ok(),await response.text());return response.json()}
 page.setDefaultTimeout(20000)
 const dataset='synthetic-bifocal-native-charts',calendar='synthetic-bifocal-native-chart-calendar'
 const csv='id,segment,amount\n1,1 Sales,$12.00\n2,2 Unreported,\n3,3 Refunds,-$4.00\n4,4 No sales,$0.00\n5,5 Support,$2.00\n'
 await upload(dataset,csv)
 await call('/calendars',{id:calendar,previousVersion:null,definition:{name:'Native chart calendar',kind:'fiscal',startMonth:1}})
 const definition={version:1,dataset,joins:[],filters:[],groupBy:['segment'],measures:[{id:'amount',op:'sum',column:'amount',unit:'money',scale:2,sourceCurrency:'USD',empty:'null'}],context:{modelVersion:'native-chart-v1',metricVersion:'native-chart-v1',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 const answer=await call('/queries/run',definition),expected=[['1 Sales','12.00'],['2 Unreported',null],['3 Refunds','-4.00'],['4 No sales','0.00'],['5 Support','2.00']]
 const headers={Origin:origin},post=(path,data)=>context.request.post(origin+'/api/operator'+path,{headers,data}),charts=[],reviews=[]
 assert.deepEqual(answer.answer.rows.map(row=>[row.dimensions[0],row.values.amount.value]),expected)
 assert.equal(answer.answer.totals.amount.value,'10.00','Independent integer cents: 1200 - 400 + 0 + 200 = 1000')
 assert.equal((await fetch(origin+'/app/charts/new')).status,401)
 for(const width of [1440,390])for(const kind of ['vertical-bar','line','stepped-line','area']){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/queries/'+answer.queryId)
  await page.getByRole('link',{name:'Build a chart',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Choose chart settings'}).waitFor()
  await page.getByLabel('Chart title',{exact:true}).fill('Finance '+kind+' '+width)
  await page.getByLabel('Chart type',{exact:true}).selectOption(kind)
  assert.deepEqual(await page.getByLabel('Dimension',{exact:true}).locator('option').allTextContents(),['segment · dimension'])
  assert.equal(await page.getByLabel('Measure',{exact:true}).inputValue(),'amount')
  await page.getByLabel('Order by',{exact:true}).selectOption('segment')
  await page.getByLabel('Order direction',{exact:true}).selectOption('ascending')
  if(kind==='line'||kind==='stepped-line')await page.getByLabel('Value scale',{exact:true}).selectOption('auto')
  await page.getByRole('button',{name:'Review current chart',exact:true}).focus();await page.keyboard.press('Enter')
  await page.getByRole('status').filter({hasText:'Current exact values reviewed'}).waitFor()
  const reviewTable=page.getByRole('table',{name:'Current exact rows and complete query totals'});assert.equal(await reviewTable.locator('tbody tr').count(),5);assert.match(await reviewTable.locator('tbody td').first().innerText(),/^USD 12.00/)
  await proveScreen('native-builder-'+kind+'-'+width,{widths:[width],resize:false})
  await page.getByLabel('Chart title',{exact:true}).fill('Reviewed finance '+kind+' '+width)
  assert.equal(await page.getByRole('button',{name:'Create reviewed chart',exact:true}).isDisabled(),true,'Any edit invalidates the review')
  await page.getByRole('button',{name:'Review current chart',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Current exact values reviewed'}).waitFor()
  await page.getByRole('button',{name:'Create reviewed chart',exact:true}).focus();await page.keyboard.press('Enter')
  await page.waitForURL(/\/app\/charts\/[a-f0-9-]{36}$/)
  const id=new URL(page.url()).pathname.split('/').at(-1),chart=await call('/charts/'+id)
  charts.push(chart)
  assert.equal(chart.visual.kind,kind);assert.deepEqual(chart.view.rows.map(row=>[row.label,row.values.amount.value]),expected)
  assert.equal(chart.answer.totals.amount.value,'10.00')
  const figure=page.getByRole('figure',{name:'amount by segment'}),table=page.getByRole('table',{name:'Exact grouped values and totals'})
  assert.deepEqual(await table.locator('tbody td').allTextContents(),['$12.00','NULL','-$4.00','$0.00','$2.00'])
  assert.deepEqual(await figure.locator('.series-values li').allTextContents(),['1. 1 Sales · $12.00','2. 2 Unreported · NULL','3. 3 Refunds · -$4.00','4. 4 No sales · $0.00','5. 5 Support · $2.00'])
  assert.match(await figure.locator('desc').textContent(),/2\. 2 Unreported: NULL; 3\. 3 Refunds: -\$4\.00/)
  const geometry=await figure.locator('.series-marks').evaluate(group=>({rects:[...group.querySelectorAll('rect')].map(r=>({y:Number(r.getAttribute('y')),height:Number(r.getAttribute('height'))})),circles:[...group.querySelectorAll('circle')].map(r=>({x:Number(r.getAttribute('cx')),y:Number(r.getAttribute('cy'))})),lines:[...group.querySelectorAll('polyline')].map(p=>p.getAttribute('points')),areas:group.querySelectorAll('polygon').length}))
  if(kind==='vertical-bar'){
   assert.equal(geometry.rects.length,3);assert.equal(geometry.circles.length,1)
   assert.equal(geometry.rects[0].y,30);assert.equal(geometry.rects[0].height,225)
   assert.equal(geometry.rects[1].y,255);assert.equal(geometry.rects[1].height,75)
   assert.equal(geometry.circles[0].y,255,'Zero has a visible marker on the baseline')
  }else{
   assert.equal(geometry.circles.length,4);assert.equal(geometry.lines.length,2,'A missing value interrupts the connected path')
   assert.equal(geometry.lines[0],'130,30')
   assert.equal(geometry.lines[1],kind==='stepped-line'?'370,330 490,330 490,255 610,255 610,217.5':'370,330 490,255 610,217.5')
   assert.equal(geometry.areas,kind==='area'?2:0)
  }
  await page.getByRole('region',{name:'Exact chart values',exact:true}).focus();await page.keyboard.press('ArrowRight')
  const menu=page.locator('.menu > summary'),tooltip=page.locator('#settings-menu-tooltip')
  await menu.hover();await tooltip.waitFor({state:'visible'});await page.mouse.move(0,0);await tooltip.waitFor({state:'hidden'});await menu.focus();assert.equal(await tooltip.isVisible(),true)
  assert.ok(await figure.locator('.plot-scroll').evaluate(element=>element.scrollWidth<=element.clientWidth),'The complete plot fits the phone and desktop viewport')
  await proveScreen('native-viewer-'+kind+'-'+width,{widths:[width],resize:false})
  await page.getByLabel('Chart selection',{exact:true}).selectOption({label:'3 Refunds'})
  await page.getByRole('button',{name:'Apply selection',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForURL(url=>url.searchParams.has('selection'))
  assert.deepEqual(await table.locator('tbody td').allTextContents(),['-$4.00']);assert.equal(await table.locator('tfoot td').innerText(),'$10.00')
  await page.reload();assert.equal(await table.locator('tbody tr').count(),1,'Reopening preserves the displayed selection')
  await proveScreen('native-selected-'+kind+'-'+width,{widths:[width],resize:false})
  const endpoint='/charts/'+id+'/snapshot'
  for(const format of ['png','pdf']){
   const input={format},review=await call(endpoint+'/review',input)
   assert.deepEqual(review.provenance.view.rows.map(row=>[row.label,row.values.amount.value]),expected)
   const shapes=review.pages.flatMap(page=>page.shapes),text=shapes.filter(shape=>shape.kind==='text').flatMap(shape=>shape.lines).join('\n')
   for(const value of ['1 Sales','2 Unreported','3 Refunds','4 No sales','5 Support','12.00','-4.00','0.00','2.00','10.00','NULL'])assert.ok(text.includes(value),'Export label or exact value missing: '+value)
   assert.ok(shapes.every(shape=>shape.x>=0&&shape.y>=0&&shape.x+shape.w<=1280&&shape.y+shape.h<=900),'No export shape leaves its page')
   const data={...input,exportedAt:review.exportedAt,reviewedDigest:review.digest},download=await post(endpoint+'/download',data)
   assert.equal(download.status(),200,await download.text());const bytes=await download.body()
   assert.equal(download.headers()['cache-control'],'no-store')
   if(format==='png'){assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),1280);assert.ok(bytes.readUInt32BE(20)>=900)}
   else{const pdf=bytes.toString('latin1').replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));assert.ok(pdf.startsWith('%PDF-1.7'));assert.match(pdf,/3 Refunds/);assert.match(pdf,/-4.00/);assert.match(pdf,/\/StructTreeRoot/)}
   if(width===1440&&process.env.BIFOCAL_PROOF_DIR)await writeFile(join(process.env.BIFOCAL_PROOF_DIR,'native-'+kind+'.'+format),bytes)
   assert.equal((await post(endpoint+'/download',{...data,selection:{field:'segment',value:'3 Refunds'}})).status(),409,'Changed selection refuses the previous exact review')
   reviews.push({endpoint,data})
  }
  await page.getByLabel('Snapshot format',{exact:true}).selectOption(width===1440?'png':'pdf')
  await page.getByRole('button',{name:'Review chart snapshot',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-chart-snapshot-download]').disabled)
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download reviewed chart snapshot',exact:true}).click();assert.match((await download).suggestedFilename(),width===1440?/\.png$/:/\.pdf$/)
  await page.goto(origin+'/app/charts/'+id);assert.equal(await table.locator('tbody tr').count(),5,'The retained chart reopens with its full answer')
 }
 const base={version:1,title:'Order and empty cases',definition,visual:{kind:'line',dimension:'segment',measure:'amount',order:{field:'amount',direction:'descending',nulls:'last'},missing:'gap',scale:{zero:false,reverse:false},selection:{field:'segment',label:'Chart selection'}}}
 const ordered=await call('/chart-definitions/review',{document:base})
 assert.deepEqual(ordered.view.rows.map(row=>row.label),['1 Sales','5 Support','4 No sales','3 Refunds','2 Unreported'],'Numeric ordering uses exact signed values with explicit null placement')
 for(const visual of [{...base.visual,dimension:'id'},{...base.visual,measure:'hiddenPayroll'},{...base.visual,order:{...base.visual.order,field:'hiddenPayroll'}},{...base.visual,missing:'connect'},{...base.visual,kind:'area'}])assert.equal((await post('/chart-definitions/review',{document:{...base,visual}})).status(),400)
 const emptyDefinition={...definition,filters:[{column:'segment',op:'eq',value:'Absent'}]}
 const emptyAnswer=await call('/queries/run',emptyDefinition)
 for(const kind of ['vertical-bar','line','stepped-line','area']){
  const document={...base,definition:emptyDefinition,visual:{...base.visual,kind,scale:{zero:true,reverse:false}}},review=await call('/chart-definitions/review',{document}),chart=await call('/chart-definitions/create',{document,reviewedDigest:review.digest})
  charts.push(chart);assert.deepEqual(chart.view.rows,[]);assert.equal(chart.answer.totals.amount.value,null)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/charts/'+chart.id);await page.getByRole('status').filter({hasText:'No matching groups.'}).waitFor();assert.equal(await page.locator('.series-marks').count(),0);assert.equal(await page.getByRole('table').locator('tbody tr').count(),0);await proveScreen('native-empty-'+kind+'-'+width,{widths:[width],resize:false})}
  for(const format of ['png','pdf']){const exported=await call('/charts/'+chart.id+'/snapshot/review',{format});assert.deepEqual(exported.provenance.view.rows,[]);assert.ok(exported.pages.flatMap(page=>page.shapes).some(shape=>shape.kind==='text'&&shape.lines.join(' ').includes('No result groups')))}
 }
 await page.goto(origin+'/app/charts/new?query='+answer.queryId)
 await page.getByRole('status').filter({hasText:'Choose chart settings'}).waitFor()
 await page.getByRole('button',{name:'Review current chart',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Current exact values reviewed'}).waitFor()
 const stale=await call('/chart-definitions/review',{document:base}),before=await call('/queries')
 await upload(dataset,csv.replace('$12.00','$13.00'),true)
 assert.equal((await post('/chart-definitions/create',{document:base,reviewedDigest:stale.digest})).status(),409)
 await page.getByRole('button',{name:'Create reviewed chart',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'Review the current chart again'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Create reviewed chart',exact:true}).isDisabled(),true)
 await proveScreen('native-builder-source-changed')
 assert.deepEqual(await call('/queries'),before,'Stale chart review creates neither answer nor chart')
 for(const {endpoint,data} of reviews)assert.equal((await post(endpoint+'/download',data)).status(),409,'A source change requires fresh snapshot review')
 assert.deepEqual((await call('/queries/'+answer.queryId)).answer,answer.answer,'The historical answer remains byte-equivalent after source changes')
 assert.deepEqual((await call('/charts/'+charts[0].id)).answer,answer.answer,'Source changes do not rewrite retained chart answers')
 const freshHistorical=await call('/charts/'+charts[0].id+'/snapshot/review',{format:'pdf'});assert.deepEqual(freshHistorical.provenance.view.rows.map(row=>[row.label,row.values.amount.value]),expected,'Fresh historical export review retains original values')
 const source=await call('/datasets/'+dataset);await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision})
 for(const chart of charts){assert.equal((await context.request.get(origin+'/api/operator/charts/'+chart.id)).status(),404);for(const action of ['review','download'])assert.equal((await post('/charts/'+chart.id+'/snapshot/'+action,{format:'png',exportedAt:new Date().toISOString(),reviewedDigest:'erased'})).status(),404)}
 assert.equal((await context.request.get(origin+'/api/operator/queries/'+emptyAnswer.queryId)).status(),404)
 for(const {endpoint,data} of reviews)assert.equal((await post(endpoint+'/download',data)).status(),404,'Erasure withdraws previously reviewed static files')
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/charts/'+charts[0].id);await page.getByRole('alert').filter({hasText:'This chart isn’t available'}).waitFor();await proveScreen('native-chart-withdrawn-'+width,{widths:[width],resize:false})}
 console.log('Native four chart builder: desktop and phone creation, signed exact USD, explicit order, gaps, empty states, keyboard, selection, protected PNG and PDF, source drift and erasure passed')
}
