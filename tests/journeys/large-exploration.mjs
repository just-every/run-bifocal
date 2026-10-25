import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {unzipSync,strFromU8} from 'fflate'
import {DOMParser} from '@xmldom/xmldom'

/** Committed scale journey; run outside push verification on the exact candidate. */
export async function proveLargeExploration({origin,context,page,call,proveScreen}){
 const count=150001,dataset='synthetic-bifocal-large-invoices',csv='invoice\n'+Array.from({length:count},(_,i)=>String(i+1)).join('\n')+'\n'
 const bytes=Buffer.from(JSON.stringify({version:1,datasetId:dataset,filename:'synthetic-bifocal-large.csv',encoding:'utf-8',delimiter:',',nullValue:'',mode:'replace',key:null,formulaTreatment:'literal-text',data:csv,originalBase64:Buffer.from(csv).toString('base64')})),digest=createHash('sha256').update(bytes).digest('hex'),headers={Origin:origin,'X-Import-Dataset':dataset}
 const post=async(action,data)=>{const response=await context.request.post(origin+'/api/operator/import/'+action,{headers,data});assert.equal(response.status(),200,await response.text());return response.json()}
 let uploadId
 const chunkBytes=65536,totalChunks=Math.ceil(bytes.length/chunkBytes)
 for(let index=0;index<totalChunks;index++){
  const chunk=bytes.subarray(index*chunkBytes,(index+1)*chunkBytes),response=await post('uploads',{...uploadId?{uploadId}:{},name:'synthetic-bifocal-large.json',bundleSha256:digest,totalBytes:bytes.length,totalChunks,index,chunkSha256:createHash('sha256').update(chunk).digest('hex'),base64:chunk.toString('base64')});uploadId=response.uploadId
 }
 const plan=await post('plan',{uploadId});assert.equal(plan.counts.rejected,0,JSON.stringify(plan.rejected));assert.equal(plan.counts.mapped,1)
 let completed=false
 for(let i=0;i<20;i++){const result=await post('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint});if(result.job.state==='completed'){completed=true;break}}
 assert.ok(completed,'Reviewed large source commits completely')
 const reconciled=await post('reconcile',{planId:plan.planId});assert.equal(reconciled.ok,true)
 const source=await call('/datasets/'+dataset);assert.equal(source.table.rows.length,count);assert.equal(source.table.rows.at(-1)[0],String(count))
 await page.goto(origin+'/app/import');await page.getByLabel('Dataset id',{exact:true}).fill(dataset);await page.getByRole('button',{name:'Load dataset',exact:true}).click();await page.getByRole('table',{name:'Current rows (first 20)',exact:true}).waitFor();await proveScreen('large-source-import-bounds')
 const query={version:1,dataset,joins:[],filters:[],groupBy:[],measures:[{id:'rows',op:'count',unit:'count',scale:0},{id:'invoice-sum',op:'sum',column:'invoice',unit:'number',scale:0}],context:{modelVersion:'large-native',metricVersion:'large-native',accountingBasis:'not-applicable',calendar:{id:'synthetic-bifocal-july',version:1},rounding:'half-even'},semantic:{grain:['invoice'],dimensions:[{column:'invoice',type:'number'}],hierarchies:[],slowlyChanging:'reject-duplicate-grain'}}
 const model=await call('/models',{definition:{views:[{id:'invoices',kind:'chart',query,rowRules:[]}],quality:[{view:'invoices',measure:'rows',expected:String(count)}]}}),branch='/models/'+model.modelId+'/branches/'+model.branchId
 const review=await call(branch+'/validate',{},200);assert.equal(review.compatible,true);await call(branch+'/approve',{digest:review.digest},200);await call(branch+'/promote',{environment:'staging',digest:review.digest},200);await call(branch+'/promote',{environment:'production',digest:review.digest},200)
 const parameters={modelId:model.modelId,revision:model.revision,viewId:'invoices',groupBy:[],filters:[]},question=await call('/explore/run',parameters)
 assert.equal(question.answer.totals.rows.value,String(count));assert.equal(question.answer.totals['invoice-sum'].value,String(count*(count+1)/2))
 const limited=await call('/explore/run',{...parameters,filters:[{column:'invoice',op:'lte',value:'30001'}]})
 assert.equal(limited.answer.filteredRows,30001)
 const base=origin+'/api/operator/explore/'+limited.snapshotId,refusal=await context.request.post(base+'/export',{headers:{Origin:origin},data:{scope:'underlying',format:'csv'}});assert.equal(refusal.status(),413)
 const csvPlan=(await refusal.json()).fullExport;assert.equal(csvPlan.totalRows,30001);assert.equal(csvPlan.interactiveCap,30000)
 let offset=0,csvRows=0,csvSum=0;const csvIds=new Set()
 do{
  const part=await context.request.post(base+'/full-export',{headers:{Origin:origin},data:{scope:'underlying',format:'csv',offset,planDigest:csvPlan.planDigest}});assert.equal(part.status(),200,await part.text())
  const records=(await part.text()).trimEnd().split('\r\n');assert.equal(records.shift(),'"invoice"')
  for(const row of records){const id=Number(row.slice(1,-1));assert.ok(!csvIds.has(id));csvIds.add(id);csvRows++;csvSum+=id}
  const next=part.headers()['x-bifocal-next-offset'];offset=next===''?null:Number(next)
 }while(offset!==null)
 assert.equal(csvRows,30001);assert.equal(csvSum,30001*30002/2);assert.equal(Math.min(...csvIds),1);assert.equal(Math.max(...csvIds),30001)
 await page.goto(origin+'/app/questions/'+question.snapshotId);await page.getByRole('status').filter({hasText:'Saved question reopened'}).waitFor();await page.getByRole('button',{name:'Underlying rows',exact:true}).click();await page.getByRole('status').filter({hasText:'Question scope changed'}).waitFor()
 await page.getByText('Export this question',{exact:true}).click();const xlsxRefusal=page.waitForResponse(response=>response.url().endsWith('/export')&&response.status()===413);await page.getByRole('button',{name:'Export XLSX',exact:true}).click();const xlsxPlan=(await (await xlsxRefusal).json()).fullExport;assert.equal(xlsxPlan.totalRows,count);assert.equal(xlsxPlan.interactiveCap,150000);await page.getByRole('status').filter({hasText:'exceeds the interactive file limit'}).waitFor();assert.match(await page.locator('#full-export-note').innerText(),/150001/)
 await proveScreen('large-export-explicit-parts')
 let xlsxRows=0,xlsxSum=0,parts=0;const xlsxIds=new Set()
 while(!await page.getByRole('button',{name:'Download next export part',exact:true}).isDisabled()){
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download next export part',exact:true}).click();const download=await downloaded
  assert.match(download.suggestedFilename(),/^bifocal-underlying-part-\d+\.xlsx$/)
  const archive=unzipSync(await readFile(await download.path())),xml=strFromU8(archive['xl/worksheets/sheet1.xml']),document=new DOMParser().parseFromString(xml,'application/xml'),rows=[...document.getElementsByTagName('row')]
  assert.equal(rows.shift().getElementsByTagName('t')[0].textContent,'invoice')
  for(const row of rows){const cell=row.getElementsByTagName('c')[0];assert.equal(cell.getAttribute('t'),'n');const id=Number(cell.getElementsByTagName('v')[0].textContent);assert.ok(!xlsxIds.has(id),'No export part duplicates an invoice');xlsxIds.add(id);xlsxRows++;xlsxSum+=id}
  parts++;await page.getByRole('status').filter({hasText:parts===xlsxPlan.parts?'Complete export: every part downloaded.':'Export part downloaded.'}).waitFor()
 }
 assert.equal(xlsxRows,count);assert.equal(xlsxIds.size,count);assert.equal(xlsxSum,count*(count+1)/2);assert.equal(parts,xlsxPlan.parts);assert.ok(xlsxIds.has(1)&&xlsxIds.has(count))
 assert.match(await page.locator('#full-export-note').innerText(),/150001 of 150001/);await proveScreen('large-export-all-parts-complete')
 const paged=await call('/explore/'+question.snapshotId+'/page',{scope:'underlying',offset:150000},200);assert.equal(paged.totalRows,count);assert.deepEqual(paged.rows,[[String(count)]]);assert.equal(paged.nextOffset,null)
 assert.equal((await fetch(origin+'/api/operator/explore/'+question.snapshotId+'/full-export',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({scope:'underlying',format:'xlsx',offset:0,planDigest:'synthetic-bifocal-denied'})})).status,401)
 const beforeErase=await context.request.post(origin+'/api/operator/explore/'+question.snapshotId+'/export-plan',{headers:{Origin:origin},data:{scope:'underlying',format:'xlsx'}}),savedPlan=await beforeErase.json()
 await call('/datasets/'+dataset+'/erase',{confirmDataset:dataset,reviewedRevision:source.revision},200)
 assert.equal((await context.request.post(origin+'/api/operator/explore/'+question.snapshotId+'/full-export',{headers:{Origin:origin},data:{scope:'underlying',format:'xlsx',offset:0,planDigest:savedPlan.planDigest}})).status(),404)
 console.log(JSON.stringify({journey:'large-exploration',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceRows:count,csvRows,xlsxRows,xlsxParts:parts,invoiceSum:xlsxSum,importEnvelopeBytes:bytes.length,proof:'real reviewed CSV, native model, exact scopes, browser XLSX parts, complete CSV, final page and erasure refusal'}))
}
