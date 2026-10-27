import type {ChartView} from './view'
import {chartPlot} from './plot'

/** The same ordered values produce browser and protected-file geometry. */
export function nativeGeometry(view:ChartView) {
 const plot=chartPlot(view),count=view.rows.length
 const points=plot.points.map((point,index)=>({x:(index+.5)*600/Math.max(1,count),y:point.end===null?null:300-point.end/2,index}))
 const segments:{x:number;y:number}[][]=[]
 let current:{x:number;y:number}[]=[]
 for(const point of points){
  if(point.y===null){if(current.length)segments.push(current);current=[];continue}
  if(view.mark==='stepped-line'&&current.length)current.push({x:point.x,y:current[current.length-1].y})
  current.push({x:point.x,y:point.y})
 }
 if(current.length)segments.push(current)
 return {points,segments,zero:300-plot.zero/2,low:plot.low,high:plot.high}
}
