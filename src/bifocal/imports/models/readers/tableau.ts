import { DOMParser, type Element } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import { issue, provenance } from './common'
import type { Dimension, ModelTable, Project, ProjectFile, ProjectResource } from './types'

export function readTableau(p: Project, files: ProjectFile[]) {
 const resources: ProjectResource[] = [], documents: ProjectFile[] = []
 for (const file of files) {
  const at = provenance(file, '')
  if (/\.(twb|tds)$/i.test(file.path)) { documents.push(file); continue }
  if (!/\.twbx$/i.test(file.path)) { issue(p, at, file.path, 'unsupported_tableau_file', 'Supply textual TWB or TDS definitions, or a base64 TWBX archive.'); continue }
  let bytes = 0, entries = 0, unsafe = false
  try {
   if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content) || file.content.length % 4) throw Error('base64')
   const archive = Uint8Array.from(atob(file.content), c => c.charCodeAt(0))
   const extracted = unzipSync(archive, {filter(entry) {
    if (entry.name.endsWith('/')) return false
    bytes += entry.originalSize; entries++
    if (bytes > 1048576 || entries > 64 || entry.originalSize > 262144 || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').some(part => !part || part === '.' || part === '..') || /[:\u0000-\u001f]/.test(entry.name)) { unsafe = true; return false }
    if (!/\.(twb|tds)$/i.test(entry.name)) { issue(p, at, entry.name, 'unsupported_tableau_archive_item', 'The original archive retains this item; extracts and other binary or script content are not loaded or translated.'); return false }
    return true
   }})
   if (unsafe) { issue(p, at, file.path, 'unsafe_tableau_archive', 'Archive paths, expanded sizes and item counts must stay within the project bounds.'); continue }
   for (const [path, content] of Object.entries(extracted)) documents.push({path: file.path + '/' + path, content: strFromU8(content)})
   if (!Object.keys(extracted).length) issue(p, at, file.path, 'tableau_definition_required', 'Include a textual workbook or data source definition in the archive.')
  } catch { issue(p, at, file.path, 'invalid_tableau_archive', 'Supply a valid bounded base64 ZIP archive; nothing is extracted to disk.') }
 }
 for (const file of documents) {
  const at = provenance(file, '')
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(file.content)) { issue(p, at, file.path, 'tableau_active_xml', 'DTD and entity declarations are refused.'); continue }
  let root: Element
  try {
   root = new DOMParser({onError: () => { throw Error('xml') }}).parseFromString(file.content, 'application' + '/' + 'xml').documentElement!
   if (!root || !['workbook','datasource'].includes(root.tagName) || root.getElementsByTagName('*').length > 10000) throw Error('root')
  } catch { issue(p, at, file.path, 'invalid_tableau_xml', 'Supply a well-formed workbook or data source with at most 10,000 elements.'); continue }
  const children=(element:Element)=>Array.from(element.childNodes).filter((n):n is Element=>n.nodeType===1)
  const attributes=(element:Element,allowed:string[])=>{for(const attribute of Array.from(element.attributes))if(!allowed.includes(attribute.name))issue(p,provenance(file,element.toString()),element.tagName+'.'+attribute.name,'unsupported_tableau_property','Translate this source property before publication.')}
  attributes(root,root.tagName==='datasource'?['name','version','caption']:['version'])
  for(const child of children(root))if(!(root.tagName==='datasource'?['column','connection']:['datasources','worksheets','dashboards','stories']).includes(child.tagName))issue(p,provenance(file,child.toString()),child.tagName,'unsupported_tableau_property','This workbook or source element requires explicit translation.')
  if(root.tagName==='workbook')for(const container of children(root)){
   attributes(container,[])
   const expected=({datasources:'datasource',worksheets:'worksheet',dashboards:'dashboard',stories:'story'} as Record<string,string>)[container.tagName]
   for(const child of children(container))if(child.tagName!==expected)issue(p,provenance(file,child.toString()),child.tagName,'unsupported_tableau_property','Translate every workbook container item before publication.')
  }
  const dataSources = root.tagName === 'datasource' ? [root] : Array.from(root.getElementsByTagName('datasource')).filter(e => e.parentNode?.nodeName === 'datasources')
  for (const ds of dataSources) {
   const name = ds.getAttribute('name'), source = provenance(file, ds.toString())
   if (!name) { issue(p, source, file.path, 'tableau_datasource_name', 'Each data source needs its original name.'); continue }
   const id = `datasource.${name}`
   if (resources.some(r => r.id === id)) issue(p, source, id, 'duplicate_tableau_datasource', 'Resolve duplicate source identities.')
   const columns = Array.from(ds.getElementsByTagName('column')).filter(e => e.parentNode === ds)
   resources.push({...source, id, name, kind: 'tableau-datasource', definition: {xml: ds.toString()}, dependencies: []})
   const table:ModelTable={...source,name,sourceTable:null,dimensions:[],measures:[]};p.tables.push(table)
   attributes(ds,['name','version','caption'])
   for(const child of children(ds))if(!['column','connection'].includes(child.tagName))issue(p,provenance(file,child.toString()),id,'unsupported_tableau_property','Filters, joins, restrictions and other source elements require translation.')
   const connections=children(ds).filter(e=>e.tagName==='connection')
   if(connections.length!==1)issue(p,source,id,'tableau_source_execution_pending','Map one explicit textscan table; other connection graphs require translation.')
   for(const connection of connections){
    attributes(connection,['class'])
    const relations=children(connection)
    if(connection.getAttribute('class')!=='textscan'||relations.length!==1||relations[0].tagName!=='relation'||relations[0].getAttribute('type')!=='table'||children(relations[0]).length||!relations[0].getAttribute('table'))issue(p,source,id,'tableau_source_execution_pending','Only a single literal textscan table can bind to reviewed native records.')
    else{attributes(relations[0],['type','table']);table.sourceTable=relations[0].getAttribute('table')}
   }
   p.explores.push({...source, name, table: name, joins: []})
   for (const column of columns) {
    const columnName = column.getAttribute('name')
    if (!columnName) { issue(p, source, id, 'tableau_column_name', 'Each source column needs its original name.'); continue }
    attributes(column,['name','datatype','role','type','caption'])
    const parsed=/^\[((?:[^\]]|\]\])+)\]$/.exec(columnName),field=parsed?.[1].replace(/\]\]/g,']'),calculations=children(column).filter(c=>c.tagName==='calculation'),at=provenance(file,column.toString())
    for(const child of children(column))if(child.tagName!=='calculation')issue(p,at,id+'.'+columnName,'unsupported_tableau_property','Translate every column property before publication.')
    if(!field)issue(p,at,id,'unsupported_tableau_column','Use an original bracketed physical column name.')
    else if(calculations.length){
     const expression=calculations[0].getAttribute('formula')??'',match=/^(SUM|COUNTD)\s*\(\s*\[((?:[^\]]|\]\])+)\]\s*\)$/i.exec(expression)
     attributes(calculations[0],['class','formula'])
     if(calculations.length!==1||calculations[0].getAttribute('class')!=='tableau'||!match||children(calculations[0]).length)issue(p,at,id+'.'+field,'unsupported_tableau_calculation','Only SUM and COUNTD of one physical column are translated; other expressions remain unresolved.')
     else table.measures.push({...at,name:field,column:match[2].replace(/\]\]/g,']'),op:match[1].toUpperCase()==='SUM'?'sum':'count-distinct',sourceExpression:expression})
    }else{
     const sourceType=column.getAttribute('datatype')??'',type=({string:'text',integer:'number',real:'number',boolean:'boolean',date:'date'} as Record<string,Dimension['type']>)[sourceType]
     if(!type)issue(p,at,id+'.'+field,'unsupported_tableau_type','Translate this source type explicitly.')
     else table.dimensions.push({...at,name:field,column:field,type,sourceType,primaryKey:false,sourceExpression:columnName})
    }
    resources.push({...provenance(file, column.toString()), id: `${id}.${columnName}`, name: columnName, kind: 'tableau-column', definition: {xml: column.toString(), calculations: Array.from(column.getElementsByTagName('calculation')).map(c => c.getAttribute('formula'))}, dependencies: [id]})
   }
   for(const measure of table.measures){const dimension=table.dimensions.find(d=>d.column===measure.column);if(!dimension||measure.op==='sum'&&!['number','money'].includes(dimension.type))issue(p,measure,id+'.'+measure.name,'unresolved_tableau_column','Bind a declared compatible physical column for this aggregate.')}
   issue(p,source,name,'source_table_binding','Bind the original source table to reviewed native records; no connection is fetched.')
  }
  for (const tag of ['worksheet','dashboard','story']) for (const item of Array.from(root.getElementsByTagName(tag))) {
   const name = item.getAttribute('name') ?? '', dependencies = Array.from(item.getElementsByTagName('datasource-dependencies')).map(d => `datasource.${d.getAttribute('datasource')}`)
   const source = provenance(file, item.toString())
   resources.push({...source, id: `${tag}.${name}`, name, kind: `tableau-${tag}`, definition: {xml: item.toString()}, dependencies: [...new Set(dependencies)]})
   issue(p, source, `${tag}.${name}`, 'tableau_content_translation_pending', 'Source layout, filters and interactions are retained and are not counted as translated.')
  }
 }
 for (const resource of resources) for (const dependency of resource.dependencies) if (!resources.some(r => r.id === dependency)) issue(p, resource, resource.id, 'missing_tableau_dependency', `Include ${dependency}; no source definition is fetched.`)
 p.resources = resources
}
