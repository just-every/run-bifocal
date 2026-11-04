import { assertNoCredentials, decodedCredentialText } from '../../../modules/import-kit/src/provenance/credentials.ts'
import { DoorError } from '../../../modules/import-kit/src/door/protocol.ts'

export function migrationRefusal(code:string,location='') {
 return new DoorError(code,422,{location,reason:code==='migration_secret_refused'?'Credential-bearing source refused. Upload copies were purged; remove the value at the source and upload a safe export.':'Supply one bounded data-only Hex v3 export with stable cell identifiers. Source values are omitted from diagnostics.'})
}
/** This is a conservative literal screen, never a claim to discover Python dependencies or all possible secrets. */
export function assertMigrationSafe(value:unknown,location='') : void {
 let nodes=0
 const visit=(v:unknown,path:string,depth:number):void=>{
  if(++nodes>20000||depth>48)throw migrationRefusal('migration_structure_limit',path)
  if(typeof v==='string'){
   let decoded:string
   try{
    decoded=decodedCredentialText(v);assertNoCredentials(decoded)
    // Source code and prose can contain URLs without being a URL themselves.
    for(const match of decoded.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi))assertNoCredentials(match[0])
   }catch{throw migrationRefusal('migration_secret_refused',path)}
   // Assignment and header literals in SQL, Python, markdown and arbitrary config are never ordinary custody.
   if(/\b(?:[a-z0-9]+[_-])*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|authorization|credential)(?:[_-][a-z0-9]+)*["']?\s*(?:[:=]|\])\s*(?:=\s*)?["'`]\s*[^"'`\s][^"'`]*["'`]/i.test(decoded)
    || /\b(?:bearer|basic)\s+[a-z0-9._~+/-]{8,}/i.test(decoded)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(decoded)
    || /\b(?:gh[pousr]_|github_pat_|sk_live_|sk_test_|xox[baprs]-)[a-z0-9_-]{12,}/i.test(decoded)
    || /https?:\/\/[^\s/]+:[^\s/]+@/i.test(decoded))throw migrationRefusal('migration_secret_refused',path)
   return
  }
  if(Array.isArray(v)){v.forEach((x,i)=>visit(x,path+'/'+i,depth+1));return}
  if(v&&typeof v==='object'){
   try{assertNoCredentials(v)}catch{throw migrationRefusal('migration_secret_refused',path)}
   for(const [key,x]of Object.entries(v)){
    visit(key,path,depth+1)
    const child=path+'/'+key.replaceAll('~','~0').replaceAll('/','~1')
    // Hex environment entries encode credential field names as data.
    if(key==='name'&&typeof x==='string'&&Object.hasOwn(v,'value')){
     const entryValue=(v as Record<string,unknown>).value
     if(entryValue){
      try{assertNoCredentials({[decodedCredentialText(x)]:entryValue})}catch{throw migrationRefusal('migration_secret_refused',path+'/value')}
      if(/(?:password|passwd|pwd|passphrase|secret|token|api.?key|authorization|credential)/i.test(x))throw migrationRefusal('migration_secret_refused',path+'/value')
     }
    }
    visit(x,child,depth+1)
   }
  }
 }
 visit(value,location,0)
}
