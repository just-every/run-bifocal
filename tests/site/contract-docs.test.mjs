import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import test from 'node:test'

test('a fresh agent-clause regeneration passes its check and is byte-stable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bifocal-contract-docs-'))
 try {
  for(const path of ['scripts','src/base'])await mkdir(join(directory,path),{recursive:true})
  for(const path of ['scripts/contract-docs.mjs','src/base/seed-contract.mjs','CONTRACT.md'])await copyFile(new URL('../../'+path,import.meta.url),join(directory,path))
  const original=await readFile(new URL('../../ACCEPTANCE.md',import.meta.url),'utf8')
  const withoutAgents=original.split('\n').filter(line=>!line.startsWith('- **BASE-AGENT-')).join('\n')
  await writeFile(join(directory,'ACCEPTANCE.md'),withoutAgents)
  const ids=['BIF-027','BIF-035',...Array.from({length:13},(_,i)=>'BASE-AGENT-'+String(i+1).padStart(3,'0'))]
  const run=mode=>{
   const result=spawnSync(process.execPath,['scripts/contract-docs.mjs',mode,...ids],{cwd:directory,encoding:'utf8'})
   assert.equal(result.status,0,result.stdout+result.stderr)
  }
  run('write');run('check')
  const first=await readFile(join(directory,'ACCEPTANCE.md'),'utf8')
  for(const line of withoutAgents.split('\n').filter(line=>line.startsWith('- **BIF-')&&!/^\- \*\*BIF-(027|035) /.test(line)))assert.ok(first.includes(line),'unrelated acceptance entry survives')
  run('write');run('check')
  assert.equal(await readFile(join(directory,'ACCEPTANCE.md'),'utf8'),first)
  assert.equal(await readFile(join(directory,'CONTRACT.md'),'utf8'),await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8'))
 } finally {await rm(directory,{recursive:true,force:true})}
})
