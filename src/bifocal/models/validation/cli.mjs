#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises'

export async function main(argv=process.argv.slice(2)) {
 if(argv.includes('--help')){console.log('Usage: node src/bifocal/models/validation/cli.mjs validate --origin URL --model UUID --branch UUID --session-file PATH\nThe mode-0600 file holds your native Cookie header. Only same-origin HTTPS or loopback HTTP is accepted. The command prints the exact review digest and downstream impact; it never approves or sends.');return}
 if(argv.shift()!=='validate')throw Error('Expected validate; see --help')
 const flags={}
 while(argv.length){const key=argv.shift(),value=argv.shift();if(!['--origin','--model','--branch','--session-file'].includes(key)||!value||flags[key])throw Error('Invalid arguments; see --help');flags[key]=value}
 if(Object.keys(flags).length!==4)throw Error('Missing arguments; see --help')
 const url=new URL(flags['--origin'])
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use an HTTPS app origin or loopback HTTP')
 if(![flags['--model'],flags['--branch']].every(id=>/^[a-f0-9-]{36}$/.test(id)))throw Error('Invalid model or branch id')
 const info=await stat(flags['--session-file']);if(!info.isFile()||(info.mode&0o777)!==0o600||info.uid!==process.getuid?.())throw Error('Use your own mode-0600 session file')
 const cookie=(await readFile(flags['--session-file'],'utf8')).trim();if(!cookie||/[\r\n\0]/.test(cookie))throw Error('Invalid session file')
 const response=await fetch(url.origin+'/api/operator/models/'+flags['--model']+'/branches/'+flags['--branch']+'/validate',{method:'POST',redirect:'error',headers:{cookie,Origin:url.origin,'content-type':'application/json'},body:'{}'})
 const body=await response.json();console.log(JSON.stringify(body,null,2));if(!response.ok||!body.compatible)process.exitCode=1
}
if(process.argv[1]===import.meta.filename)main().catch(()=>{console.error('Validation failed; check the app origin, native session, branch and private session-file permissions.');process.exitCode=1})
