// The receipt describes the accepted run. Reopening a retained answer does not
// execute again or turn a dated source watermark into a freshness claim.
export function cacheNote(result) {
 const cache=result.cache
 if(!cache)return 'Retained answer; execution cache evidence unavailable.'
 const age=(cache.ageMs/1000).toFixed(3)
 return `Result cache ${cache.status} · age ${age} seconds at this run · cached ${cache.createdAt} · principal ${cache.principalId} version ${cache.principalVersion}. Sources: `+
  result.answer.sourceWatermarks.map(s=>`${s.dataset} revision ${s.revision}, published ${s.updatedAt}`).join('; ')+'.'
}
