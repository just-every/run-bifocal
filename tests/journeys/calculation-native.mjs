import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
const n=value=>value.type==='number'?Number(value.numerator)/Number(value.denominator):null
export async function proveNativeCalculations({base,prepare,apply,call}){
 const field=name=>({kind:'field',field:name}),sum={kind:'aggregate',op:'sum',expression:field('revenue')},literal=value=>({kind:'literal',type:'number',value})
 const lag={kind:'window',op:'lag',expression:sum,partitionBy:[],orderBy:[{field:'date',direction:'asc',nulls:'last'}],offset:1}
 const formulas=[
  {id:'third',kind:'field',dataType:'number',language:'native',sourceExpression:'[revenue] / 3',expression:{kind:'binary',op:'/',left:field('revenue'),right:literal('3')}},
  {id:'one-month-later',kind:'field',dataType:'date',language:'tableau',sourceExpression:"DATEADD('month',1,[date])"},
  {id:'third-total',language:'native',sourceExpression:'SUM([third])',expression:{kind:'aggregate',op:'sum',expression:field('third')}},
  {id:'movement',language:'native',sourceExpression:'(SUM(revenue)-previous)/previous',expression:{kind:'binary',op:'/',left:{kind:'binary',op:'-',left:sum,right:lag},right:lag}},
  {id:'ranked-sales',language:'native',sourceExpression:'RANK by revenue descending, NULL last',expression:{kind:'window',op:'rank',expression:sum,partitionBy:[],orderBy:[{expression:sum,direction:'desc',nulls:'last'}]}},
  {id:'share',language:'native',sourceExpression:'Percent of visible revenue',expression:{kind:'percent-of-total',expression:sum,partitionBy:[]}},
  {id:'zero-denominator',language:'native',sourceExpression:'Revenue divided by zero',expression:{kind:'binary',op:'/',left:sum,right:literal('0')}},
 ]
 const input={...base,id:'synthetic-bifocal-native-calculations',calculations:formulas,groups:[],parameters:[],fieldParameters:[]},saved=await apply(input,await prepare(input))
 assert.equal(saved.report.compatible,true,JSON.stringify(saved.report))
 const answer=(await call('/calculations/'+input.id+'/run',{revision:saved.revision,groupBy:['date'],filters:[]})).answer
 const expected=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json
c=sqlite3.connect(':memory:');c.execute('CREATE TABLE scoped(day,cents)');c.executemany('INSERT INTO scoped VALUES(?,?)',[('2026-07-01',1001),('2026-07-15',None),('2026-08-01',-400),('2026-08-15',3003)])
print(json.dumps(c.execute('SELECT day,RANK() OVER(ORDER BY cents DESC NULLS LAST),100.0*cents/(SELECT sum(cents) FROM scoped),(1.0*cents-lag(cents) OVER(ORDER BY day))/lag(cents) OVER(ORDER BY day) FROM scoped ORDER BY day').fetchall()))`],{encoding:'utf8'}))
 assert.deepEqual(answer.totals['third-total'],{type:'number',numerator:'901',denominator:'75'})
 assert.equal(answer.totals['zero-denominator'].type,'null');assert.equal(answer.totals['zero-denominator'].reason,'zero_denominator')
 for(let i=0;i<expected.length;i++){const values=answer.rows[i].values;assert.equal(n(values['ranked-sales']),expected[i][1]);for(const [id,index]of [['share',2],['movement',3]]){const value=n(values[id]);if(expected[i][index]===null)assert.equal(value,null);else assert.ok(Math.abs(value-expected[i][index])<1e-10)}}
 const filtered=(await call('/calculations/'+input.id+'/run',{revision:saved.revision,groupBy:['date'],filters:[{field:'third',op:'gte',value:'0'}]})).answer
 assert.equal(filtered.filteredRows,2)
 return input
}
