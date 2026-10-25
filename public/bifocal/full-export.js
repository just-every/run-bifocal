const $=id=>document.getElementById(id)
export function fullExportController(action,status){
 let plan,offset=0,downloaded=0
 const reset=()=>{plan=null;offset=0;downloaded=0;$('full-export').hidden=true}
 const note=()=>{$('full-export-note').textContent=downloaded+' of '+plan.totalRows+' rows downloaded. This complete export has '+plan.parts+' named parts, each with a header and up to '+plan.partRows+' rows. '+(offset===null?'Every part has been offered for download.':'Download the next part to continue.');$('full-export-next').disabled=offset===null}
 $('full-export-next').onclick=()=>action(async()=>{
  if(!plan||offset===null)return
  const response=await fetch('/api/operator/explore/'+plan.snapshotId+'/full-export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:plan.scope,format:plan.format,offset,planDigest:plan.planDigest,...plan.layout==='pivot'?{layout:'pivot'}:{}})})
  if(!response.ok){const body=await response.json();throw Error(String(body.error).replaceAll('_',' ')+'. Prepare a fresh complete export after reviewing current limits and permissions.')}
  const count=Number(response.headers.get('x-bifocal-row-count')),next=response.headers.get('x-bifocal-next-offset'),part=Math.floor(offset/plan.partRows)+1,url=URL.createObjectURL(await response.blob()),link=document.createElement('a')
  link.href=url;link.download='bifocal-'+plan.scope+'-part-'+part+'.'+plan.format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  downloaded+=count;offset=next===''?null:Number(next);note();status(offset===null?'Complete export: every part downloaded.':'Export part downloaded. Continue with the next named part.')
 })
 return {reset,offer:value=>{plan=value;offset=0;downloaded=0;$('full-export').hidden=false;note()}}
}
