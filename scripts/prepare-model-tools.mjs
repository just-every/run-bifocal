// Real public Terraform commands exercise the provider against the built app.
import {mkdir,writeFile,chmod} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {unzipSync} from 'fflate'
const directory=resolve('.cache/bifocal-tools');await mkdir(directory,{recursive:true})
const targetPlatform=({linux:'linux',darwin:'darwin'})[process.platform],targetArch=({x64:'amd64',arm64:'arm64'})[process.arch]
if(!targetPlatform||!targetArch)throw Error('Automated Terraform tool preparation supports Linux and macOS on x64 and arm64. See docs/MODEL-TOOLS.md for other hosts.')
const version='1.13.4',name=`terraform_${version}_${targetPlatform}_${targetArch}.zip`,base=`https://releases.hashicorp.com/terraform/${version}/`
const download=async name=>{const result=spawnSync('curl',['--fail','--silent','--show-error','--max-time','60',base+name],{maxBuffer:64<<20});if(result.error||result.status!==0)throw Error('Terraform download failed');return result.stdout}
const sums=await download(`terraform_${version}_SHA256SUMS`),expected=sums.toString().split('\n').find(line=>line.endsWith('  '+name))?.split(' ')[0]
const archive=await download(name)
if(!expected||createHash('sha256').update(archive).digest('hex')!==expected)throw Error('Terraform checksum mismatch')
const target=join(directory,'terraform');await writeFile(target,unzipSync(archive).terraform);await chmod(target,0o755)
const compiled=spawnSync(process.env.BIFOCAL_GO??'go',['build','-o',join(directory,'terraform-provider-run-bifocal'),'.'],{cwd:'./tools/terraform-provider-bifocal',stdio:'inherit'})
if(compiled.error||compiled.status!==0)throw Error('Terraform provider compilation failed')
console.log('Terraform and native model provider prepared in the local cache')
