import type {runPublishedDashboard} from '../interactions.run.server'
import {fail,type Value} from '../../query/types'
export type Run=Awaited<ReturnType<typeof runPublishedDashboard>>['result']
export type TextBox={kind:'text';x:number;y:number;w:number;h:number;size:number;lines:string[];label:string;link?:string}
export type Picture={kind:'image';x:number;y:number;w:number;h:number;data:string;label:string}
type PlotBounds={x:number;y:number;w:number;h:number;label:string}
export type PlotMark=PlotBounds&({kind:'rect'}|{kind:'ellipse'})
export type Scene={title:string;tab:string;shapes:(TextBox|Picture|PlotMark)[]}
export type Snapshot={version:1;id:string;title:string;revision:number;filterState:'current'|'default';selection:Run['selection'];inherited:Run['inherited'];tabs:string[];layout:'desktop'|'phone'|'readable';exportedAt:string;backLink:string;pages:Scene[];provenance:unknown}
export type PrintableSnapshot=Pick<Snapshot,'pages'|'provenance'|'exportedAt'|'backLink'> & {pageSize?:{width:number;height:number}}
export const WIDTH=1280,HEIGHT=900
const shown=(v:Value)=>v.state==='value'?String(v.value)+(v.unit==='percent'?' %':''):v.state.toUpperCase()
function lines(text:string,width:number,size:number){const result:string[]=[];for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(word.length*size*.6>width)fail('dashboard_snapshot_text_does_not_fit',422);if((line+' '+word).length*size*.6>width){result.push(line);line=word}else line+=(line?' ':'')+word}result.push(line)}return result}
function text(shapes:Scene['shapes'],label:string,value:string,x:number,y:number,w:number,h:number,size=16,link?:string){const wrapped=lines(value,w,size);if(wrapped.length*size*1.25>h)fail('dashboard_snapshot_layout_does_not_fit',422);shapes.push({kind:'text',label,x,y,w,h,size,lines:wrapped,...link?{link}:{}})}
/** Render only the explicitly selected tabs and their visible cards. */
export function snapshotScene(run:Run,options:{tabs:string[];layout:'desktop'|'phone'|'readable';filterState:'current'|'default';exportedAt:string;backLink:string}):Snapshot{
 const {tabs,layout,filterState,exportedAt,backLink}=options,selectedCards=new Set(tabs.flatMap(id=>run.config.tabs.find(t=>t.id===id)!.cards)),cards=run.cards.filter(c=>selectedCards.has(c.key))
 if(cards.some(c=>c.status==='failed'))fail('dashboard_snapshot_selected_tile_failed',409)
 const contexts=[...run.selection.filters.map(f=>'Filter '+f.column+' '+f.op+' '+(Array.isArray(f.value)?f.value.join(', '):String(f.value??'empty'))),...Object.entries(run.selection.fields).map(([id,value])=>'Field '+id+': '+value),...Object.entries(run.selection.fiscal).map(([id,value])=>'Period '+id+': '+value.window+' through '+value.asOf),...Object.entries(run.selection.whatIf).map(([id,value])=>'What-if '+id+': '+value),...run.inherited.filters.map(f=>'Inherited '+f.column+' '+f.op+' '+String(f.value??'empty')),...Object.entries(run.inherited.fiscal).map(([id,value])=>'Inherited period '+id+': '+value.window+' through '+value.asOf)],context=contexts.join(' · ')||'Published default filters',contextHeight=lines(context,1216,14).length*17.5,gridTop=112+contextHeight,gridHeight=780-gridTop
 if(gridHeight<320)fail('dashboard_snapshot_layout_does_not_fit',422)
 const pages=tabs.flatMap(id=>{
  const tab=run.config.tabs.find(t=>t.id===id)!
  if(layout==='readable')return readablePages(run,tab,cards,context,exportedAt,filterState,backLink)
  const shapes:Scene['shapes']=[],placements=[...run.document.layout[layout].filter(p=>tab.cards.includes(p.key)),...run.config.tileLayout[layout].filter(p=>tab.tiles.includes(p.key))].sort((a,b)=>a.y-b.y||a.x-b.x),extent=Math.max(1,...placements.map(p=>p.y+p.h)),columns=layout==='desktop'?12:1
  text(shapes,'Dashboard title',run.title+' · '+tab.label,32,20,1216,40,25)
  text(shapes,'Snapshot state','Published revision '+run.revision+' · '+filterState+' filters · '+exportedAt,32,66,1216,28)
  text(shapes,'Effective filters and parameters',context,32,100,1216,contextHeight+1,14)
  for(const p of placements){const x=32+p.x/columns*1216,y=gridTop+p.y/extent*gridHeight,w=p.w/columns*1216-12,h=p.h/extent*gridHeight-12,card=cards.find(c=>c.key===p.key),tile=run.config.tiles.find(t=>t.key===p.key)
   if(tile){if(tile.kind==='image')shapes.push({kind:'image',x,y,w,h,data:tile.data,label:tile.alt});else text(shapes,'Text tile '+tile.key,tile.text,x,y,w,h);continue}
   if(!card||!('answer' in card)||!card.answer||!card.definition||!card.context)fail('dashboard_snapshot_selected_tile_failed',409)
   const measures=Object.keys(card.answer.totals),rows=[card.key+' · '+card.status+' · '+card.context.currency,'Observed '+card.observedAt,...measures.map(m=>m+': '+shown(card.answer!.totals[m])),[...card.definition.groupBy,...measures].join(' | '),...card.answer.rows.map(row=>[...row.dimensions.map(v=>v===null?'NULL':String(v)),...measures.map(m=>shown(row.values[m]))].join(' | '))]
   if(card.scenario){const formatted=card.scenario.answer.formatted,ids=Object.keys(formatted.totals);rows.push('What-if '+card.scenario.binding.parameter+' = '+card.scenario.binding.value,...ids.map(id=>id+': '+String(formatted.totals[id]??'NULL')),[...card.definition.groupBy,...ids].join(' | '),...formatted.rows.map(row=>[...row.dimensions.map(v=>String(v??'NULL')),...ids.map(id=>String(row.values[id]??'NULL'))].join(' | ')))}
   text(shapes,'Exact results '+card.key,rows.join('\n'),x,y,w,h)
  }
  const versions=cards.filter(c=>tab.cards.includes(c.key)&&'answer' in c&&c.answer).map(c=>'answer' in c&&c.answer&&c.definition?c.key+' model '+c.definition.context.modelVersion+' · '+c.answer.sourceWatermarks.map(s=>s.dataset+' '+s.revision).join(', '):'').join(' · ')
  text(shapes,'Source versions',versions,32,793,1216,54,13)
  text(shapes,'Open authenticated dashboard',backLink,32,855,1216,28,14,backLink)
  return {title:tab.label,tab:id,shapes}
 })
 const provenance={id:run.id,revision:run.revision,filterState,selection:run.selection,inherited:run.inherited,tabs,layout,cards:cards.map(c=>({key:c.key,...'answer' in c?{status:c.status,answer:c.answer,definition:c.definition,context:c.context,observedAt:c.observedAt,...c.scenario?{scenario:c.scenario}:{}}:{}}))}
 return {version:1,id:run.id,title:run.title,revision:run.revision,filterState,selection:run.selection,inherited:run.inherited,tabs,layout,exportedAt,backLink,pages,provenance}
}

