import {readFile,writeFile} from 'node:fs/promises'
import {parseContract} from '../src/base/seed-contract.mjs'

// Synchronize selected existing acceptance entries from the canonical Status
// table, preserving their original journey requirements and unrelated entries.
// Usage: node scripts/contract-docs.mjs write BIF-016 (or check).
const [mode,...ids]=process.argv.slice(2)
if(!['write','check'].includes(mode)||!ids.length||ids.some(id=>!/^(?:BIF|BASE-AGENT)-\d{3}$/.test(id)))throw Error('Use write or check followed by the selected clause IDs')
const original=await readFile('CONTRACT.md','utf8'),lines=original.split('\n')
const rows=lines.filter(line=>/^\| `(?:BIF|BASE-AGENT)-\d{3}` \|/.test(line)).map(line=>{
 const cells=line.split('|').slice(1,-1).map(cell=>cell.trim())
 return {id:cells[0].replaceAll('`',''),kind:cells[2],status:cells[3],evidence:cells[4],gap:cells[5]}
})
const tally=selected=>({done:selected.filter(row=>row.status==='done').length,partial:selected.filter(row=>row.status==='partial').length,missing:selected.filter(row=>row.status==='missing').length,total:selected.length})
const summary={Published:rows.filter(row=>row.kind==='published'),'Target and push further':rows.filter(row=>row.kind!=='published'),All:rows}
const canonical=lines.map(line=>{
 const label=/^\| (Published|Target and push further|All) \|/.exec(line)?.[1]
 if(!label)return line
 const counts=tally(summary[label]);return `| ${label} | ${counts.done} | ${counts.partial} | ${counts.missing} | ${counts.total} |`
}).join('\n')
const contract=parseContract(canonical),counts=contract.counts
for(const id of ids)if(!contract.clauses.some(clause=>clause.id===id))throw Error('Unknown clause '+id)
let acceptance=await readFile('ACCEPTANCE.md','utf8')
acceptance=acceptance.replace(/Of \d+ BI clauses \([^\n]*?\), \d+ are done, \d+ partial and \d+ missing\./,`Of ${counts.total} BI clauses (${rows.filter(row=>row.kind!=='push-further').length} target and ${rows.filter(row=>row.kind==='push-further').length} push-further), ${counts.done} are done, ${counts.partial} partial and ${counts.missing} missing.`)
acceptance=acceptance.split('\n').map(line=>{
 const entry=/^(- \*\*((?:BIF|BASE-AGENT)-\d{3}) — .+? Status: )\w+(\.\*\* )(.+)$/.exec(line)
 if(!entry||!ids.includes(entry[2]))return line
 const row=rows.find(row=>row.id===entry[2]),journey=entry[4].split(' Existing evidence:')[0]
 return entry[1]+row.status+entry[3]+journey+' Existing evidence: '+(row.evidence||'none').replace(/\.$/,'')+'. Open scope: '+row.gap
}).join('\n')
for (const id of ids.filter(id=>id.startsWith('BASE-AGENT-'))) {
 const row=rows.find(row=>row.id===id)
 if(!acceptance.includes('**'+id+' —')) {
  const clause=contract.clauses.find(clause=>clause.id===id)
  acceptance+='\n- **'+id+' — '+clause.title+'. Status: '+row.status+'.** Shared agent-door duty; judge through the installed public doors. Existing evidence: '+(row.evidence||'none')+'. Open scope: '+row.gap+'\n'
 }
}
for(const [path,before,after] of [['CONTRACT.md',original,canonical],['ACCEPTANCE.md',await readFile('ACCEPTANCE.md','utf8'),acceptance]]){
 if(mode==='write'&&before!==after)await writeFile(path,after)
 if(mode==='check'&&before!==after)throw Error(path+' is stale for '+ids.join(', '))
}
console.log('contract-docs '+mode+' passed: '+ids.join(', '))
