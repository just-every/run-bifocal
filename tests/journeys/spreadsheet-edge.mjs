import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

/** Real emitted Worker and existing migrated D1. Only provider HTTPS is fake. */
export async function proveSpreadsheetEdges(origin, context, persist) {
 const require = createRequire(import.meta.url), wrangler = createRequire(require.resolve('wrangler'))
 const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
 const modules=[{type:'ESModule',path:resolve('dist/server/index.js')},...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>({type:'ESModule',path:resolve('dist/server/assets',name)}))]
 let phase = 'success', calls = 0
 const data = [['id','date','amount','region'],['1','01/15/2026','$1234.56','West'],['2','01/16/2026','-$25.50','East']]
 const mf = new Miniflare(convertV4MiniflareOptions({ port:0, inspectorPort:0, cf:false, upstream:origin, modulesRoot:resolve('dist/server'),modules, compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'], d1Databases:{DB:'local-foundation-only'},resourcePersistencePath:join(persist,'v3'), bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),MAIL_FROM:'synthetic-bifocal-2@example.test'},outboundService: async request => {
  calls++; const url = new URL(request.url)
  assert.equal(url.protocol,'https:'); assert.equal(request.method,'GET');assert.ok(!request.headers.has('cookie'),'native cookies cannot leave the app')
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-40')
  assert.ok(['sheets.googleapis.com','graph.microsoft.com'].includes(url.hostname))
  if(phase==='revoked')return Response.json({error:'synthetic-bifocal-41'},{status:403})
  if(phase==='redirect')return new Response(null,{status:302,headers:{location:'http://internal.example.test/'}})
  if(phase==='oversize')return new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})
  if(url.hostname==='sheets.googleapis.com') {
   assert.equal(url.pathname,'/v4/spreadsheets/synthetic-bifocal-42');assert.equal(url.searchParams.get('ranges'),"'Sales'!A1:D3")
   return Response.json({spreadsheetId:'synthetic-bifocal-42',sheets:[{properties:{title:'Sales'},data:[{rowData:data.map((row,r)=>({values:row.map((text,c)=>({formattedValue:text,effectiveValue:{stringValue:text},...(r===1&&c===2?{userEnteredValue:{formulaValue:'=IMPORTXML("http://internal.example.test/")'}}:{})}))}))}]}]})
  }
  assert.match(url.pathname,/\/v1\.0\/me\/drive\/items\/synthetic-bifocal-42\/workbook\/worksheets\/Sales\/range/)
  return Response.json({address:'Sales!A1:D3',rowCount:3,columnCount:4,rowIndex:0,columnIndex:0,text:data,formulas:data.map((row,r)=>row.map((text,c)=>r===1&&c===2?'=IMPORTXML("http://internal.example.test/")':text)),valueTypes:data.map(row=>row.map(()=> 'String'))})
 }}))
 try {
  const cookie=(await context.cookies()).map(item=>`${item.name}=${item.value}`).join('; ')
  const session=await mf.dispatchFetch(origin+'/auth/session',{headers:{Host:new URL(origin).host,Cookie:cookie}});assert.equal(session.status,200,await session.text())
  const call = async (path,body,dataset,status=200,extra={}) => {
   const response=await mf.dispatchFetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Host:new URL(origin).host,Cookie:cookie,Origin:origin,'X-Import-Dataset':dataset,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})})
   const text=await response.text();assert.equal(response.status,status,`${text} (provider calls: ${calls})`);assert.ok(!text.includes('synthetic-bifocal-40'));return JSON.parse(text)
  }
  for(const provider of ['google','microsoft']) {
   phase='success';const dataset=`synthetic-bifocal-range-${provider}`
   const input={provider,workbook:'synthetic-bifocal-42',sheet:'Sales',range:'A1:D3',datasetId:dataset,mode:'replace',key:'id',nullValue:'',formulaTreatment:'cached-values-preserve-formulas',confirmRead:true,accessToken:'synthetic-bifocal-40'}
   const before=calls
   const beforeAudit=(await call('/api/operator/spreadsheets/reads',undefined,dataset)).events.length
   await call('/api/operator/spreadsheets/preview',{...input,workbook:'https://internal.example.test'},dataset,400)
   await call('/api/operator/spreadsheets/preview',{...input,confirmRead:false},dataset,400)
   await call('/api/operator/spreadsheets/preview',input,dataset,401,{Origin:'https://foreign.example.test'})
   assert.equal(calls,before)
   assert.equal((await call('/api/operator/spreadsheets/reads',undefined,dataset)).events.length,beforeAudit,'denied or unconsented requests create no consent')
   const plan=await call('/api/operator/spreadsheets/preview',input,dataset)
   const consent=(await call('/api/operator/spreadsheets/reads',undefined,dataset)).events.filter(event=>event.dataset===dataset)
   assert.deepEqual(consent.map(event=>event.event).sort(),['consented','staged']);assert.ok(consent.every(event=>event.owner==='synthetic-bifocal-1@example.test'&&event.provider===provider))
   assert.ok(!JSON.stringify(consent).includes('IMPORTXML'));assert.ok(!JSON.stringify(consent).includes('synthetic-bifocal-42'))
   assert.equal(plan.counts.rejected,0);assert.equal(plan.preview.source.spreadsheet.provider,provider)
   assert.equal(plan.preview.sample[0][2],'1234.56');assert.equal(plan.preview.source.formulas[0].formula,'=IMPORTXML("http://internal.example.test/")')
   const job=await call('/api/operator/import/apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},dataset)
   assert.equal(job.job.state,'completed')
   const baseline=await call(`/api/operator/datasets/${dataset}`,undefined,dataset)
   assert.equal((await call('/api/operator/import/reconcile',{planId:plan.planId},dataset)).ok,true)
   assert.equal(calls,before+1,'formula text and imported cells cannot initiate another outbound request')
   const original=await call('/api/operator/import/original/'+plan.planId,undefined,dataset)
   const envelope=JSON.parse(Buffer.from(original.originals[0].original.base64,'base64'))
   assert.equal(envelope.spreadsheet.range,'A1:D3');assert.ok(!JSON.stringify(envelope).includes(input.accessToken))
   phase='revoked';const revoked=await call('/api/operator/spreadsheets/preview',{...input,catchup:true},dataset,403)
   assert.equal(revoked.error,'spreadsheet_grant_revoked');assert.ok((await call('/api/operator/spreadsheets/reads',undefined,dataset)).events.some(event=>event.dataset===dataset&&event.event==='failed'));assert.deepEqual(await call(`/api/operator/datasets/${dataset}`,undefined,dataset),baseline)
   phase='redirect';const redirectCalls=calls;assert.equal((await call('/api/operator/spreadsheets/preview',{...input,catchup:true},dataset,502)).error,'spreadsheet_redirect_refused');assert.equal(calls,redirectCalls+1)
   phase='oversize';assert.equal((await call('/api/operator/spreadsheets/preview',{...input,catchup:true},dataset,413)).error,'spreadsheet_response_limit')
   const undone=await call('/api/operator/import/undo',{planId:plan.planId},dataset);assert.equal(undone.job.state,'undone')
   await call(`/api/operator/datasets/${dataset}`,undefined,dataset,404)
  }
  console.log('Spreadsheet schema edges: both providers through real Worker review/apply/reconcile/Undo, grant refusal preserving current data, redirect/size/authority refusal and credential exclusion passed (not live provider proof)')
 } finally { await mf.dispose() }
}
