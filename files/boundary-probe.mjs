import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {join} from 'node:path'
const require=createRequire(join(process.cwd(),'package.json'))
const wranglerRequire=createRequire(require.resolve('wrangler/package.json'))
const {build}=wranglerRequire('esbuild')
const result=await build({entryPoints:['src/bifocal/retention/policy.server.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'})
const {retentionPolicyResponse}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'))
const origin='https://bifocal.example.test'
const results=[]
for(const [method,suffix,authorization] of [['PUT','','Bearer synthetic-bifocal-1'],['GET','/history','Bearer synthetic-bifocal-1'],['PUT','','']]){
 let reads=0
 const env={AUTH_ORIGIN:origin,OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),DB:{prepare(){reads++;throw Error('native session storage unavailable')}}}
 const request=new Request(origin+'/api/operator/retention/synthetic-bifocal-legacy'+suffix,{method,headers:{Origin:origin,Authorization:authorization,cookie:'__Host-operator_session='+'s'.repeat(43),'content-type':'application/json'},...(method==='PUT'?{body:JSON.stringify({confirmDataset:'synthetic-bifocal-legacy',reviewedDatasetRevision:'synthetic-revision',previousRevision:null,legalHold:true,minimumRetainUntil:null})}:{})})
 const response=await retentionPolicyResponse(request,env)
 const body=await response.json()
 assert.equal(response.status,401)
 assert.deepEqual(body,{error:'owner_required'})
 assert.equal(reads,0)
 assert.equal(response.headers.get('cache-control'),'no-store')
 assert.equal(request.bodyUsed,method==='PUT')
 results.push({method,suffix,authorization:authorization?'bearer':'present-empty',status:response.status,nativeSessionReads:reads,bodyConsumed:request.bodyUsed})
}
// A human request must still use native session authentication. Its storage
// failure must propagate, rather than becoming a successful or hidden denial.
let reads=0
const env={AUTH_ORIGIN:origin,OWNER_EMAIL:'synthetic-bifocal-1@example.test',SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),DB:{prepare(){reads++;throw Error('native session storage unavailable')}}}
const request=new Request(origin+'/api/operator/retention/synthetic-bifocal-legacy',{headers:{cookie:'__Host-operator_session='+'s'.repeat(43)}})
await assert.rejects(retentionPolicyResponse(request,env),/native session storage unavailable/)
assert.equal(reads,1)
console.log(JSON.stringify({result:'passed',checks:results,humanSessionControl:{nativeSessionReads:reads,errorPropagates:true}},null,2))

const refusals=[]
for(const [method,suffix,status] of [['PUT','/history',405],['PUT','/unknown',404],['POST','',405]]){
 let nativeReads=0
 const row={id:'synthetic-session',operatorId:'synthetic-owner',createdAt:Date.now(),expiresAt:Date.now()+60000,kind:'native',email:'synthetic-bifocal-1@example.test',displayName:'Synthetic owner',role:'owner',status:'active',version:1,operatorCreatedAt:Date.now()}
 const DB={prepare(query){nativeReads++;return {bind(){return this},async first(){if(query.startsWith('SELECT p.provider_id'))return null;if(query.startsWith('SELECT s.id'))return {...row};throw Error('Refusal attempted non-session work')}}}}
 const env={AUTH_ORIGIN:origin,OWNER_EMAIL:row.email,SESSION_SECRET:'synthetic-bifocal-2'.repeat(3),DB}
 const request=new Request(origin+'/api/operator/retention/synthetic-bifocal-legacy'+suffix,{method,headers:{Origin:origin,cookie:'__Host-operator_session='+'s'.repeat(43),'content-type':'application/json'},body:'{}'})
 const response=await retentionPolicyResponse(request,env)
 assert.equal(response.status,status)
 assert.equal(request.bodyUsed,true,'Refused upload is drained before responding')
 assert.equal(nativeReads,2)
 refusals.push({method,suffix,status:response.status,bodyConsumed:request.bodyUsed,nativeSessionReads:nativeReads})
}
console.log(JSON.stringify({refusalDrainChecks:'passed',checks:refusals},null,2))
