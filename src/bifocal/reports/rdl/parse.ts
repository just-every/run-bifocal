import { Buffer } from 'node:buffer'
import { DOMParser, type Element } from '@xmldom/xmldom'
import { translateFormula } from '../../imports/calculations'
import type { CalculationExpr } from '../../calculations/core'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'

type File = { path: string; content: string; originalBase64?: string }
export type RdlNode = { location: string; name: string; namespace: string; attributes: Record<string,string>; text: string; children: RdlNode[]; expression?: CalculationExpr }
type Issue = { location: string; code: string; reason: string; dependency: string; resolution: string }
type Entry = { location: string; name: string; disposition: 'retained'|'translated'|'unsupported'; expression?: CalculationExpr }
type Subscription = { id: string; destinationReference: string; parameters: Record<string,string>; schedule: string; securityScope: string; active: false }
export type RdlProject = { ownerId: string; input: { version: 1; reportId: string; root: string; files: File[]; subscriptions: Omit<Subscription,'active'>[] }; digest: string; definition: { version: 1; kind: 'paginated-draft'; root: string; reports: { file: string; tree: RdlNode }[]; subscriptions: Subscription[]; active: false }; report: { elements: Entry[]; issues: Issue[]; switchReady: false; execution: 'unavailable'; pageReconciliation: 'pending' } }
const namespaces = new Set(['http://schemas.microsoft.com/sqlserver/reporting/2008/01/reportdefinition','http://schemas.microsoft.com/sqlserver/reporting/2010/01/reportdefinition','http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition'])
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k))
const string=(v:unknown,max=512):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
const safePath=(v:unknown):v is string=>string(v,200)&&!v.startsWith('/')&&!/[\\:#?]/.test(v)&&v.split('/').every(p=>!!p&&!['.','..','__proto__','constructor','prototype'].includes(p))&&/\.rdlx?$/i.test(v)
// Retention is inventory, never a claim that the native renderer implements it.
const retained=new Set(('Report Description Author AutoRefresh InitialPageName Language ConsumeContainerWhitespace DataSources DataSource DataSourceReference ConnectionProperties DataProvider ConnectString IntegratedSecurity DataSets DataSet Query DataSourceName CommandType CommandText QueryParameters QueryParameter Fields Field DataField ReportParameters ReportParameter DataType Nullable AllowBlank Prompt Hidden MultiValue UsedInQuery DefaultValue Values Value ValidValues ParameterValues ParameterValue Label DataSetReference DataSetName ValueField LabelField ReportSections ReportSection Body ReportItems Height Width Page PageHeight PageWidth LeftMargin RightMargin TopMargin BottomMargin Columns ColumnSpacing PageHeader PageFooter PrintOnFirstPage PrintOnLastPage Textbox CanGrow CanShrink KeepTogether HideDuplicates Paragraphs Paragraph TextRuns TextRun Style FontFamily FontSize FontStyle FontWeight Format Color BackgroundColor TextAlign VerticalAlign PaddingLeft PaddingRight PaddingTop PaddingBottom Border BorderStyle BorderColor BorderWidth Top Left Visibility ToggleItem Rectangle Line Tablix TablixBody TablixColumns TablixColumn TablixRows TablixRow TablixCells TablixCell CellContents TablixCorner TablixCornerRows TablixCornerRow TablixCornerCells TablixCornerCell TablixColumnHierarchy TablixRowHierarchy TablixMembers TablixMember TablixHeader Size Group GroupExpressions GroupExpression SortExpressions SortExpression Direction RepeatOnNewPage KeepWithGroup FixedData PageBreak BreakLocation Disabled ResetPageNumber Subreport ReportName Parameters Parameter Omit NoRowsMessage Filters Filter FilterExpression Operator FilterValues FilterValue').split(' '))

/** XML is data. No queries, code, external references or subscription sends run. */
export function compileRdl(value:unknown,id:string,ownerId:string):RdlProject {
 if(!object(value)||!keys(value,['version','reportId','root','files','subscriptions'])||value.version!==1||value.reportId!==id||!safePath(value.root)||!Array.isArray(value.files)||!value.files.length||value.files.length>16||!Array.isArray(value.subscriptions)||value.subscriptions.length>100)throw Error('RDL_ENVELOPE: Supply a bounded RDL project with an explicit root and inactive subscriptions.')
 const files:File[]=value.files.map(f=>{
  if(!object(f)||!keys(f,['path','content','originalBase64'])||!safePath(f.path)||!string(f.content,262144))throw Error('RDL_FILE: Use safe relative RDL paths and XML text of at most 256 KiB.')
  if(f.originalBase64!==undefined){
   if(!string(f.originalBase64,699052))throw Error('RDL_ORIGINAL: Original bytes exceed the file bound.')
   const bytes=Buffer.from(f.originalBase64,'base64'),encoding=bytes[0]===255&&bytes[1]===254||bytes[0]===60&&bytes[1]===0?'utf-16le':bytes[0]===254&&bytes[1]===255||bytes[0]===0&&bytes[1]===60?'utf-16be':'utf-8'
   let decoded;try{decoded=new TextDecoder(encoding,{fatal:true}).decode(bytes)}catch{throw Error('RDL_ENCODING: Use valid UTF-8 or UTF-16 XML.')}
   if(bytes.length>524288||bytes.toString('base64')!==f.originalBase64||decoded!==f.content)throw Error('RDL_ORIGINAL: The preserved bytes must exactly decode to the reviewed XML.')
  }
  return {path:f.path,content:f.content,...f.originalBase64===undefined?{}:{originalBase64:f.originalBase64}}
 })
 if(new Set(files.map(f=>f.path)).size!==files.length||!files.some(f=>f.path===value.root)||new TextEncoder().encode(canonicalJson(value)).length>786432)throw Error('RDL_BUNDLE: Duplicate, missing root or oversized project.')
 const subscriptions:Subscription[]=value.subscriptions.map(s=>{if(!object(s)||!keys(s,['id','destinationReference','parameters','schedule','securityScope'])||!string(s.id,64)||!string(s.destinationReference,200)||!string(s.schedule,200)||!string(s.securityScope,200)||!object(s.parameters)||Object.keys(s.parameters).length>100||Object.entries(s.parameters).some(([k,v])=>!string(k,100)||!string(v,200)))throw Error('RDL_SUBSCRIPTION: Preserve only inactive destination references, parameter mappings, schedule and security scope.');return {id:s.id,destinationReference:s.destinationReference,parameters:s.parameters as Record<string,string>,schedule:s.schedule,securityScope:s.securityScope,active:false}})
 if(new Set(subscriptions.map(s=>s.id)).size!==subscriptions.length)throw Error('RDL_SUBSCRIPTION: Subscription IDs must be unique.')
 const elements:Entry[]=[],issues:Issue[]=[],references:{from:string;to:string;location:string}[]=[]
 const issue=(location:string,code:string,reason:string,dependency:string,resolution:string)=>issues.push({location,code,reason,dependency,resolution})
 const reports=files.map(file=>{
  if(/<!\s*(DOCTYPE|ENTITY)|<\?(?!xml(?:\s|\?))/i.test(file.content))throw Error('RDL_ACTIVE_XML: DTDs, entities and processing instructions are refused.')
  // Bound before parsing, then bound the actual tree before recursing.
  if((file.content.match(/</g)??[]).length>12000)throw Error('RDL_XML_LIMIT: Too many XML nodes.')
  let document
  try{document=new DOMParser({onError:()=>{throw Error('invalid XML')}}).parseFromString(file.content,'application/xml')}catch{throw Error('RDL_XML: Repair malformed XML.')}
  const root=document.documentElement
  if(!root||root.localName!=='Report'||!namespaces.has(root.namespaceURI??''))throw Error('RDL_NAMESPACE: Supply an RDL 2008, 2010 or 2016 Report. Other RDLX dialects require a faithful reader.')
  const reportNamespace=root.namespaceURI
  const stack=[{node:root,depth:0}];let count=0
  while(stack.length){const {node,depth}=stack.pop()!;if(++count>10000||depth>64)throw Error('RDL_XML_LIMIT: Too many nodes or excessive nesting.');for(const child of Array.from(node.childNodes))if(child.nodeType===1)stack.push({node:child as Element,depth:depth+1})}
  const fields:Record<string,string>=Object.fromEntries(Array.from(root.getElementsByTagNameNS(root.namespaceURI!,'Field')).map(f=>[f.getAttribute('Name')??'',f.getAttribute('Name')??'']).filter(([name])=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
  const parameters=new Set(Array.from(root.getElementsByTagNameNS(root.namespaceURI!,'ReportParameter')).map(p=>p.getAttribute('Name')))
  function visit(el:Element,location:string):RdlNode {
   const name=el.localName??el.tagName,namespace=el.namespaceURI??'',attributes=Object.fromEntries(Array.from(el.attributes).map(a=>[a.name,a.value])),children=Array.from(el.childNodes).filter((n):n is Element=>n.nodeType===1),text=Array.from(el.childNodes).filter(n=>n.nodeType===3||n.nodeType===4).map(n=>n.nodeValue??'').join('')
   const node:RdlNode={location,name,namespace,attributes,text,children:[]},entry:Entry={location,name,disposition:'retained'};elements.push(entry)
   if(!retained.has(name)||namespace!==reportNamespace){entry.disposition='unsupported';issue(location,'unsupported_element','This source element is retained without a native implementation.',name,'Implement and reconcile this element before accepting the switch.')}
   if(['Code','CodeModules','CodeModule','Classes','Class','EmbeddedImages','Image'].includes(name)){entry.disposition='unsupported';issue(location,'quarantined_content','Custom code, binaries and images are retained inert and never executed or fetched.',name,'Provide a faithful safe implementation or approved equivalent.')}
   if(['Password','UserName'].includes(name)||name==='ConnectString'&&/(?:password|pwd|token|secret|user\s*id)\s*=/i.test(text))throw Error('RDL_CREDENTIALS: Remove embedded credentials before importing the definition.')
   if(['CommandText','DataProvider','DataSourceReference','ConnectString'].includes(name)){entry.disposition='unsupported';issue(location,'source_binding_required','The source reference or query is inert; no provider is contacted and no query is executed.',text,'Bind and reconcile an authorized native source query before rendering.')}
   if(name==='ReportName'&&el.parentNode?.nodeType===1&&(el.parentNode as Element).localName==='Subreport'){
    const target=text.trim(),folder=file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')+1):'',path=folder+target+( /\.rdlx?$/i.test(target)?'':'.rdl')
    references.push({from:file.path,to:path,location})
    if(!safePath(path)||!files.some(f=>f.path===path)){entry.disposition='unsupported';issue(location,'external_subreport','The referenced subreport is not supplied in this project and is never fetched.',target,'Supply the authorized relative subreport file and reconcile its parameter mapping.')}
   }
   if(text.trim().startsWith('=')&&!children.length&&!['CommandText','ConnectString','Code'].includes(name)){
    const original=text.trim(),expression=original.slice(1),parameter=/^Parameters!([A-Za-z_][A-Za-z0-9_]*)\.Value$/.exec(expression)
    let target:CalculationExpr|null=null
    if(parameter&&parameters.has(parameter[1]))target={kind:'parameter',name:parameter[1]}
    else if(/^(?:Fields![A-Za-z_][A-Za-z0-9_]*\.Value|(?:Sum|Min|Max)\(Fields![A-Za-z_][A-Za-z0-9_]*\.Value\)|-?\d+(?:\.\d+)?)$/i.test(expression)){
     const translated=translateFormula('dax',expression.replace(/Fields!([A-Za-z_][A-Za-z0-9_]*)\.Value/g,(_,field)=>'['+field+']'),{fields})
     target=translated.targetExpression
    }
    if(target){node.expression=target;entry.expression=target;if(entry.disposition!=='unsupported')entry.disposition='translated'}
    else{entry.disposition='unsupported';issue(location,'unsupported_expression','The expression has no proven exact native translation and remains inert.',original,'Implement its source semantics and assert the result before accepting the switch.')}
   }
   const ordinals=new Map<string,number>()
   node.children=children.map(child=>{const ordinal=(ordinals.get(child.tagName)??0)+1;ordinals.set(child.tagName,ordinal);return visit(child,location+'/'+child.tagName+'['+ordinal+']')})
   return node
  }
  return {file:file.path,tree:visit(root,file.path+':/Report[1]')}
 })
 const cyclic=(start:string,current:string,seen:Set<string>):boolean=>references.some(r=>r.from===current&&(r.to===start||!seen.has(r.to)&&cyclic(start,r.to,new Set([...seen,r.to]))))
 for(const r of references)if(cyclic(r.from,r.to,new Set([r.from,r.to]))){const entry=elements.find(e=>e.location===r.location)!;entry.disposition='unsupported';issue(r.location,'subreport_cycle','Recursive subreports cannot render safely.',r.to,'Remove the cycle or implement a bounded equivalent and reconcile its output.')}
 for(const s of subscriptions)issue('subscriptions:'+s.id,'subscription_reauthorization_required','Imported subscription is inactive and has no send capability.',s.destinationReference,'Review current recipient authority, parameter mappings and policy through BIF-015 and BIF-058 before new issuance.')
 const input={version:1 as const,reportId:id,root:value.root,files,subscriptions:subscriptions.map(({active,...definition})=>definition)}
 return {ownerId,input,digest:sha256(canonicalJson(input)),definition:{version:1,kind:'paginated-draft',root:value.root,reports,subscriptions,active:false},report:{elements,issues,switchReady:false,execution:'unavailable',pageReconciliation:'pending'}}
}
