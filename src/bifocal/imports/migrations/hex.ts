import { Buffer } from 'node:buffer'
import { JSON_SCHEMA, load } from 'js-yaml'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { assertMigrationSafe, migrationRefusal } from './safety'
import type { InventoryItem } from './compile'

// Supported published format snapshot, retrieved 4 November 2026. No network fetch occurs at import time.
export const HEX_SCHEMA={url:'https://static.hex.site/hex-file-schema.json',version:3,sha256:'39e195b7848461f52260c2e3d0e8f599faa92f6f89737cf85913cdd772da2026'}
export type HexIssue={location:string;code:string;remediation:string}
export type HexInventory={filename:string;sha256:string;schema:typeof HEX_SCHEMA;projectId:string|null;sourceVersionId:string|null;cellOrder:string[];layoutReferences:{location:string;cellId:string}[];issues:HexIssue[];outputs:'unverified';dependencies:'incomplete';execution:'disabled'}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)
const identity=(v:unknown,path:string)=>{if(!uuid(v))throw migrationRefusal('hex_stable_identifier_required',path);return v}
const hash=(v:unknown)=>sha256(canonicalJson(v))
const configKeys:Record<string,string[]>={
 SQL:['allowDuplicateColumns','castDecimals','dataConnectionId','dataFrameCell','enablePreview','outputFilteredResult','resultVariableName','source','sqlCellOutputType','tableDisplayConfig','useNativeDates','useQueryMode','useRichDisplay'],
 CODE:['source'],MARKDOWN:['source'],TEXT:['richText'],
 CHART:['defaultInputTimezone','height','metadata','selectedLayerIndex','vegaSpec'],
 CHARTV2:['chartSelection','chartSpec','colorMappings','displayTableConfig','displayType','height','outputResult','resultVariable'],
 INPUT:['defaultValue','inputType','name','options','outputType'],
}
/** Data-only bounded reader, deliberately no execution, fetch, package resolution or imported authority. */
export function readHex(value:Record<string,unknown>){
 if(value.version!==1||value.source!=='hex'||value.format!=='hex-yaml')throw migrationRefusal('hex_envelope_required')
 if(typeof value.filename!=='string'||!/^[-A-Za-z0-9_. ]{1,120}\.hex\.ya?ml$/i.test(value.filename)||typeof value.base64!=='string'||value.base64.length>349528)throw migrationRefusal('hex_file_required')
 const bytes=Buffer.from(value.base64,'base64')
 if(bytes.toString('base64')!==value.base64||!bytes.length||bytes.length>262144)throw migrationRefusal('hex_file_limit')
 let document:string,root:unknown,depth=0
 try{
  document=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  assertMigrationSafe(document)
  // Inspect parser anchors, not scalar text: Python unpacking and Markdown emphasis are ordinary source.
  // Refuse an anchored scalar at close, or a collection before its first child can resolve an alias.
  root=load(document,{schema:JSON_SCHEMA,listener(event,state){
   const graph=state as typeof state & {anchor:string|null;anchorMap:Record<string,unknown>}
   if(Object.keys(graph.anchorMap).length||event==='close'&&graph.anchor!==null)throw Error('alias')
   if(event==='open'&&++depth>48)throw Error('depth');if(event==='close')depth--
  }})
 }catch(error){if(error instanceof Error&&error.message==='migration_secret_refused')throw error;throw migrationRefusal('hex_yaml_required')}
 assertMigrationSafe(root)
 if(!record(root)||root.schemaVersion!==3||!record(root.meta)||typeof root.meta.title!=='string'||!['PYTHON','R'].includes(String(root.meta.codeLanguage))||!Array.isArray(root.cells)||!root.cells.length||root.cells.length>90)throw migrationRefusal('hex_schema_v3_required')
 const issues:HexIssue[]=[],layoutReferences:HexInventory['layoutReferences']=[]
 const issue=(location:string,code:string,remediation:string)=>{if(issues.length>=500)throw migrationRefusal('hex_issue_limit');issues.push({location,code,remediation})}
 const unknown=(v:Record<string,unknown>,allowed:string[],path:string)=>{for(const key of Object.keys(v))if(!allowed.includes(key))issue(path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'),'unsupported_property','Reconstruct this property explicitly and reconcile it before any cutover.')}
 unknown(root,['schemaVersion','meta','projectAssets','sharedAssets','cells','appLayout','dataAppCellIds','genAppFiles','sharedFilters'],'')
 unknown(root.meta,['allowExecutionReordering','appTheme','autoRerunApp','cachePublishedAppState','castDecimalsDefault','categories','codeLanguage','description','hexType','kernelImage','kernelSize','logicQueryCacheTimeout','prerunApp','projectId','publishedQueryCacheTimeout','refreshStalePublishedApp','sourceVersionId','status','timezone','title'],'/meta')
 const projectId=root.meta.projectId===undefined?null:identity(root.meta.projectId,'/meta/projectId'),sourceVersionId=root.meta.sourceVersionId===undefined?null:identity(root.meta.sourceVersionId,'/meta/sourceVersionId')
 if(!sourceVersionId)issue('/meta/sourceVersionId','missing_source_version','Supply the original version identifier; the file digest identifies only these bytes.')
 if(root.meta.codeLanguage!=='PYTHON')issue('/meta/codeLanguage','unsupported_language','Reconstruct the R environment separately; no imported language executes.')
 const cellOrder:string[]=[],items:InventoryItem[]=[]
 for(const [index,cell]of root.cells.entries()){
  const path='/cells/'+index
  if(!record(cell)||!record(cell.config))throw migrationRefusal('hex_cell_required',path)
  const cellId=identity(cell.cellId,path+'/cellId')
  if(cellOrder.includes(cellId))throw migrationRefusal('hex_duplicate_cell',path+'/cellId')
  cellOrder.push(cellId)
  unknown(cell,['cellId','cellLabel','cellType','config'],path)
  if(typeof cell.cellType!=='string')throw migrationRefusal('hex_cell_type_required',path+'/cellType')
  const keys=configKeys[cell.cellType]
  if(!keys)issue(path+'/cellType','unsupported_cell_type','Reconstruct this cell in an approved native form and reconcile its consumers; its original definition remains inactive.')
  else unknown(cell.config,keys,path+'/config')
  if(['SQL','CODE','MARKDOWN'].includes(cell.cellType)&&typeof cell.config.source!=='string')throw migrationRefusal('hex_cell_source_required',path+'/config/source')
  if(cell.cellType==='TEXT'&&!Array.isArray(cell.config.richText))throw migrationRefusal('hex_rich_text_required',path+'/config/richText')
  if(cell.cellType==='INPUT'&&(!['TEXT_INPUT','NUMERIC_INPUT','DROPDOWN','TABLE','SLIDER','DATE','BUTTON','CHECKBOX','MULTISELECT','FILE_UPLOAD'].includes(String(cell.config.inputType))||typeof cell.config.name!=='string'||!['STRING','NUMBER','DATA_FRAME','DATETIME','BOOLEAN','DYNAMIC','LIST_STRING','LIST_NUMBER'].includes(String(cell.config.outputType))))throw migrationRefusal('hex_input_required',path+'/config')
  if(cell.cellType==='CHARTV2'&&!record(cell.config.chartSpec))throw migrationRefusal('hex_chart_spec_required',path+'/config/chartSpec')
  if(cell.cellType==='CODE'){
   issue(path+'/config/source','dynamic_dependencies_unresolved','Review the full Python dependency graph and lock the environment and external dependencies under BIF-057 and BIF-058. Static imports cannot establish completeness.')
   const source=String(cell.config.source)
   for(const [lineIndex,line]of source.split('\n').entries())if(/^\s*(?:from\s+[\w.]+\s+import\b|import\s+\w+|[!%](?:pip|conda))/.test(line))issue(path+'/config/source:line-'+(lineIndex+1),'unsupported_package','Review this import or package directive and supply an approved locked dependency; nothing is installed or executed.')
  }
  if(cell.cellType==='SQL')issue(path+'/config','sql_bindings_unresolved','Reauthorize the declared connection and bind permitted native data before reconciling a fresh run; this source never executes.')
  if(['CHART','CHARTV2'].includes(cell.cellType))issue(path+'/config','chart_dependencies_unresolved','Resolve chart variable bindings and compare app filters and layout against an authorized same-snapshot result.')
  const original=canonicalJson(cell)
  if(original.length>65536)throw migrationRefusal('hex_cell_limit',path)
  items.push({id:'cell-'+cellId.toLowerCase(),kind:'cell',sourceRevision:hash({cell,position:index}),original,mapping:'Inactive Hex '+cell.cellType+' definition at '+path,gap:'Requires native reconstruction and same-snapshot reconciliation; no execution or authority.'})
 }
 const walk=(v:unknown,path:string):void=>{
  if(Array.isArray(v)){v.forEach((x,i)=>walk(x,path+'/'+i));return}
  if(!record(v))return
  for(const [key,x]of Object.entries(v)){
   const at=path+'/'+key.replaceAll('~','~0').replaceAll('/','~1')
   if(['cellId','chartCellId','sqlCellId','staticCellId'].includes(key)&&typeof x==='string'){
    layoutReferences.push({location:at,cellId:x})
    if(!cellOrder.includes(x))issue(at,'missing_referenced_cell','Supply the referenced stable cell definition or explicitly remove this reference after reviewing every consumer.')
   }
   walk(x,at)
  }
 }
 // Keep every supported grid reference at its actual source pointer, including unresolved ones.
 if(root.appLayout!==undefined){
  const layout=root.appLayout
  if(!record(layout)||!Array.isArray(layout.tabs))throw migrationRefusal('hex_layout_required','/appLayout')
  unknown(layout,['fullWidth','tabs','visibleMetadataFields'],'/appLayout')
  layout.tabs.forEach((tab,t)=>{
   const at='/appLayout/tabs/'+t
   if(!record(tab)||typeof tab.name!=='string'||!Array.isArray(tab.rows))throw migrationRefusal('hex_layout_required',at)
   unknown(tab,['name','rows'],at)
   tab.rows.forEach((row,r)=>{
    const path=at+'/rows/'+r
    if(!record(row)||!Array.isArray(row.columns))throw migrationRefusal('hex_layout_required',path)
    unknown(row,['columns'],path)
    row.columns.forEach((column,c)=>{
     const location=path+'/columns/'+c
     if(!record(column)||!Array.isArray(column.elements)||!Number.isInteger(column.start)||!Number.isInteger(column.end)||Number(column.start)<0||Number(column.end)>120||Number(column.start)>=Number(column.end))throw migrationRefusal('hex_layout_required',location)
     unknown(column,['start','end','elements'],location)
     column.elements.forEach((element,e)=>{if(!record(element))throw migrationRefusal('hex_layout_required',location+'/elements/'+e);unknown(element,['cellId','explorable','height','hideOutput','sharedFilterId','showLabel','showSource','type'],location+'/elements/'+e)})
    })
   })
  })
 }
 for(const key of ['appLayout','sharedFilters'])walk(root[key],'/'+key)
 root.cells.forEach((cell,index)=>walk((cell as Record<string,unknown>).config,'/cells/'+index+'/config'))
 if(root.dataAppCellIds!==undefined){if(!Array.isArray(root.dataAppCellIds))throw migrationRefusal('hex_layout_required','/dataAppCellIds');for(const [i,x]of root.dataAppCellIds.entries()){if(typeof x!=='string')throw migrationRefusal('hex_layout_required','/dataAppCellIds/'+i);const at='/dataAppCellIds/'+i;layoutReferences.push({location:at,cellId:x});if(!cellOrder.includes(x))issue(at,'missing_referenced_cell','Supply the referenced stable cell definition or explicitly remove this app-data reference after reviewing its consumers.')}}
 for(const section of ['projectAssets','sharedAssets'])if(root[section]!==undefined){
  const assets=root[section];if(!record(assets))throw migrationRefusal('hex_assets_required','/'+section)
  unknown(assets,section==='projectAssets'?['dataConnections','envVars','secrets']:['dataConnections','externalFileIntegrations','secrets','vcsPackages'],'/'+section)
  for(const [kind,entries]of Object.entries(assets)){
   if(!Array.isArray(entries))throw migrationRefusal('hex_assets_required','/'+section+'/'+kind)
   entries.forEach((entry,i)=>{
    if(!record(entry))throw migrationRefusal('hex_assets_required','/'+section+'/'+kind+'/'+i)
    const allowed=kind==='dataConnections'?['dataConnectionId']:kind==='envVars'?['name','value']:kind==='secrets'?['secretName']:kind==='vcsPackages'?['vcsPackageId']:['externalFileIntegrationId']
    if(kind==='secrets'&&Object.keys(entry).some(key=>key!=='secretName'&&entry[key]))throw migrationRefusal('migration_secret_refused','/'+section+'/'+kind+'/'+i)
    if(kind==='dataConnections'&&!uuid(entry.dataConnectionId)||kind==='vcsPackages'&&!uuid(entry.vcsPackageId)||kind==='envVars'&&(typeof entry.name!=='string'||typeof entry.value!=='string')||kind==='secrets'&&typeof entry.secretName!=='string')throw migrationRefusal('hex_assets_required','/'+section+'/'+kind+'/'+i)
    unknown(entry,allowed,'/'+section+'/'+kind+'/'+i)
    issue('/'+section+'/'+kind+'/'+i,kind==='vcsPackages'?'unsupported_package':'inactive_asset_reference','Reauthorize or reconstruct this asset explicitly. Imported references never grant access or load an environment.')
   })
  }
 }
 if(root.genAppFiles!==undefined)issue('/genAppFiles','unsupported_generated_app','Reconstruct the generated app under approved native controls; no imported JavaScript or HTML runs.')
 const metadata={...root};delete metadata.cells
 const original=canonicalJson(metadata)
 if(original.length>65536)throw migrationRefusal('hex_metadata_limit')
 items.unshift({id:'hex-project',kind:'project',sourceRevision:hash(metadata),original,mapping:'Inactive Hex metadata, environment and app layout definitions',gap:'Ownership, review, comment, version restoration, run and notification reconstruction remain unproved.'})
 const hex:HexInventory={filename:value.filename,sha256:sha256(bytes),schema:HEX_SCHEMA,projectId,sourceVersionId,cellOrder,layoutReferences,issues,outputs:'unverified',dependencies:'incomplete',execution:'disabled'}
 return {items,hex}
}
