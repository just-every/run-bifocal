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
 // A native integration credential cannot bypass the company policy the harness
 // installed. Issue through the same exact human door, without changing grants.
 const bound=state.credentials.find(row=>row.id===answer.citations.credentialId)
 assert.ok(bound)
 const {sources:_sources,...scope}=JSON.parse(bound.definition_json)
 const human=async(path,data)=>{
  const response=await request(origin+'/api/operator/credentials'+path,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application'+'/json'},body:JSON.stringify(data)})
  assert.ok(response.ok,'Native integration review succeeds');return response.json()
 }
 const review=await human('/review',scope),credential=await human('',{...scope,reviewedDigest:review.digest})
 const read=async(path,data)=>{
  const response=await request(origin+'/api/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+credential.token,Origin:origin,'Content-Type':'application'+'/json'},body:JSON.stringify(data)})
  assert.equal(response.status,200)
  const decision=JSON.parse(response.headers.get('X-Bifocal-Agent-Decision'))
  assert.equal(decision.disposition,'autonomous');assert.equal(decision.revision,(await tool('bifocal.analytics.status',{})).result._meta['com.runeditrun/decision'].revision)
  assert.deepEqual(decision.classes.map(({class:kind,facts})=>({class:kind,facts})),[{class:'sensitive',facts:{measure:1,kind:'reviewed-analytical-answer'}}])
  return response.json()
 }
 const rest=await read('query',args)
 const gql=await read('graphql',{query:'query($input: QueryInput!) { query(input:$input) { rows totals totalRows offset nextOffset citations query } }',variables:{input:args}})
 assert.deepEqual(gql.data.query,rest)
 assert.deepEqual(rest.rows,answer.rows);assert.deepEqual(rest.totals,answer.totals)
 assert.equal(rest.totals.revenue.value,'9.98');assert.equal(rest.totalRows,1)
 const after=await request(origin+'/api/operator/credentials',{headers:{Cookie:cookie}})
 assert.equal((await after.json()).credentials.find(row=>row.id===credential.id).used_operations,2,'No duplicated native execution during transport adaptation')
 console.log('Bifocal agent journey: exact USD 9.98 West answer, intersected East refusal, hidden field refusal and native agent/sponsor attribution passed.')
}
