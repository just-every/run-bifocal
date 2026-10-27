import type {ChartView} from '../../charts/view'
import {nativeGeometry} from '../../charts/geometry'
import type {Scene,PlotPath} from './scene'

/** Native plots use the same ordered points and missing-value segments as the screen. */
export function nativeChartShapes(view:ChartView,top:number,currency:string):Scene['shapes']{
 const shapes:Scene['shapes']=[],geometry=nativeGeometry(view),x=130,y=top+48,w=1080,h=300
 const text=(label:string,value:string,tx:number,ty:number,width=1080,size=14)=>{const limit=Math.floor(width/(size*.6)),lines:string[]=[];for(let i=0;i<Math.max(value.length,1);i+=limit)lines.push(value.slice(i,i+limit));shapes.push({kind:'text',label,x:tx,y:ty,w:width,h:lines.length*size*1.25,size,lines})}
 const unit=view.columns.find(c=>c.id===view.measure)!.unit,names:Record<string,string>={'vertical-bar':'Vertical bars',line:'Line','stepped-line':'Stepped line',area:'Area'}
 const amount=(value:string)=>(unit==='money'?currency+' ':'')+value+(unit==='percent'?' %':'')
 const path=(label:string,points:PlotPath['points'],fill=false)=>shapes.push({kind:'path',label,x,y,w,h,points,closed:fill,fill,strokeWidth:fill?0:2})
 const point=(p:{x:number;y:number})=>({x:x+p.x/600*w,y:y+p.y})
 text('Chart legend',names[view.mark]+' | '+view.measure+' | '+(unit==='money'?currency:unit),32,top,1216)
 if(!view.rows.length){text('Empty chart result','No result groups match this chart.',32,top+32,1216,18);return shapes}
 text('High chart scale',amount(view.scale.reverse?geometry.low:geometry.high),32,y-22,1216)
 text('Low chart scale',amount(view.scale.reverse?geometry.high:geometry.low),32,y+h+42,1216)
 path('Category axis',[{x,y:y+h},{x:x+w,y:y+h}])
 if(geometry.zero>=0&&geometry.zero<=h)path('Zero baseline',[{x,y:y+geometry.zero},{x:x+w,y:y+geometry.zero}])
 if(view.mark==='vertical-bar'){
  const width=Math.min(64,w/view.rows.length*.72)
  for(const p of geometry.points)if(p.y!==null){const px=x+p.x/600*w,py=y+p.y,baseline=y+geometry.zero;if(py===baseline)shapes.push({kind:'ellipse',label:'Zero value row '+(p.index+1),x:px-3,y:py-3,w:6,h:6});else shapes.push({kind:'rect',label:'Vertical bar row '+(p.index+1),x:Math.max(x,px-width/2),y:Math.min(py,baseline),w:Math.min(width,x+w-Math.max(x,px-width/2)),h:Math.abs(py-baseline)})}
 }else{
  for(const [index,segment] of geometry.segments.entries()){
   const points=segment.map(point)
   if(view.mark==='area'&&points.length){const first=points[0],last=points[points.length-1];path('Area segment '+(index+1),[{x:first.x,y:y+geometry.zero},...points,{x:last.x,y:y+geometry.zero}],true)}
   if(points.length>1)path((view.mark==='stepped-line'?'Stepped line':'Line')+' segment '+(index+1),points)
  }
  for(const p of geometry.points)if(p.y!==null){const location=point({x:p.x,y:p.y});shapes.push({kind:'ellipse',label:'Observed point row '+(p.index+1),x:location.x-3,y:location.y-3,w:6,h:6})}
 }
 const interval=Math.max(1,Math.ceil(view.rows.length/12))
 for(const p of geometry.points)if(p.index%interval===0||p.index===view.rows.length-1)text('Category row '+(p.index+1),String(p.index+1),Math.max(x,Math.min(x+w-40,x+p.x/600*w-10)),y+h+10,40)
 text('Missing values',geometry.points.some(p=>p.y===null)?'Missing values remain gaps. Exact states and labels appear in the result rows.':'Exact values and category labels appear in the result rows.',32,y+h+66,1216)
 if(view.order)text('Category ordering',view.order.field+' ordered '+view.order.direction+', missing labels '+view.order.nulls+'. Numbered positions match the exact result rows.',32,y+h+92,1216)
 if(!geometry.points.some(p=>p.y!==null))text('No plottable chart values','No numeric values are available to plot.',x,y+120,1080,18)
 return shapes
}
