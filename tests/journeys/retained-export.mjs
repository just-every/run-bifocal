import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

export async function retainedRows(response,format) {
 if(format==='csv')return JSON.parse(execFileSync('python3',['-c','import csv,io,json,sys; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read())))))'],{input:await response.text(),encoding:'utf8'}))
 const xml=strFromU8(unzipSync(new Uint8Array(await response.body()))['xl/worksheets/sheet1.xml']),document=new DOMParser().parseFromString(xml,'application/xml')
 assert.equal(document.getElementsByTagName('f').length,0)
 return Array.from(document.getElementsByTagName('row')).map((row,index)=>Array.from(row.getElementsByTagName('c')).map(cell=>{const value=cell.getElementsByTagName('v')[0];if(index&&value&&/^-?\d+(?:\.\d+)?$/.test(value.textContent))assert.equal(cell.getAttribute('t'),'n');return cell.getElementsByTagName('t')[0]?.textContent??value?.textContent??''}))
}
export async function proveRetainedExports({origin,context,snapshotId,summary,underlying,parts=false}) {
 const base=origin+'/api/operator/queries/'+snapshotId,headers={Origin:origin},post=(action,data)=>context.request.post(base+'/'+action,{headers,data})
 for(const scope of ['summary','underlying'])for(const format of ['csv','xlsx']) {
  const response=await post('export',{scope,format});assert.equal(response.status(),200,await response.text())
  const rows=await retainedRows(response,format),expected=scope==='summary'?summary:underlying
  assert.deepEqual(rows.slice(1),expected.map(row=>row.map(value=>value===null?'':String(value))))
  assert.equal(Number(response.headers()['x-bifocal-row-count']),expected.length)
 }
 assert.equal((await fetch(base+'/export',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({scope:'summary',format:'csv'})})).status,401)
 assert.equal((await context.request.post(base+'/export',{headers:{Origin:'https://foreign.example.test'},data:{scope:'summary',format:'csv'}})).status(),401)
 if(!parts)return
 const read=async()=>{const response=await context.request.get(origin+'/api/operator/explore/export-policy');assert.equal(response.status(),200);return response.json()}
 const original=await read(),save=async(csv,xlsx)=>{const current=await read(),response=await context.request.put(origin+'/api/operator/explore/export-policy',{headers,data:{previousRevision:current.revision,csv,xlsx}});assert.equal(response.status(),200);return response.json()}
 let stale
 try {
  await save(1,1)
  for(const scope of ['summary','underlying'])for(const format of ['csv','xlsx']) {
   const refused=await post('export',{scope,format});assert.equal(refused.status(),413)
   const plan=(await refused.json()).fullExport;stale=plan
   const review=await post('export-plan',{scope,format});assert.equal(review.status(),200);assert.deepEqual(await review.json(),plan)
   let offset=0;const rows=[]
   do {const response=await post('full-export',{scope,format,offset,planDigest:plan.planDigest});assert.equal(response.status(),200,await response.text());rows.push(...(await retainedRows(response,format)).slice(1));const next=response.headers()['x-bifocal-next-offset'];offset=next===''?null:Number(next)}while(offset!==null)
   assert.deepEqual(rows,(scope==='summary'?summary:underlying).map(row=>row.map(value=>value===null?'':String(value))))
  }
 }finally{await save(original.csv,original.xlsx)}
 assert.equal((await post('full-export',{scope:stale.scope,format:stale.format,offset:0,planDigest:stale.planDigest})).status(),409,'Every retained export part binds current limits')
}
