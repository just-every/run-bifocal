#!/usr/bin/env node
import {open,readFile,writeFile} from 'node:fs/promises'
import {constants} from 'node:fs'
import {environmentOptions,environmentRequired,environmentUsage,environmentCommand,validateEnvironmentFlags} from './environment-cli.mjs'

const usage=`Usage: node src/bifocal/models/validation/cli.mjs COMMAND --origin URL --session-file PATH [options]
Commands:
${environmentUsage}
 policy-export --policy ID --output PATH
 policy-plan --file PATH --plan-file PATH
 policy-apply --plan-file PATH --approve DIGEST
 chart-export --id UUID --output PATH
 chart-import --file PATH [--plan-file PATH | --approve DIGEST]
 metric-export --metric ID --output PATH
 metric-plan --file PATH --plan-file PATH
 metric-apply --plan-file PATH --approve DIGEST
 schedule-export --schedule ID --output PATH
 schedule-plan --file PATH --plan-file PATH
 schedule-apply --plan-file PATH --approve DIGEST
 report-export --id UUID --output PATH
 report-import --file PATH [--plan-file PATH | --approve DIGEST]
 dashboard-export --id UUID --output PATH
 dashboard-import --file PATH [--plan-file PATH | --approve DIGEST]
 export --model UUID --branch UUID --output PATH
 plan --file PATH --plan-file PATH [--model UUID --branch UUID]
 apply --plan-file PATH --approve DIGEST
 branch --model UUID --file PATH
 preview --model UUID --branch UUID --view ID --digest DIGEST
 validate --model UUID --branch UUID
 approve --model UUID --branch UUID --digest DIGEST [--security-resolution TEXT]
 promote --model UUID --branch UUID --digest DIGEST --environment staging|production
 run --model UUID --environment staging|production --view ID
 status --model UUID
 rollback-plan --model UUID --revision UUID
 rollback --model UUID --revision UUID --generation INTEGER --digest DIGEST [--security-resolution TEXT]
 delete-branch --model UUID --branch UUID --version INTEGER
Only current native human owner sessions are accepted. Use your own mode-0600 session file.
Plan files contain definitions and a review fingerprint, without rows, credentials or grants.
Review the printed exact results before apply. Approve and promote are explicit separate commands.
Exported JSON is the documented native model format; git branches hold edits to that file.
The tools manage native models, draft metric definitions, inactive role policy definitions, retained charts, dashboards and reports with one to four answers, and finite schedule definitions, with partial BIF-022 support.`
const options={...environmentOptions,'policy-export':['policy','output'],'policy-plan':['file','plan-file'],'policy-apply':['plan-file','approve'],'chart-export':['id','output'],'chart-import':['file','approve','plan-file'],'metric-export':['metric','output'],'metric-plan':['file','plan-file'],'metric-apply':['plan-file','approve'],'report-export':['id','output'],'report-import':['file','approve','plan-file'],'schedule-export':['schedule','output'],'schedule-plan':['file','plan-file'],'schedule-apply':['plan-file','approve'],'dashboard-export':['id','output'],'dashboard-import':['file','approve','plan-file'],export:['model','branch','output'],plan:['file','plan-file','model','branch'],apply:['plan-file','approve'],branch:['model','file'],preview:['model','branch','view','digest'],validate:['model','branch'],approve:['model','branch','digest','security-resolution'],promote:['model','branch','digest','environment'],run:['model','environment','view'],status:['model'],'rollback-plan':['model','revision'],rollback:['model','revision','generation','digest','security-resolution'],'delete-branch':['model','branch','version']}
const required={...options,...environmentRequired,'chart-import':['file'],'report-import':['file'],'dashboard-import':['file'],plan:['file','plan-file'],approve:['model','branch','digest'],rollback:['model','revision','generation','digest']}
const stableId=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value)
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)
export async function main(argv=process.argv.slice(2)) {
 if(argv.includes('--help')){console.log(usage);return}
 const command=argv.shift(),allowed=options[command];if(!allowed)throw Error('Unknown command; see --help')
 const flags={}
 while(argv.length){const key=argv.shift()?.replace(/^--/,''),value=argv.shift();if(!['origin','session-file',...allowed].includes(key)||!value||flags[key])throw Error('Invalid arguments; see --help');flags[key]=value}
 for(const key of ['origin','session-file',...required[command]])if(!flags[key])throw Error('Missing '+key)
 for(const key of ['id','model','branch','revision'])if(flags[key]&&!uuid(flags[key]))throw Error('Invalid '+key)
 for(const kind of ['metric','policy','estate'])if(flags[kind]&&!stableId(flags[kind]))throw Error('Invalid '+kind+' ID')
 if(command==='plan'&&!!flags.model!==!!flags.branch)throw Error('Supply both model and branch for updates')
 if(flags.environment&&!(command==='environment-run'?['development','staging','production']:['staging','production']).includes(flags.environment))throw Error('Invalid environment')
 if(flags.generation&&!/^(0|[1-9][0-9]*)$/.test(flags.generation))throw Error('Invalid generation')
 if(command.startsWith('environment-'))validateEnvironmentFlags(flags)
 const url=new URL(flags.origin)
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use an HTTPS app origin or loopback HTTP')
 const session=await open(flags['session-file'],constants.O_RDONLY|constants.O_NOFOLLOW)
 let cookie
 try{const info=await session.stat();if(!info.isFile()||(info.mode&0o777)!==0o600||info.uid!==process.getuid?.())throw Error('Use your own mode-0600 session file');cookie=(await session.readFile('utf8')).trim()}finally{await session.close()}
 if(!cookie||/[\r\n\0]/.test(cookie))throw Error('Invalid session file')
 const call=async(path,data,method=data===undefined?'GET':'POST')=>{
  const response=await fetch(url.origin+'/api/operator'+path,{method,redirect:'error',headers:{cookie,Origin:url.origin,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
  const result=await response.json();if(!response.ok)throw Error('Request refused: '+String(result.error??response.status));return result
 }
 const model='/models/'+flags.model,branch=model+'/branches/'+flags.branch
 const definition=async()=>JSON.parse(await readFile(flags.file,'utf8'))
 const documentInput=async()=>({document:JSON.stringify(await definition()),...(flags.model?{modelId:flags.model,branchId:flags.branch}:{}),...(flags.model?{previousVersion:(await call(branch)).version}:{})})
 let result
 switch(command){
  case 'policy-export':
  case 'metric-export':{
   const kind=command.split('-')[0],saved=await call('/'+kind+'-definitions/'+encodeURIComponent(flags[kind]))
   if(!saved.document)throw Error(kind+' not found')
   if(kind==='policy'&&saved.active!==false)throw Error('Policy definition must remain inactive')
   await writeFile(flags.output,JSON.stringify(saved.document,null,2)+'\n',{flag:'wx',mode:0o600});result={exported:true};break
  }
  case 'policy-plan':
  case 'metric-plan':{
   const kind=command.split('-')[0],document=await definition()
   if(!document||document.version!==1||!stableId(document.id))throw Error('Use native '+kind+' JSON with a stable ID')
   const current=await call('/'+kind+'-definitions/'+encodeURIComponent(document.id))
   if(!(current.document===null&&current.revision===null)&&!(current.document?.id===document.id&&Number.isSafeInteger(current.revision)&&current.revision>0))throw Error('Invalid current '+kind+' response')
   if(kind==='policy'&&current.active!==false)throw Error('Policy definition must remain inactive')
   const previousRevision=current.revision,review=await call('/'+kind+'-definitions/review',{document,previousRevision})
   if(kind==='policy'&&review.active!==false)throw Error('Policy review must remain inactive')
   await writeFile(flags['plan-file'],JSON.stringify({version:1,origin:url.origin,document:review.document,previousRevision,reviewedDigest:review.digest},null,2)+'\n',{flag:'wx',mode:0o600});result=review;break
  }
  case 'policy-apply':
  case 'metric-apply':{
   const kind=command.split('-')[0],plan=JSON.parse(await readFile(flags['plan-file'],'utf8'))
   if(plan.version!==1||plan.origin!==url.origin||plan.reviewedDigest!==flags.approve||!/^[a-f0-9]{64}$/.test(flags.approve)||plan.document?.version!==1||!stableId(plan.document.id)||!(plan.previousRevision===null||Number.isSafeInteger(plan.previousRevision)&&plan.previousRevision>0))throw Error('Exact reviewed '+kind+' plan required for this origin')
   result=await call('/'+kind+'-definitions/apply',{document:plan.document,previousRevision:plan.previousRevision,reviewedDigest:flags.approve})
   if(kind==='policy'&&result.active!==false)throw Error('Applied policy definition must remain inactive')
   break
  }
  case 'schedule-export':{
   const versions=await call('/schedules/'+encodeURIComponent(flags.schedule)),version=versions.versions[0]?.version
   if(!version)throw Error('Schedule not found')
   const saved=await call('/schedules/'+encodeURIComponent(flags.schedule)+'/'+version),{resolution,dispatcher,...definition}=saved.definition
   await writeFile(flags.output,JSON.stringify(saved.definition.document??{version:1,id:saved.id,definition},null,2)+'\n',{flag:'wx',mode:0o600});result={exported:true};break
  }
  case 'schedule-plan':{
   const document=await definition(),versions=await call('/schedules/'+encodeURIComponent(document.id)),previousVersion=versions.versions[0]?.version??null
   const review=await call('/schedule-definitions/review',{document,previousVersion})
   await writeFile(flags['plan-file'],JSON.stringify({version:1,origin:url.origin,document:review.document,previousVersion,reviewedDigest:review.digest},null,2)+'\n',{flag:'wx',mode:0o600});result=review;break
  }
  case 'schedule-apply':{
   const plan=JSON.parse(await readFile(flags['plan-file'],'utf8'))
   if(plan.version!==1||plan.origin!==url.origin||plan.reviewedDigest!==flags.approve||!/^[a-f0-9]{64}$/.test(flags.approve))throw Error('Exact reviewed plan required for this origin')
   result=await call('/schedule-definitions/apply',{document:plan.document,previousVersion:plan.previousVersion,reviewedDigest:flags.approve});break
  }
  case 'chart-export':
  case 'report-export':
  case 'dashboard-export':{
   const kind=command.split('-')[0],saved=await call('/'+kind+'s/'+flags.id),document={version:1,title:saved.title}
   if(saved.definition){document.definition=saved.definition;if(kind==='chart')document.visual=saved.visual}
   else if(kind!=='chart'&&Array.isArray(saved.cards)&&saved.cards.length>=2&&saved.cards.length<=4&&saved.cards.every(card=>card?.definition))document.cards=saved.cards.map(card=>card.definition)
   else throw Error('Unsupported native '+kind+' definition')
   await writeFile(flags.output,JSON.stringify(document,null,2)+'\n',{flag:'wx',mode:0o600});result={exported:true};break
  }
  case 'chart-import':
  case 'report-import':
  case 'dashboard-import':{const kind=command.split('-')[0],document=await definition();const review=await call('/'+kind+'-definitions/review',{document});if(!flags.approve){if(!flags['plan-file'])throw Error('Review first with --plan-file, then apply with --approve');await writeFile(flags['plan-file'],JSON.stringify({version:1,origin:url.origin,document:review.document,reviewedDigest:review.digest},null,2)+'\n',{flag:'wx',mode:0o600});result=review}else{result=await call('/'+kind+'-definitions/create',{document,reviewedDigest:flags.approve})}break}
  case 'export':result=(await call(branch)).definition;await writeFile(flags.output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});result={exported:true};break
  case 'plan':{
   const input=await documentInput(),review=await call('/model-authoring/review',input)
   const plan={version:1,origin:url.origin,input,reviewedDigest:review.digest}
   if(!review.compatible)throw Error('Model is incompatible; no plan saved')
   await writeFile(flags['plan-file'],JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});result=review;break
  }
  case 'apply':{
   const plan=JSON.parse(await readFile(flags['plan-file'],'utf8'))
   if(plan.version!==1||plan.origin!==url.origin||plan.reviewedDigest!==flags.approve||!/^[a-f0-9]{64}$/.test(flags.approve))throw Error('Exact reviewed plan required for this origin')
   result=await call('/model-authoring/create',{...plan.input,reviewedDigest:plan.reviewedDigest});break
  }
  case 'branch':result=await call(model+'/branches',{definition:await definition()});break
  case 'preview':result=await call(branch+'/preview',{viewId:flags.view,digest:flags.digest});break
  case 'validate':result=await call(branch+'/validate',{});if(!result.compatible)process.exitCode=1;break
  case 'approve':result=await call(branch+'/approve',{digest:flags.digest,...(flags['security-resolution']?{securityResolution:flags['security-resolution']}:{})});break
  case 'promote':result=await call(branch+'/promote',{digest:flags.digest,environment:flags.environment});break
  case 'run':result=await call(model+'/'+flags.environment+'/run',{viewId:flags.view});break
  case 'status':result=await call(model);break
  case 'rollback-plan':result=await call(model+'/rollback-preview',{revision:flags.revision});break
  case 'rollback':result=await call(model+'/rollback',{revision:flags.revision,previousGeneration:Number(flags.generation),digest:flags.digest,...(flags['security-resolution']?{securityResolution:flags['security-resolution']}:{})});break
  case 'delete-branch':result=await call(branch,{previousVersion:Number(flags.version)},'DELETE');break
  default:result=await environmentCommand(command,flags,{call,origin:url.origin});break
 }
 console.log(JSON.stringify(result,null,2))
}
if(process.argv[1]===import.meta.filename)main().catch(error=>{console.error(error.message);process.exitCode=1})
