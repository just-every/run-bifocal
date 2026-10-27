import assert from 'node:assert/strict'
// Wire fixtures follow the official schemas cited in docs/WEB-SOURCES.md.
export const webRows=[
 {id:'1',amount:'12.30',active:true,day:'2026-06-01',note:''},
 {id:'2',amount:'-2.05',active:false,day:'2026-06-02',note:null},
 {id:'3',amount:'0.00',active:true,day:'2026-06-03',note:'<img src=x onerror=alert(1)>'}
]
export async function webEdgeResponse(request,state,origin) {
 const url=new URL(request.url),phase=state.webPhase??'success'
 assert.equal(url.origin,origin);assert.equal(request.method,'GET')
 assert.equal(request.headers.get('authorization'),'Bearer synthetic-bifocal-60')
 assert.equal(request.headers.has('cookie'),false)
 const second=url.searchParams.has('after') || Number(url.searchParams.get('page'))>1 || Number(url.searchParams.get('offset'))>0
 if(second && phase==='rate')return new Response(null,{status:429,headers:{'retry-after':'120'}})
 if(second && phase==='expired')return new Response(null,{status:401,headers:{'www-authenticate':'Bearer error="invalid_token"'}})
 if(phase==='redirect')return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})
 if(phase==='oversize')return Response.json({items:[{note:'x'.repeat(524289)}]})
 if(phase==='empty')return Response.json({items:[],next:null})
 if(phase==='schema' && second)return Response.json({items:[{id:'3'}],next:null})
 if(url.pathname==='/xml')return new Response(phase==='active-xml'?'<!DOCTYPE feed [<!ENTITY x SYSTEM "https://private.example/secret">]><feed><row><id>&x;</id></row></feed>':'<feed xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><row><id>1</id><amount>12.30</amount><active>true</active><day>2026-06-01</day><note></note></row><row><id>2</id><amount>-2.05</amount><active>false</active><day>2026-06-02</day><note xsi:nil="true"/></row></feed>',{headers:{'content-type':'application/xml'}})
 if(url.pathname==='/odata')return Response.json(second?{value:[webRows[2]],'@odata.deltaLink':origin+'/odata?$deltatoken=opaque'}:{'@odata.context':origin+'/$metadata#Items',value:webRows.slice(0,2),'@odata.nextLink':origin+'/odata?after=opaque'})
 if(url.pathname==='/rest')return Response.json(second?[webRows[2]]:webRows.slice(0,2),{headers:second?{}:{link:'<'+origin+'/rest?after=opaque>; rel="next", <'+origin+'/rest?before=opaque>; rel="prev"'}})
 if(url.pathname==='/paging') {
  assert.equal(url.searchParams.get('limit'),'2')
  const offset=url.searchParams.has('offset')?Number(url.searchParams.get('offset')):(Number(url.searchParams.get('page'))-1)*2
  return Response.json({items:webRows.slice(offset,offset+2)})
 }
 if(url.pathname==='/cursor')return Response.json({items:second?[webRows[2]]:webRows.slice(0,2),next:second?null:'opaque'})
 let next=second?null:origin+'/nested?after=opaque'
 if(phase==='private-next')next='https://127.0.0.1/private'
 if(phase==='foreign-next')next='https://synthetic-bifocal-foreign.workers.dev/items'
 if(phase==='repeated')next=origin+'/nested'
 if(phase==='endless'){await new Promise(resolve=>setTimeout(resolve,120));next=origin+'/nested?after='+state.webCalls}
 return Response.json({data:{items:(second?[webRows[2]]:webRows.slice(0,2)).map(row=>({id:row.id,details:{...row}}))},next})
}
