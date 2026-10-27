import type {readChart} from '../../charts/store.server'
import {chartView} from '../../charts/view'
import {chartPlot} from '../../charts/plot'
import {fail,type Cell,type Value} from '../../query/types'
import type {Scene,Snapshot} from './scene'

type Chart=Awaited<ReturnType<typeof readChart>>
export type ChartSelection={field:string;value:Cell}
const shown=(value:Value,currency:string)=>value.state==='value'?(value.unit==='money'?currency+' ':'')+value.value+(value.unit==='percent'?' %':''):value.state.toUpperCase()
const label=(value:Cell)=>value===null?'NULL':String(value)
const wrapped=(value:string,size=16)=>{
 const limit=Math.floor(1216/(size*.6))
 const lines:string[]=[]
 for(const paragraph of value.split('\n'))for(let i=0;i<Math.max(1,paragraph.length);i+=limit)lines.push(paragraph.slice(i,i+limit))
 return lines
}
/** The browser and native files consume the same permitted, computed view. */
export function chartSnapshotScene(chart:Chart,selection:ChartSelection|undefined,exportedAt:string,backLink:string):Snapshot{
 const view=chartView(chart,selection),pages:Scene[]=[],columns=view.columns.map(c=>c.id)
 const plot=chartPlot(view)
 const add=(scene:Scene,name:string,value:string,y:number,size=16)=>{const lines=wrapped(value,size);scene.shapes.push({kind:'text',label:name,x:32,y,w:1216,h:lines.length*size*1.25,size,lines});return lines.length*size*1.25}
 let y=0
 const page=()=>{
  const scene:Scene={title:chart.title+' · '+(pages.length+1),tab:'chart',shapes:[]};pages.push(scene)
  let top=20
  for(const [name,value,size] of [['Chart title',chart.title,25],['Snapshot state','Retained chart · '+chart.createdAt+' · Exported '+exportedAt,14],['Effective chart selection',selection?'Selection '+selection.field+' = '+label(selection.value):'All permitted result groups',14],['Source query filters',JSON.stringify(chart.definition.filters),14],['Exact chart columns',[view.dimension,...columns].join(' | '),16]] as const)top+=add(scene,name,value,top,size)+12
  if(top>500)fail('chart_snapshot_context_does_not_fit',422)
  add(scene,'Open authenticated chart',backLink,858,14);y=top;return scene
 }
 let scene=page()
 for(const [index,row] of view.rows.entries()){
  const text=[label(row.label),...columns.map(id=>id+': '+shown(row.values[id],chart.context.currency))].join(' | '),height=wrapped(text).length*20+36
  if(height>570)fail('chart_snapshot_row_does_not_fit',422)
  if(y+height>756){scene=page();if(y+height>756)fail('chart_snapshot_row_does_not_fit',422)}
  y+=add(scene,'Exact chart row '+label(row.label),text,y)
  const point=plot.points[index],inside=(n:number)=>n>=0&&n<=600
  if(inside(plot.zero))scene.shapes.push({kind:'rect',label:'Zero baseline',x:64+plot.zero/600*1000,y:y+1,w:1,h:20})
  if(point.start!==null&&point.end!==null){
   const isPoint=view.mark==='point'||point.start===point.end
   if(isPoint&&inside(point.end))scene.shapes.push({kind:'ellipse',label:'Plot '+text,x:64+point.end/600*1000-3,y:y+5,w:6,h:6})
   else if(!isPoint){const left=Math.max(0,Math.min(point.start,point.end)),right=Math.min(600,Math.max(point.start,point.end));if(right>left)scene.shapes.push({kind:'rect',label:'Plot '+text,x:64+left/600*1000,y:y+3,w:(right-left)/600*1000,h:14})}
  }
  y+=36
 }
 const totals=(selection?'Full query totals | ':'Total | ')+columns.map(id=>id+': '+shown(view.totals[id],chart.context.currency)).join(' | ')
 if(y+wrapped(totals).length*20>810){scene=page();if(y+wrapped(totals).length*20>810)fail('chart_snapshot_totals_do_not_fit',422)}
 add(scene,'Exact retained query totals',totals,y)
 const provenance={chartId:chart.id,queryId:chart.queryId,definition:chart.definition,visual:chart.visual,context:chart.context,selection:selection??null,view,createdAt:chart.createdAt,exportedAt,backLink}
 return {version:1,id:chart.id,title:chart.title,revision:1,filterState:'current',selection:{tab:'chart',filters:[],fields:{},fiscal:{},whatIf:{}},inherited:{filters:[],fiscal:{}},tabs:['chart'],layout:'readable',exportedAt,backLink,pages,provenance}
}
