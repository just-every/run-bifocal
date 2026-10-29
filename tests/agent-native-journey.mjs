import assert from 'node:assert/strict'

/** The specialist's real job: exact reviewed West answer, never East data or
 * source instructions. Conformance owns credentials, policy and audit. */
export default async function ({tool,request,origin,cookie}) {
 const definitions=(await tool('bifocal.analytics.definitions',{})).result.structuredContent
 assert.deepEqual(definitions.dimensions,['region'])
 const args={modelId:definitions.modelId,revision:definitions.revision,viewId:definitions.viewId,groupBy:['region'],filters:[]}
 const answer=(await tool('bifocal.analytics.query',args)).result.structuredContent
 assert.equal(answer.totals.revenue.value,'9.98')
 assert.equal(answer.totalRows,1)
 assert.ok(!JSON.stringify(answer).includes('East'))
 assert.ok(!JSON.stringify(answer).includes('Ignore rules'))
 const narrowed=(await tool('bifocal.analytics.query',{...args,filters:[{column:'region',op:'eq',value:'East'}]})).result.structuredContent
 assert.equal(narrowed.totalRows,0)
 const forbidden=await tool('bifocal.analytics.query',{...args,groupBy:['note']})
 assert.equal(forbidden.result._meta['com.runeditrun/error'].code,'dimension_not_permitted')
 assert.equal(forbidden.result.structuredContent,undefined)
 const audit=await request(origin+'/api/operator/credentials',{headers:{Cookie:cookie}})
 assert.equal(audit.status,200)
 const state=await audit.json()
 assert.ok(state.history.some(row=>row.agent_id && row.agent_name && row.sponsor_name && row.action==='query'))
 console.log('Bifocal agent journey: exact USD 9.98 West answer, intersected East refusal, hidden field refusal and native agent/sponsor attribution passed.')
}
