import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'

test('new agent acceptance entries are fresh after one regeneration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bifocal-contract-docs-'))
 try {
  await mkdir(join(root,'scripts'),{recursive:true})
  await mkdir(join(root,'src/base'),{recursive:true})
  for(const path of ['scripts/contract-docs.mjs','src/base/seed-contract.mjs','CONTRACT.md'])
   await copyFile(new URL('../../'+path,import.meta.url),join(root,path))
  const original=await readFile(new URL('../../ACCEPTANCE.md',import.meta.url),'utf8')
  const before=original.split('\n').filter(line=>!line.startsWith('- **BASE-AGENT-')).join('\n')
  await writeFile(join(root,'ACCEPTANCE.md'),before)
  const ids=Array.from({length:13},(_,index)=>`BASE-AGENT-${String(index+1).padStart(3,'0')}`)
  const run=mode=>execFileSync(process.execPath,['scripts/contract-docs.mjs',mode,...ids],{cwd:root,stdio:'pipe'})
  run('write')
  run('check')
  const once=await readFile(join(root,'ACCEPTANCE.md'),'utf8')
  for(const id of ids)assert.equal(once.split('\n').filter(line=>line.startsWith('- **'+id+' —')).length,1)
  assert.equal(once.split('\n').filter(line=>!line.startsWith('- **BASE-AGENT-')).join('\n').trim(),before.trim())
  run('write')
  assert.equal(await readFile(join(root,'ACCEPTANCE.md'),'utf8'),once)
 } finally {await rm(root,{recursive:true,force:true})}
})
