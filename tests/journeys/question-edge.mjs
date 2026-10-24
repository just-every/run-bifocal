import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
export function fixturePlan(fixture){
 const expected=fixture.expected,date=expected.date,comparison=expected.comparison
 const period=date?{kind:'range',column:'date',asOf:fixture.asOf,from:date.from,to:date.to}:{kind:'all',column:'',asOf:'',from:'',to:''}
 return {decision:expected.decision,message:expected.decision==='answer'?'Run the permitted native query.':expected.decision==='clarify'?'Choose whether sales means revenue or units.':'The requested field or operation is not permitted.',missing:expected.decision==='answer'?[]:[expected.missingField??(expected.decision==='clarify'?'metric definition':'permission')],intent:expected.why?'why':'query',measureIds:expected.measureIds,groupBy:expected.groupBy,filters:expected.filters.map(f=>({...f,values:[]})),period,comparison:comparison?{kind:'range',column:'date',asOf:fixture.asOf,from:comparison.from,to:comparison.to}:null,drivers:expected.why?['region','product','channel','customer']:[],priceVolume:null}
}
export async function questionEdge({live=false,model='gpt-6.1-sol',fixtures=[]}={}){
 if(live&&!process.env.C21_LIVE_AI_KEY)throw Error('Live question qualification requires an explicitly injected key')
 const key='synthetic-bifocal-'+randomUUID(),requests=[],plans=new Map(fixtures.map(f=>[f.question,fixturePlan(f)]));let next=null
 const server=createServer(async(request,response)=>{
  try{
   if(request.headers.authorization!=='Bearer '+key){response.writeHead(401);response.end();return}
   const chunks=[];let length=0;for await(const chunk of request){length+=chunk.length;if(length>131072)throw Error('edge request too large');chunks.push(chunk)}
   const input=JSON.parse(Buffer.concat(chunks).toString()),outbound=JSON.parse(input.input.find(m=>m.role==='user').content[0].text);requests.push({body:input,outbound})
   if(live){const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.C21_LIVE_AI_KEY,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(35000)});response.writeHead(upstream.status,{'content-type':'application/json'});response.end(Buffer.from(await upstream.arrayBuffer()));return}
   const plan=next??plans.get(outbound.question);next=null
   if(!plan)throw Error('No test-edge source response was explicitly supplied')
   const raw={id:'synthetic-bifocal-'+randomUUID(),model,status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(plan)}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}}
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(raw))
  }catch{response.writeHead(502,{'content-type':'application/json'});response.end(JSON.stringify({error:'synthetic-bifocal-provider-edge-error'}))}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {origin:'http://127.0.0.1:'+server.address().port,key,requests,plans,setNext(plan){next=plan},close:()=>new Promise(resolve=>server.close(resolve))}
}
