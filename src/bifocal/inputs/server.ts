import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { escapeHtml } from '../../app/shell'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { ownerIdentity } from '../data/snapshots/store'
import { fileOwner } from '../imports/files/owner.server'
import type { Table } from '../imports/files/csv'
import { details, document, exact, field, hidden, ident, input, json, result, text } from '../metrics/transport'
import { fail, QueryError } from '../query/types'
import { rejectedUpload } from '../http/rejected'

type Definition={keyColumn:string;regionColumn:string;region:string;observedColumn:string}
type InputTable={id:string;owner_id:string;name:string;dataset_id:string;source_revision:string;definition_json:string}
type Values={adjustment:string;note:string;effectiveOn:string;active:boolean}
type Row={row_key:string;version:number;value_json:string}
const columns=[{name:'adjustment',type:'money',currency:'USD',scale:2},{name:'note',type:'text',maxLength:1000},{name:'effectiveOn',type:'date'},{name:'active',type:'boolean'}]
function money(value:unknown):string {
 if(typeof value!=='string'||! /^-?(?:0|[1-9]\d{0,13})\.\d{2}$/.test(value))fail('USD_two_decimal_places_required',400)
 return value==='-0.00'?'0.00':value
}
function values(v:Record<string,unknown>):Values {
 exact(v,['rowKey','previousVersion','adjustment','note','effectiveOn','active'])
 const adjustment=money(v.adjustment),note=text(v.note,1000),effectiveOn=text(v.effectiveOn,10)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)||!Number.isFinite(Date.parse(effectiveOn))||new Date(effectiveOn).toISOString().slice(0,10)!==effectiveOn)fail('valid_effective_date_required',400)
 if(![true,false,'true','false'].includes(v.active as boolean))fail('boolean_active_required',400)
 return {adjustment,note,effectiveOn,active:v.active===true||v.active==='true'}
}
const cents=(value:string)=>BigInt(value.replace('.',''))
function decimal(value:bigint){const absolute=value<0n?-value:value;return `${value<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`}
async function source(env:Bindings,dataset:string,revision:string,definition:Definition){
 const stored=await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<{revision:string;value_json:string}>()
 if(!stored||stored.revision!==revision)fail('source_changed_or_removed',409)
 const table=JSON.parse(stored.value_json) as Table
 const key=table.columns.findIndex(c=>c.name===definition.keyColumn),region=table.columns.findIndex(c=>c.name===definition.regionColumn),observed=table.columns.findIndex(c=>c.name===definition.observedColumn&&c.type==='money')
 if(key<0||region<0||observed<0||table.key!==definition.keyColumn||table.rows.length>100)fail('bounded_keyed_USD_source_required',400)
 const rows=table.rows.filter(row=>row[region]===definition.region).map(row=>({rowKey:String(row[key]),observed:money(row[observed])}))
 if(!rows.length||new Set(rows.map(row=>row.rowKey)).size!==rows.length)fail('nonempty_unique_regional_rows_required',400)
 return {rows,guard:sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=? AND value_json=?)',dataset,revision,stored.value_json)}
}
async function handle(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/(app|api\/operator)\/inputs(?:\/([a-z][a-z0-9-]{0,63}))?(?:\/(rows))?$/.exec(url.pathname)
 if(!match)return null
 const page=match[1]==='app',env=runtimeBindings(original),owner=await fileOwner(request,env)
 if(!owner||request.headers.has('Authorization'))return json({error:'owner_required'},401)
 const ownerId=await ownerIdentity(env,owner),viewer=(await operatorAuth(env).getSession(request))!.operator
 try {
  if(url.search)fail('query_parameters_not_supported',400)
  const id=match[2],action=match[3]
  if(request.method==='POST'&&!id){
   const v=await input(request);exact(v,['id','name','dataset','sourceRevision','keyColumn','regionColumn','region','observedColumn'])
   const key=ident(v.id),dataset=ident(v.dataset),revision=text(v.sourceRevision,100),name=text(v.name,120)
   const definition:Definition={keyColumn:text(v.keyColumn,200),regionColumn:text(v.regionColumn,200),region:text(v.region,200),observedColumn:text(v.observedColumn,200)}
   const observed=await source(env,dataset,revision,definition)
   await transact(env.DB,owner,[assertion(observed.guard),sql('INSERT INTO bf_input_tables(id,owner_id,name,dataset_id,source_revision,definition_json,created_at) VALUES(?,?,?,?,?,?,?)',key,ownerId,name,dataset,revision,canonicalJson(definition),new Date().toISOString())])
   return result(request,{id:key,columns,definition,source:{dataset,revision}},'/app/inputs/'+key)
  }
  if(!id){
   if(request.method!=='GET'||action)fail('method_not_allowed',405)
   const tables=(await env.DB.prepare('SELECT id,name FROM bf_input_tables WHERE owner_id=? ORDER BY id LIMIT 100').bind(ownerId).all<{id:string;name:string}>()).results
   await transact(env.DB,owner,[])
   if(!page)return json({tables})
   return document('Input tables',viewer,`<p>Owner-only regional USD forecast adjustments. Observed actuals remain in the source. Manager delegation and external row actions are not available.</p><ul>${tables.map(t=>`<li><a href="/app/inputs/${t.id}">${escapeHtml(t.name)}</a></li>`).join('')}</ul><h2>Create an input table</h2><p>Use a reviewed keyed dataset from <a href="/app/import">Files</a>. Choose its USD money column and one regional row rule. The source revision is fixed; changed sources require a new table.</p><form method="post" action="/api/operator/inputs">${field('id','Input table ID')}${field('name','Table name')}${field('dataset','Dataset ID')}${field('sourceRevision','Reviewed source revision')}${field('keyColumn','Source key column')}${field('regionColumn','Region column')}${field('region','Allowed region')}${field('observedColumn','Observed USD column')}<button type="submit">Create input table</button></form>`)
  }
  const table=await env.DB.prepare('SELECT * FROM bf_input_tables WHERE id=? AND owner_id=?').bind(id,ownerId).first<InputTable>()
  if(!table)fail('input_table_not_found',404)
  const definition=JSON.parse(table.definition_json) as Definition,observed=await source(env,table.dataset_id,table.source_revision,definition)
  const tableGuard=sql('EXISTS(SELECT 1 FROM bf_input_tables WHERE id=? AND owner_id=? AND definition_json=? AND source_revision=?)',id,ownerId,table.definition_json,table.source_revision)
  if(request.method==='POST'&&action==='rows'){
   const v=await input(request),rowKey=text(v.rowKey,200),after=values(v)
   if(!observed.rows.some(row=>row.rowKey===rowKey))fail('row_rule_denied',403)
   const before=await env.DB.prepare('SELECT * FROM bf_input_rows WHERE table_id=? AND row_key=?').bind(id,rowKey).first<Row>()
   if(!/^(?:0|[1-9]\d{0,8})$/.test(String(v.previousVersion))||Number(v.previousVersion)!==(before?.version??0))fail('input_conflict',409)
   const version=(before?.version??0)+1,value=canonicalJson(after),now=new Date().toISOString()
   await transact(env.DB,owner,[assertion(tableGuard),assertion(observed.guard),assertion(before?sql('EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=? AND version=? AND value_json=?)',id,rowKey,before.version,before.value_json):sql('NOT EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=?)',id,rowKey)),sql('INSERT INTO bf_input_rows(table_id,row_key,version,value_json) VALUES(?,?,?,?) ON CONFLICT(table_id,row_key) DO UPDATE SET version=excluded.version,value_json=excluded.value_json',id,rowKey,version,value),sql('INSERT INTO bf_input_history(table_id,row_key,version,actor_id,actor_name,before_json,after_json,recorded_at) VALUES(?,?,?,?,?,?,?,?)',id,rowKey,version,viewer.id,viewer.displayName,before?.value_json??null,value,now)])
   return result(request,{rowKey,version,values:after},'/app/inputs/'+id,200)
  }
  if(request.method!=='GET'||action)fail('method_not_allowed',405)
  const saved=(await env.DB.prepare('SELECT * FROM bf_input_rows WHERE table_id=? ORDER BY row_key').bind(id).all<Row>()).results
  const rows=observed.rows.map(row=>{const stored=saved.find(s=>s.row_key===row.rowKey),value=stored?JSON.parse(stored.value_json) as Values:null;return {...row,version:stored?.version??0,values:value,adjusted:decimal(cents(row.observed)+(value?.active?cents(value.adjustment):0n))}})
  const historyCount=(await env.DB.prepare('SELECT count(*) AS n FROM bf_input_history WHERE table_id=?').bind(id).first<{n:number}>())!.n
  const history=(await env.DB.prepare('SELECT row_key,version,actor_id,actor_name,before_json,after_json,recorded_at FROM bf_input_history WHERE table_id=? ORDER BY recorded_at DESC,row_key,version DESC LIMIT 200').bind(id).all<{row_key:string;version:number;actor_id:string;actor_name:string;before_json:string|null;after_json:string;recorded_at:string}>()).results.map(h=>({rowKey:h.row_key,version:h.version,actorId:h.actor_id,actorName:h.actor_name,before:h.before_json?JSON.parse(h.before_json):null,after:JSON.parse(h.after_json),recordedAt:h.recorded_at}))
  await transact(env.DB,owner,[assertion(tableGuard),assertion(observed.guard),assertion(sql('(SELECT count(*) FROM bf_input_history WHERE table_id=?)=?',id,historyCount)),assertion(sql('(SELECT count(*) FROM bf_input_rows WHERE table_id=?)=?',id,saved.length)),...saved.map(row=>assertion(sql('EXISTS(SELECT 1 FROM bf_input_rows WHERE table_id=? AND row_key=? AND version=? AND value_json=?)',id,row.row_key,row.version,row.value_json)))])
  const value={id,name:table.name,columns,definition,source:{dataset:table.dataset_id,revision:table.source_revision},rows,history,historyCount}
  if(!page)return json(value)
  return document(table.name,viewer,`<p><a href="/app/inputs">Input tables</a> · ${escapeHtml(definition.region)} · USD</p><p role="status">Observed actuals are unchanged. Active adjustments are shown separately. Owner-only; no external actions.</p><p>Source: <a href="/app/import">${escapeHtml(table.dataset_id)}</a> · revision ${escapeHtml(table.source_revision)}</p>${rows.map(row=>`<section class="panel"><h2>Source row ${escapeHtml(row.rowKey)}</h2><dl><dt>Observed actual (USD)</dt><dd>${row.observed}</dd><dt>Active adjustment (USD)</dt><dd>${row.values?.active?row.values.adjustment:'0.00'}</dd><dt>Adjusted analytical value (USD)</dt><dd>${row.adjusted}</dd></dl><form method="post" action="/api/operator/inputs/${id}/rows">${hidden('rowKey',row.rowKey)}${hidden('previousVersion',row.version)}${field('adjustment','Adjustment (USD)',row.values?.adjustment??'0.00')}${field('note','Reason',row.values?.note??'')}${field('effectiveOn','Effective date',row.values?.effectiveOn??'','date')}<label>Apply adjustment<select name="active"><option value="true"${row.values?.active!==false?' selected':''}>Active</option><option value="false"${row.values?.active===false?' selected':''}>Inactive</option></select></label><button type="submit">Save adjustment</button></form><p>Input version ${row.version}</p></section>`).join('')}<p>Showing the latest ${history.length} of ${historyCount} audit entries.</p>${details('Before and after history',history)}`)
 }catch(error){const failure=error instanceof QueryError?error:new QueryError('input_conflict',409);return page||request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?document('Input unavailable',viewer,`<p role="alert">${escapeHtml(failure.code)}</p><a href="/app/inputs">Return to input tables</a>`,failure.status):json({error:failure.code},failure.status)}
}
export async function inputTableResponse(request:Request,env:Bindings):Promise<Response|null>{const response=await handle(request,env);return response?rejectedUpload(request,response):null}
