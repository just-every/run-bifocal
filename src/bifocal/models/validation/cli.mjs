#!/usr/bin/env node
import {open,readFile,writeFile} from 'node:fs/promises'
import {constants} from 'node:fs'

const usage=`Usage: node src/bifocal/models/validation/cli.mjs COMMAND --origin URL --session-file PATH [options]
Commands:
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
The bounded tool manages native models only, not the full BIF-022 resource estate.`
const options={'dashboard-export':['id','output'],'dashboard-import':['file','approve','plan-file'],export:['model','branch','output'],plan:['file','plan-file','model','branch'],apply:['plan-file','approve'],branch:['model','file'],preview:['model','branch','view','digest'],validate:['model','branch'],approve:['model','branch','digest','security-resolution'],promote:['model','branch','digest','environment'],run:['model','environment','view'],status:['model'],'rollback-plan':['model','revision'],rollback:['model','revision','generation','digest','security-resolution'],'delete-branch':['model','branch','version']}
const required={...options,'dashboard-import':['file'],plan:['file','plan-file'],approve:['model','branch','digest'],rollback:['model','revision','generation','digest']}
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)
export async function main(argv=process.argv.slice(2)) {
 if(argv.includes('--help')){console.log(usage);return}
 const command=argv.shift(),allowed=options[command];if(!allowed)throw Error('Unknown command; see --help')
 const flags={}
 while(argv.length){const key=argv.shift()?.replace(/^--/,''),value=argv.shift();if(!['origin','session-file',...allowed].includes(key)||!value||flags[key])throw Error('Invalid arguments; see --help');flags[key]=value}
 for(const key of ['origin','session-file',...required[command]])if(!flags[key])throw Error('Missing '+key)
 for(const key of ['id','model','branch','revision'])if(flags[key]&&!uuid(flags[key]))throw Error('Invalid '+key)
 if(command==='plan'&&!!flags.model!==!!flags.branch)throw Error('Supply both model and branch for updates')
 if(flags.environment&&!['staging','production'].includes(flags.environment))throw Error('Invalid environment')
 if(flags.generation&&!/^(0|[1-9][0-9]*)$/.test(flags.generation))throw Error('Invalid generation')
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
  case 'dashboard-export':{const dashboard=await call('/dashboards/'+flags.id);if(!dashboard.definition)throw Error('Only single-answer native dashboards are currently portable through this command');await writeFile(flags.output,JSON.stringify({version:1,title:dashboard.title,definition:dashboard.definition},null,2)+'\n',{flag:'wx',mode:0o600});result={exported:true};break}
  case 'dashboard-import':{const document=await definition();const review=await call('/dashboard-definitions/review',{document});if(!flags.approve){if(!flags['plan-file'])throw Error('Review first with --plan-file, then apply with --approve');await writeFile(flags['plan-file'],JSON.stringify({version:1,origin:url.origin,document:review.document,reviewedDigest:review.digest},null,2)+'\n',{flag:'wx',mode:0o600});result=review}else{result=await call('/dashboard-definitions/create',{document,reviewedDigest:flags.approve})}break}
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
 }
 console.log(JSON.stringify(result,null,2))
}
if(process.argv[1]===import.meta.filename)main().catch(error=>{console.error(error.message);process.exitCode=1})
