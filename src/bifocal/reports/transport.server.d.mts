import type { Bindings } from '../../auth.server'
export function sendReport(env:Bindings,id:string,email:string,artifact:string):Promise<{provider:string;status:'accepted'|'rejected'|'rate_limited'|'uncertain'|'development';providerMessageId:string|null}>
