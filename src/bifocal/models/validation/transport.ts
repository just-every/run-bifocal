import { fail } from '../../query/types'
export const privateHeaders={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}
export const json=(body:unknown,status=200)=>Response.json(body,{status,headers:privateHeaders})
export async function jsonBody(request:Request):Promise<Record<string,unknown>> {
 if(!request.headers.get('content-type')?.startsWith('application/json') || !request.body)fail('json_body_required',400)
 const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text=''
 try {
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)fail('request_too_large',413);text+=decoder.decode(part.value,{stream:true})}
  text+=decoder.decode();let data:unknown
  try{data=JSON.parse(text)}catch{fail('invalid_json',400)}
  if(!data || typeof data!=='object' || Array.isArray(data))fail('json_object_required',400)
  return data as Record<string,unknown>
 }finally{await reader.cancel();reader.releaseLock()}
}
export function exactKeys(input:Record<string,unknown>,keys:string[]) {if(Object.keys(input).some(key=>!keys.includes(key)))fail('unsupported_input',400)}

export async function discardBody(request:Request):Promise<void>{
 if(!request.body)return
 const reader=request.body.getReader();let size=0
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader.cancel();break}}}catch{}finally{reader.releaseLock()}
}
