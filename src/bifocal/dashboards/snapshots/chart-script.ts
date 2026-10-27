export const chartSnapshotScript=String.raw`
for(const panel of document.querySelectorAll('[data-chart-snapshot]')){
 const format=panel.querySelector('[name="chart-snapshot-format"]'),reviewButton=panel.querySelector('[data-chart-snapshot-review]'),downloadButton=panel.querySelector('[data-chart-snapshot-download]'),status=panel.querySelector('[data-chart-snapshot-status]');let reviewed
 const selection=panel.dataset.chartSelection?JSON.parse(panel.dataset.chartSelection):undefined
 const input=()=>({format:format.value,...selection?{selection}:{}})
 const post=async(action,data)=>{const response=await fetch('/api/operator/charts/'+panel.dataset.chartSnapshot+'/snapshot/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!response.ok){const value=await response.json();throw Error(value.error||'Snapshot unavailable')}return response}
 format.addEventListener('change',()=>{reviewed=undefined;downloadButton.disabled=true;status.textContent='Review the selected format.'})
 reviewButton.addEventListener('click',async()=>{reviewButton.disabled=true;downloadButton.disabled=true;reviewed=undefined;try{reviewed=await(await post('review',input())).json();status.textContent='Reviewed '+reviewed.pages.length+' pages with the displayed chart selection. Snapshot dated '+reviewed.exportedAt;downloadButton.disabled=false}catch(error){status.textContent=error.message}finally{reviewButton.disabled=false}})
 downloadButton.addEventListener('click',async()=>{if(!reviewed)return;downloadButton.disabled=true;try{const response=await post('download',{...input(),exportedAt:reviewed.exportedAt,reviewedDigest:reviewed.digest}),blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='bifocal-chart.'+format.value;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Reviewed chart snapshot downloaded.'}catch(error){reviewed=undefined;status.textContent=error.message}finally{downloadButton.disabled=!reviewed}})
}
`
