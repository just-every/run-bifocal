// Self-authored MS-CFB and MS-XLS BIFF8 specimens, derived from the published
// specifications cited in docs/FILE-IMPORT.md. These are not Excel-client files.
const end=0xfffffffe,free=0xffffffff
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b}
const rec=(id,data=Buffer.alloc(0))=>Buffer.concat([u16(id),u16(data.length),data])
const unicode=value=>Buffer.concat([u16(value.length),Buffer.from([1]),Buffer.from(value,'utf16le')])
const bof=type=>rec(0x809,Buffer.concat([u16(0x600),u16(type),u16(0x0dbb),u16(0x7cc),u32(0x41),u32(6)]))
const cell=(id,row,col,style,value)=>rec(id,Buffer.concat([u16(row),u16(col),u16(style),value]))
const numeric=(row,col,style,value)=>{const b=Buffer.alloc(8);b.writeDoubleLE(value);return cell(0x203,row,col,style,b)}
function entry(name,type,start,size,child=free,left=free,right=free){
 const b=Buffer.alloc(128);Buffer.from(name+'\0','utf16le').copy(b);b.writeUInt16LE((name.length+1)*2,64);b[66]=type;b[67]=1
 b.writeUInt32LE(left,68);b.writeUInt32LE(right,72);b.writeUInt32LE(child,76);b.writeUInt32LE(start>>>0,116);b.writeUInt32LE(size,120);return b
}
export function legacyWorkbook({mini=false,version=3,formula=false,macro=false,external=false,encryption=false,object=false,unsafe=false,format=false,incomplete=false,oversized=false,continued=false,update=false,packed=false,date1904=false}={}){
 mini ||= incomplete
 const strings=['id','date','amount','active','note','','February values']
 const sst=Buffer.concat([u32(strings.length),u32(strings.length),...strings.map(unicode)])
 let shared=rec(0xfc,sst)
 if(continued){const cut=8+3+2;shared=Buffer.concat([rec(0xfc,sst.subarray(0,cut)),rec(0x3c,Buffer.concat([Buffer.from([1]),sst.subarray(cut)]))])}
 const globals=Buffer.concat([bof(5),rec(0x42,u16(1200)),rec(0x22,u16(date1904?1:0)),... [0,14,format?10:7].map(id=>{const b=Buffer.alloc(20);b.writeUInt16LE(id,2);return rec(0xe0,b)}),shared,...(external?[rec(0x1ae,Buffer.alloc(4))]:[]),...(encryption?[rec(0x2f,Buffer.alloc(6))]:[])])
 const sheet=(second)=>{
  const d=Buffer.alloc(14);d.writeUInt32LE(0);d.writeUInt32LE(oversized?200001:second?2:3,4);d.writeUInt16LE(5,10)
  const records=[bof(0x10),rec(0x200,d),...strings.slice(0,5).map((_,col)=>cell(0xfd,0,col,0,u32(col)))]
  if(packed)records.push(rec(0xbd,Buffer.concat([u16(1),u16(0),u16(0),u32((1<<2)|2),u16(0)])))
  else records.push(cell(0x27e,1,0,0,u32(((second?3:1)<<2)|2)))
  records.push(numeric(1,1,1,date1904?0:second?46054:46037),numeric(1,2,2,unsafe?9007199254740992:second?100:update?0:1234.56),cell(0x205,1,3,0,Buffer.from([1,0])),cell(0xfd,1,4,0,u32(second?6:5)))
  if(!second)records.push(numeric(2,0,0,2),numeric(2,1,1,date1904?1:46038),numeric(2,2,2,-25.5),cell(0x205,2,3,0,Buffer.from([0,0])),cell(0x201,2,4,0,Buffer.alloc(0)))
  if(second&&formula)records.push(cell(0x6,1,4,0,Buffer.alloc(16)))
  records.push(rec(0xa));return Buffer.concat(records)
 }
 const january=sheet(false),february=sheet(true)
 const bound=(name,offset,kind=0)=>rec(0x85,Buffer.concat([u32(offset),Buffer.from([0,kind,name.length,0]),Buffer.from(name,'latin1')]))
 const size=globals.length+bound('January',0).length+bound('February',0).length+4
 let workbook=Buffer.concat([globals,bound('January',size),bound('February',size+january.length,macro?1:0),rec(0xa),january,february])
 if(incomplete)workbook=workbook.subarray(0,workbook.length-1)
 const sectorSize=version===4?4096:512
 if(!mini&&workbook.length<4096)workbook=Buffer.concat([workbook,Buffer.alloc(4096-workbook.length)])
 const units=Math.ceil(workbook.length/64),payload=mini?Buffer.concat([workbook,Buffer.alloc(units*64-workbook.length)]):workbook
 const blocks=Math.ceil(payload.length/sectorSize),miniId=blocks,dirId=blocks+(mini?1:0),fatId=dirId+1
 const header=Buffer.alloc(sectorSize);Buffer.from('d0cf11e0a1b11ae1','hex').copy(header);header.writeUInt16LE(0x3e,24);header.writeUInt16LE(version,26);header.writeUInt16LE(0xfffe,28);header.writeUInt16LE(version===4?12:9,30);header.writeUInt16LE(6,32);header.writeUInt32LE(version===4?1:0,40);header.writeUInt32LE(1,44);header.writeUInt32LE(dirId,48);header.writeUInt32LE(4096,56);header.writeUInt32LE(mini?miniId:end,60);header.writeUInt32LE(mini?1:0,64);header.writeUInt32LE(end,68)
 for(let i=0;i<109;i++)header.writeUInt32LE(i?free:fatId,76+i*4)
 const data=Buffer.alloc(blocks*sectorSize);payload.copy(data)
 const dir=Buffer.alloc(sectorSize)
 entry('Root Entry',5,mini?0:end,mini?units*64:0,1).copy(dir)
 entry('Workbook',2,0,workbook.length,free,free,object?2:free).copy(dir,128)
 if(object)entry('_VBA_PROJECT_CUR',2,end,0).copy(dir,256)
 const fat=Buffer.alloc(sectorSize,255)
 for(let i=0;i<blocks;i++)fat.writeUInt32LE(i===blocks-1?end:i+1,i*4)
 if(mini)fat.writeUInt32LE(end,miniId*4)
 fat.writeUInt32LE(end,dirId*4);fat.writeUInt32LE(0xfffffffd,fatId*4)
 const miniFat=Buffer.alloc(sectorSize,255)
 for(let i=0;i<units;i++)miniFat.writeUInt32LE(i===units-1?end:i+1,i*4)
 return Buffer.concat([header,data,...(mini?[miniFat]:[]),dir,fat])
}
export function malformedLegacy(kind){
 const b=legacyWorkbook({mini:kind==='mini-cycle'})
 const sectorSize=512,fat=(b.readUInt32LE(76)+1)*sectorSize,dir=(b.readUInt32LE(48)+1)*sectorSize
 if(kind==='cycle')b.writeUInt32LE(0,fat)
 else if(kind==='mini-cycle'){const mf=(b.readUInt32LE(60)+1)*sectorSize;b.writeUInt32LE(0,mf)}
 else if(kind==='overlap')b.writeUInt32LE(b.readUInt32LE(48),dir+128+116)
 else if(kind==='record-length')b.writeUInt16LE(8225,sectorSize+2)
 else if(kind==='stream-size')b.writeUInt32LE(0x7fffffff,dir+128+120)
 else if(kind==='directory-cycle')b.writeUInt32LE(1,dir+128+72)
 else if(kind==='unparsed')b[sectorSize+4095]=1
 return b
}
