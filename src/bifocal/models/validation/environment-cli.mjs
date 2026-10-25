import {readFile,writeFile} from 'node:fs/promises'

export const environmentUsage=` environment-export --estate ID --output PATH
 environment-plan --file PATH --plan-file PATH
 environment-apply --plan-file PATH --approve DIGEST
 environment-status --estate ID
 environment-review --estate ID --version INTEGER
 environment-approve --estate ID --version INTEGER --digest DIGEST [--security-resolution TEXT]
 environment-promote --estate ID --version INTEGER --digest DIGEST --environment staging|production
 environment-rollback-plan --estate ID --version INTEGER
 environment-rollback --estate ID --version INTEGER --generation INTEGER --digest DIGEST [--security-resolution TEXT]
 environment-run --estate ID --environment development|staging|production --key KEY [--view ID]`
export const environmentOptions={
 'environment-export':['estate','output'],
 'environment-plan':['file','plan-file'],
 'environment-apply':['plan-file','approve'],
 'environment-status':['estate'],
 'environment-review':['estate','version'],
 'environment-approve':['estate','version','digest','security-resolution'],
 'environment-promote':['estate','version','digest','environment'],
 'environment-rollback-plan':['estate','version'],
 'environment-rollback':['estate','version','generation','digest','security-resolution'],
 'environment-run':['estate','environment','key','view']
}
export const environmentRequired={
 ...environmentOptions,
 'environment-approve':['estate','version','digest'],
 'environment-rollback':['estate','version','generation','digest'],
 'environment-run':['estate','environment','key']
}
const stableId=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value)
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const positive=value=>Number.isSafeInteger(value)&&value>0
const nativeDocument=value=>value?.version===1&&stableId(value.id)&&Array.isArray(value.resources)
const writePrivate=(path,document)=>writeFile(path,JSON.stringify(document,null,2)+'\n',{flag:'wx',mode:0o600})

export function validateEnvironmentFlags(flags){
 if(flags.version&&(!/^[1-9][0-9]*$/.test(flags.version)||!positive(Number(flags.version))))throw Error('Invalid environment version')
 if(flags.generation&&!Number.isSafeInteger(Number(flags.generation)))throw Error('Invalid environment generation')
 if(flags.digest&&!digest(flags.digest))throw Error('Invalid environment review digest')
}

export async function environmentCommand(command,flags,{call,origin}){
 const estate='/environments/'+encodeURIComponent(flags.estate??'')
 const version=Number(flags.version)
 const security=flags['security-resolution']?{securityResolution:flags['security-resolution']}:{}
 switch(command){
  case 'environment-export':{
   const saved=await call('/environment-definitions/'+encodeURIComponent(flags.estate))
   if(!saved.document)throw Error('Environment definition not found')
   await writePrivate(flags.output,saved.document)
   return {exported:true}
  }
  case 'environment-plan':{
   const document=JSON.parse(await readFile(flags.file,'utf8'))
   if(!nativeDocument(document))throw Error('Use native environment JSON with stable ID and resource references')
   const current=await call('/environment-definitions/'+encodeURIComponent(document.id))
   if(!(current.document===null&&current.revision===null)&&!(current.document?.id===document.id&&positive(current.revision)))throw Error('Invalid current environment response')
   const previousRevision=current.revision,review=await call('/environment-definitions/review',{document,previousRevision})
   await writePrivate(flags['plan-file'],{version:1,origin,document:review.document,previousRevision,reviewedDigest:review.digest})
   return review
  }
  case 'environment-apply':{
   const plan=JSON.parse(await readFile(flags['plan-file'],'utf8'))
   if(plan.version!==1||plan.origin!==origin||plan.reviewedDigest!==flags.approve||!digest(flags.approve)||!nativeDocument(plan.document)||!(plan.previousRevision===null||positive(plan.previousRevision)))throw Error('Exact reviewed environment plan required for this origin')
   const saved=await call('/environment-definitions/apply',{document:plan.document,previousRevision:plan.previousRevision,reviewedDigest:flags.approve})
   if(saved.state!=='draft')throw Error('Environment definition must remain a draft')
   return saved
  }
  case 'environment-status':return call(estate)
  case 'environment-review':return call(estate+'/review',{version})
  case 'environment-approve':return call(estate+'/approve',{version,digest:flags.digest,...security})
  case 'environment-promote':return call(estate+'/promote',{version,digest:flags.digest,environment:flags.environment})
  case 'environment-rollback-plan':return call(estate+'/rollback-review',{version})
  case 'environment-rollback':return call(estate+'/rollback',{version,previousGeneration:Number(flags.generation),digest:flags.digest,...security})
  case 'environment-run':return call(estate+'/run',{environment:flags.environment,key:flags.key,...(flags.view?{viewId:flags.view}:{})})
  default:throw Error('Unknown environment command')
 }
}
