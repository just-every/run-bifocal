import { Buffer } from 'node:buffer'
import { assertNoCredentials, canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { RdlProject } from './parse'

type Subscription = RdlProject['definition']['subscriptions'][number]
type StoredSubscription = Omit<Subscription,'parameters'> & { parameterReferences: string }
export type StoredRdlProject = Omit<RdlProject,'input'|'definition'> & {
 input: Omit<RdlProject['input'],'subscriptions'> & { subscriptions: Omit<StoredSubscription,'active'>[] }
 definition: Omit<RdlProject['definition'],'subscriptions'> & { subscriptions: StoredSubscription[] }
}
// Parameter names belong to the report schema, not to authentication. Validate
// their reference values as ordinary data before losslessly transporting this
// one schema-owned map through the shared credential-removing reader.
export function retainRdl(project:RdlProject):StoredRdlProject {
 const inspect=(s:Omit<Subscription,'active'>)=>({...s,parameters:Object.entries(s.parameters).map(([parameter,reference])=>({parameter,reference}))})
 assertNoCredentials({...project,input:{...project.input,subscriptions:project.input.subscriptions.map(inspect)},definition:{...project.definition,subscriptions:project.definition.subscriptions.map(inspect)}})
 const retain=<T extends Omit<Subscription,'active'>>(s:T)=>{const {parameters,...rest}=s;return {...rest,parameterReferences:Buffer.from(canonicalJson(parameters)).toString('base64')}}
 return {...project,input:{...project.input,subscriptions:project.input.subscriptions.map(retain)},definition:{...project.definition,subscriptions:project.definition.subscriptions.map(retain)}}
}
export function readRdl(value:StoredRdlProject|RdlProject):RdlProject {
 const read=(s:StoredSubscription|Subscription)=>{
  if('parameters' in s)return s
  const {parameterReferences,...rest}=s
  return {...rest,parameters:JSON.parse(Buffer.from(parameterReferences,'base64').toString('utf8')) as Record<string,string>}
 }
 const project={...value,input:{...value.input,subscriptions:value.input.subscriptions.map(s=>read(s as StoredSubscription))},definition:{...value.definition,subscriptions:value.definition.subscriptions.map(read)}} as RdlProject
 if(sha256(canonicalJson(project.input))!==project.digest)throw Error('RDL_CUSTODY_DIGEST_MISMATCH')
 return project
}
