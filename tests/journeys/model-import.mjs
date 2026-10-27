import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
 // Adding a manifest must never hide an unsupported uploaded SQL definition.
 const sql={path:'tests/revenue_check.sql',content:"select {{ run_query('select 1') }} from {{ ref('sales') }}"}
 for(const [suffix,extra] of [['empty',[{path:'target/manifest.json',content:JSON.stringify({...manifest,nodes:{},sources:{}})}]],['source',[]],['resolved',cloud.files]]){
  const input=dbtEnvelope('synthetic-bifocal-dbt-sql-'+suffix,[...projects[1].files,sql,...extra]),plan=await prepare(input)
  assert.equal(plan.project.report.compatible,false,'Uploaded SQL stays incompatible with '+suffix+' manifest inventory')
  const inventory=plan.project.report.project.resources,resource=inventory.find(r=>r.file===sql.path)
  assert.ok(resource,'Uploaded SQL remains inventoried with '+suffix+' manifest inventory')
  assert.equal(resource.id,'test.revenue_check');assert.equal(resource.kind,'test');assert.equal(resource.sourceExpression,JSON.stringify({sql:sql.content}));assert.equal(resource.definition.sql,sql.content);assert.deepEqual(resource.dependencies,['model.sales'])
  assert.ok(plan.project.report.issues.some(i=>i.code==='dbt_resource_execution_pending'&&i.file===sql.path&&i.object===resource.id&&i.sourceExpression===JSON.stringify({sql:sql.content})),'Unsupported uploaded SQL retains its diagnostic')
  if(suffix==='resolved')assert.deepEqual(inventory.find(r=>r.id==='model.synthetic_bifocal.sales').dependencies,['source.synthetic_bifocal.raw.invoices'])
  await apply(input.projectId,plan)
  const imported=await call('/model-imports/'+input.projectId)
  assert.equal(imported.report.compatible,false);assert.deepEqual(imported.report.project.resources,inventory);assert.deepEqual(imported.report.issues,plan.project.report.issues);assert.deepEqual(imported.input.files,input.files)
  const exported=await call('/model-authoring/format',{document:dump(imported.definition),importProject:input.projectId,importRevision:imported.revision},409)
  assert.equal(exported.error,'exact_compatible_project_required','Untranslated SQL cannot be exported as native YAML')
  if(suffix==='empty'){
   await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor()
   assert.match(await page.getByRole('table',{name:'Source project inventory'}).innerText(),/test.revenue_check/);assert.match(await page.locator('#model-import-current').innerText(),/dbt_resource_execution_pending/);assert.equal(await page.getByRole('link',{name:'Review imported model',exact:true}).count(),0)
   await proveScreen('dbt-manifest-sql-retained')
  }
  await call('/model-authoring/review',{document:dump(imported.definition),importProject:input.projectId,importRevision:imported.revision},409)
  dbtProjects.push({input,plan})
 }
