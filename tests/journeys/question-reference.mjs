import {execFileSync} from 'node:child_process'
export function questionReferences(company){
 return JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys,datetime
from decimal import Decimal
x=json.load(sys.stdin);c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row
c.execute('CREATE TABLE sales(invoice INTEGER,date TEXT,region TEXT,product TEXT,channel TEXT,customer TEXT,revenue_cents INTEGER,profit_cents INTEGER,quantity INTEGER)')
for r in x['rows']:
 c.execute('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?)',(int(r['invoice']),datetime.datetime.strptime(r['date'],'%m/%d/%Y').date().isoformat(),r['region'],r['product'],r['channel'],r['customer'],int(Decimal(r['revenue'])*100),int(Decimal(r['profit'])*100),int(r['quantity'])))
def rows(sql,params):
 sql=sql.replace(' FROM sales',',SUM(revenue_cents) AS __revenue_cents,SUM(profit_cents) AS __profit_cents FROM sales',1)
 return [dict(r) for r in c.execute(sql,params)]
result=[]
for case in x['cases']:
 if case['expected']['decision']!='answer':result.append(None);continue
 r=case['reference'];result.append({'rows':rows(r['sql'],r['params']),'totals':rows(r['totalsSql'],r['totalsParams'])[0],'filteredRows':c.execute(r['filteredRowsSql'],r['params']).fetchone()[0], 'comparison': {'rows':rows(r['comparisonSql'],r['comparisonParams']), 'totals':rows(r['comparisonTotalsSql'],r['comparisonTotalsParams'])[0]} if 'comparisonSql' in r else None})
print(json.dumps(result))`],{input:JSON.stringify(company),encoding:'utf8'}))
}
const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b]}return a}
const rational=(n,d)=>{const g=gcd(n,d);return [n/g,d/g]}
function expectedValue(row,id){
 if(id==='gross-margin')return row.__revenue_cents===null||row.__revenue_cents===0||row.__profit_cents===null?null:rational(BigInt(row.__profit_cents)*100n,BigInt(row.__revenue_cents))
 const cents=row[id==='revenue'?'revenue_minor':'profit_minor'];return cents===null?null:rational(BigInt(cents),100n)
}
export function sameQuestionAnswer(result,fixture,reference){
 if(result.decision!==fixture.expected.decision)return 'decision '+result.decision
 if(result.decision!=='answer')return result.snapshot?'nonanswer saved numerical results':null
 const snapshot=result.snapshot;if(!snapshot)return 'missing native snapshot'
 const definition=snapshot.definition,answer=snapshot.answer,ids=Object.keys(answer.totals)
 if(JSON.stringify([...ids].sort())!==JSON.stringify([...fixture.expected.measureIds].sort()))return 'measure selection'
 if(JSON.stringify([...definition.groupBy].sort())!==JSON.stringify([...fixture.expected.groupBy].sort()))return 'group selection'
 const compare=(values,row)=>ids.every(id=>{const expected=expectedValue(row,id),actual=values[id];if(!expected)return actual.exact===null&&actual.value===null;if(actual.state!=='value'||!actual.exact)return false;const [n,d]=rational(BigInt(actual.exact.numerator),BigInt(actual.exact.denominator));return n*expected[1]===expected[0]*d})
 if(!compare(answer.totals,reference.totals))return 'exact totals'
 if(answer.filteredRows!==reference.filteredRows)return 'filtered rows'
 if(answer.rows.length!==reference.rows.length)return 'result row count'
 for(const row of answer.rows){const dimensions=Object.fromEntries(definition.groupBy.map((column,i)=>[column,row.dimensions[i]])),expected=reference.rows.find(candidate=>fixture.expected.groupBy.every(column=>candidate[column]===dimensions[column]));if(!expected||!compare(row.values,expected))return 'exact result rows'}
 if(fixture.expected.why){
  if(!result.why?.quality||!result.why?.comparison||!result.why?.dimensions?.length)return 'missing quality-first comparison'
  if(!compare(result.why.before.totals,reference.comparison.totals))return 'exact prior totals'
  const metric=result.snapshot.definition.measures[0].id
  for(const driver of result.why.dimensions){
   const contributions=driver.rows.map(row=>row.contribution)
   if(contributions.some(value=>!value))return 'missing driver contribution'
   const total=contributions.reduce((sum,v)=>rational(sum[0]*BigInt(v.denominator)+BigInt(v.numerator)*sum[1],sum[1]*BigInt(v.denominator)),[0n,1n]),current=expectedValue(reference.totals,metric),prior=expectedValue(reference.comparison.totals,metric)
   if(!current||!prior)return 'unknown reference contribution'
   const delta=rational(current[0]*prior[1]-prior[0]*current[1],current[1]*prior[1])
   if(total[0]*delta[1]!==delta[0]*total[1])return 'exact driver reconciliation'
  }
 }
 return null
}