/** Explicit alternate layout keeps text at 16px and repeats context on every
 * page. Table rows remain whole; an indivisible oversized row refuses. */
function readablePages(run:Run,tab:Run['config']['tabs'][number],cards:Run['cards'],context:string,exportedAt:string,filterState:string,backLink:string):Scene[]{
 const pages:Scene[]=[],bodyTop=112+lines(context,1216,14).length*17.5,bodyHeight=780-bodyTop
 const page=(label:string)=>{
  const shapes:Scene['shapes']=[]
  text(shapes,'Dashboard title',run.title+' · '+tab.label,32,20,1216,40,25)
  text(shapes,'Snapshot state','Published revision '+run.revision+' · '+filterState+' filters · '+exportedAt,32,66,1216,28)
  text(shapes,'Effective filters and parameters',context,32,100,1216,bodyTop-111,14)
  const versions=cards.filter(c=>tab.cards.includes(c.key)&&'answer' in c&&c.answer).map(c=>'answer' in c&&c.answer&&c.definition?c.key+' model '+c.definition.context.modelVersion+' · '+c.answer.sourceWatermarks.map(s=>s.dataset+' '+s.revision).join(', '):'').join(' · ')
  text(shapes,'Source versions',versions,32,793,1216,54,13)
  text(shapes,'Open authenticated dashboard',backLink,32,855,1216,28,14,backLink)
  const scene={title:tab.label+' · '+label,tab:tab.id,shapes};pages.push(scene);return scene
 }
 const blocks=(label:string,heading:string[],rows:string[])=>{
  const prefix=heading.flatMap(value=>lines(value,1216,16)),capacity=Math.floor(bodyHeight/20)-prefix.length
  if(capacity<1)fail('dashboard_snapshot_layout_does_not_fit',422)
  let current:string[]=[]
  const flush=()=>{const scene=page(label+' · page '+(pages.length+1));text(scene.shapes,label,[...prefix,...current].join('\n'),32,bodyTop,1216,bodyHeight);current=[]}
  for(const row of rows){const wrapped=lines(row,1216,16);if(wrapped.length>capacity)fail('dashboard_snapshot_row_does_not_fit',422);if(current.length+wrapped.length>capacity)flush();current.push(...wrapped)}
  if(current.length||!rows.length)flush()
 }
 for(const key of tab.cards){
  const card=cards.find(c=>c.key===key)
  if(!card||!('answer' in card)||!card.answer||!card.definition||!card.context)fail('dashboard_snapshot_selected_tile_failed',409)
  const measures=Object.keys(card.answer.totals),heading=[card.key+' · '+card.status+' · '+card.context.currency,'Observed '+card.observedAt,...measures.map(m=>m+': '+shown(card.answer!.totals[m])),[...card.definition.groupBy,...measures].join(' | ')]
  blocks('Exact results '+key,heading,card.answer.rows.map(row=>[...row.dimensions.map(v=>v===null?'NULL':String(v)),...measures.map(m=>shown(row.values[m]))].join(' | ')))
  if(card.scenario){const formatted=card.scenario.answer.formatted,ids=Object.keys(formatted.totals);blocks('What-if '+key,['What-if '+card.scenario.binding.parameter+' = '+card.scenario.binding.value,...ids.map(id=>id+': '+String(formatted.totals[id]??'NULL')),[...card.definition.groupBy,...ids].join(' | ')],formatted.rows.map(row=>[...row.dimensions.map(v=>String(v??'NULL')),...ids.map(id=>String(row.values[id]??'NULL'))].join(' | ')))}
 }
 for(const key of tab.tiles){const tile=run.config.tiles.find(t=>t.key===key)!;if(tile.kind==='text')blocks('Text tile '+key,[],lines(tile.text,1216,16));else page(tile.alt).shapes.push({kind:'image',x:32,y:bodyTop,w:1216,h:bodyHeight,data:tile.data,label:tile.alt})}
 if(!pages.length)page('Empty tab')
 for(const scene of pages)scene.shapes.sort((a,b)=>a.y-b.y||a.x-b.x)
 return pages
}
