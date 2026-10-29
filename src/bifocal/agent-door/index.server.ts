import {createAgentDoor,operatorAuthPeople,type Trust} from '../../modules/agent-door/index.ts'
import {operatorAuth,authConfig,type Bindings} from '../../auth.server'
import {machineAuthority} from '../credentials/store.server'
import {reviewedCredential,toolScope} from './grants.server'
import {readTools} from './tools.server'

export function bifocalAgentDoor(env:Bindings) {
 let trust:Trust|null=null
 if ([env.RER_OWNER_CLAIM_ISSUER,env.RER_OWNER_CLAIM_INSTALLATION_ID,env.RER_OWNER_CLAIM_PUBLIC_KEYS].some(Boolean)) {
  if (!env.RER_OWNER_CLAIM_ISSUER || !env.RER_OWNER_CLAIM_INSTALLATION_ID || !env.RER_OWNER_CLAIM_PUBLIC_KEYS) throw new Error('Incomplete agent trust')
  trust={issuer:env.RER_OWNER_CLAIM_ISSUER,installationId:env.RER_OWNER_CLAIM_INSTALLATION_ID,appOrigin:env.AUTH_ORIGIN,publicKeys:JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS)}
 }
 const people=operatorAuthPeople({db:env.DB,allowList:authConfig(env).allowList,session:request=>operatorAuth(env).getSession(request)})
 const mappedSponsor=people.sponsor.bind(people)
 people.sponsor=async claims=>{const person=await mappedSponsor(claims);return person?.role === 'owner' && person.active ? person : null}
 // Local native promotions never confer Business editor authority.
 people.businessRole=person=>person.role === 'owner' ? 'owner' : null
 return createAgentDoor({seed:'bifocal',name:'Bifocal',specialist:'analytics',db:env.DB,origin:env.AUTH_ORIGIN,trust,
  capabilities:['tools','policy','pause','audit','idempotency'],people,tools:readTools(env),paths:['/api/v1/mcp'],
  notTools:[{clauses:['BIF-003','BIF-025','BIF-057'],reason:'import-door'},{clauses:['BIF-033'],reason:'installation'},
   {clauses:['BIF-019','BIF-032','BIF-035','BIF-053'],reason:'screen'},{clauses:['BIF-004'],reason:'connector'}],
  async localCredentials(request) {
   try { const {credential}=await machineAuthority(request,env)
    return {sponsor:{id:credential.owner_id},agent:{id:`native:${credential.id}`,name:credential.scope.purpose,specialist:'analytics'},clientId:`native:${credential.id}`,scopes:credential.scope.tools.map(toolScope)}
   } catch { return null }
  },
  async currentScopes(principal) {
   try { const {credential}=await reviewedCredential(env,principal); return credential.scope.tools.map(toolScope) } catch { return [] }
  },
 })
}
