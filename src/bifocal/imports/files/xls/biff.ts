import { Buffer } from 'node:buffer'
import { FILE_LIMITS } from '../limits'
import { fail } from './compound'

const u16 = (bytes: Uint8Array, at = 0) => new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(at,true)
const u32 = (bytes: Uint8Array, at = 0) => new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at,true)
const f64 = (bytes: Uint8Array, at = 0) => new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getFloat64(at,true)
type Kind = 'text' | 'number' | 'money' | 'date' | 'boolean'
type Record = { id: number; data: Buffer; start: number; end: number }
function record(bytes: Buffer, start: number): Record {
 if (start+4 > bytes.length) fail('XLS_RECORD: Incomplete BIFF record header.')
 const id = u16(bytes,start), size = u16(bytes,start+2), end = start+4+size
 if (size > 8224 || end > bytes.length) fail('XLS_RECORD: Invalid or truncated BIFF record length.')
 return {id,data:bytes.subarray(start+4,end),start,end}
}
function length(data: Buffer, min: number, max = min) {
 if (data.length < min || data.length > max) fail('XLS_RECORD: BIFF record has an invalid payload length.')
}
function text(data: Buffer, short = false) {
 const prefix = short ? 1 : 2
 length(data,prefix+1,8224)
 const count = short ? data[0] : u16(data,0), flags = data[prefix]
 if (flags & ~1 || count > FILE_LIMITS.cell || data.length !== prefix+1+count*(flags ? 2 : 1)) fail('XLS_STRING: Unsupported rich, phonetic or incomplete string.')
 const value = Buffer.from(data.subarray(prefix+1)).toString(flags ? 'utf16le' : 'latin1')
 if (/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('XLS_STRING: Invalid Unicode string.')
 return value
}
/** SST strings can cross CONTINUE records. Only character runs consume the
 * continuation encoding flag; counts and string headers cross without it. */
function sharedStrings(parts: Buffer[]) {
 let part = 0, at = 8
 length(parts[0],8,8224)
 const total = u32(parts[0],0), unique = u32(parts[0],4)
 if (unique > total || unique > FILE_LIMITS.rows*FILE_LIMITS.columns || unique > parts.reduce((n,p)=>n+p.length,0)/3) fail('XLS_STRING: Invalid shared-string inventory.')
 const byte = () => { if (at === parts[part].length) { part++; at=0 }; if (!parts[part] || at >= parts[part].length) fail('XLS_STRING: Incomplete shared-string table.'); return parts[part][at++] }
 const strings: string[] = []
 for (let i=0;i<unique;i++) {
  const count = byte() | byte()<<8; let wide = byte()
  if (count > FILE_LIMITS.cell || wide & ~1) fail('XLS_STRING: Rich or phonetic strings are unsupported; use plain values.')
  let value = ''
  for (let j=0;j<count;j++) {
   if (at === parts[part].length) { part++; at=0; if (!parts[part]) fail('XLS_STRING: Incomplete continued string.'); wide=byte(); if (wide & ~1) fail('XLS_STRING: Invalid continuation encoding.') }
   if (wide && at+2>parts[part].length) fail('XLS_STRING: Split UTF-16 code unit.')
   const char = byte(); value += String.fromCharCode(wide ? char | byte()<<8 : char)
  }
  if (/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('XLS_STRING: Invalid Unicode string.')
  strings.push(value)
 }
 if (part !== parts.length-1 || at !== parts[part].length) fail('XLS_STRING: Unexpected shared-string tail.')
 return strings
}
function decimal(value: number): string {
 if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('XLS_NUMBER: Unsafe numeric precision; supply a corrected text or exact-decimal source.')
 const source = String(value), [mantissa, exp='0'] = source.toLowerCase().split('e'), negative = mantissa.startsWith('-'), unsigned = negative ? mantissa.slice(1) : mantissa
 const digits = unsigned.replace('.','')
 if (digits.replace(/^0+|0+$/g,'').length > 15) fail('XLS_NUMBER: More than fifteen significant decimal digits are unsafe.')
 const point = (unsigned.indexOf('.') < 0 ? unsigned.length : unsigned.indexOf('.')) + Number(exp)
 return (negative ? '-' : '') + (point <= 0 ? '0.'+'0'.repeat(-point)+digits : point >= digits.length ? digits+'0'.repeat(point-digits.length) : digits.slice(0,point)+'.'+digits.slice(point))
}
function rk(bits: number) {
 let value: number
 if (bits & 2) value = bits >> 2
 else { const bytes = Buffer.alloc(8); bytes.writeUInt32LE((bits & 0xfffffffc)>>>0,4); value = f64(bytes) }
 return bits & 1 ? value/100 : value
}
function value(raw: number, format: number, custom: Map<number,string>, date1904: boolean): {value:string;kind:Kind} {
 const numeric = decimal(raw), code = custom.get(format)
 if ([14,15,16,17].includes(format) || [['mm','dd','yyyy'].join('/'),['m','d','yyyy'].join('/'),'yyyy-mm-dd'].includes(code?.toLowerCase() ?? '')) {
  if (!Number.isSafeInteger(raw) || raw < 0 || raw > 2958465 || (!date1904 && raw === 60)) fail('XLS_DATE: Fractional, fictitious or out-of-range dates require source correction.')
  const date = new Date(Date.UTC(date1904 ? 1904 : 1899,date1904 ? 0 : 11,date1904 ? 1 : 31)+(date1904 ? raw : raw-(raw>60?1:0))*86400000)
  if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) fail('XLS_DATE: Date is outside the supported range.')
  return {value:`${String(date.getUTCMonth()+1).padStart(2,'0')}/${String(date.getUTCDate()).padStart(2,'0')}/${date.getUTCFullYear()}`,kind:'date'}
 }
 if ([5,6,7,8,44].includes(format) || ['$0.00','$#,##0.00','"$"#,##0.00'].includes(code ?? '')) {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(numeric)) fail('XLS_MONEY: USD requires at most two decimal places; no rounding is performed.')
  const [whole,fraction=''] = numeric.split('.')
  return {value:(whole.startsWith('-')?'-$'+whole.slice(1):'$'+whole)+'.'+fraction.padEnd(2,'0'),kind:'money'}
 }
 if (![0,1,2,3,4].includes(format) && !['0','0.00','#,##0','#,##0.00'].includes(code ?? '')) fail('XLS_FORMAT: Unsupported numeric format; explicitly normalize a source copy.')
 return {value:numeric,kind:'number'}
}
const globalHarmless = new Map<number,[number,number]>([
 [0xff,[2,8224]],[0x161,[2,2]],[0x5f,[2,2]],[0x1c1,[8,8]],[0x42,[2,2]],[0x3d,[18,18]],[0x31,[16,8224]],[0x293,[2,8224]],[0x92,[2,226]],[0x13d,[2,64]],[0x8c,[4,4]],
 [0xda,[2,2]],[0x40,[2,2]],[0x5c,[2,112]],[0xc1,[2,2]],[0xe1,[2,2]],[0xe2,[0,8224]],[0x19,[2,2]],[0x12,[2,2]],
 [0x13,[2,2]],[0x1af,[2,2]],[0x1bc,[2,2]],[0x1b7,[2,2]],[0x160,[2,2]],[0x8d,[2,2]],[0x0e,[2,2]],
])
const sheetHarmless = new Map<number,[number,number]>([
 [0x208,[16,16]],[0x7d,[12,12]],[0x23e,[18,18]],[0x41,[10,18]],[0x1d,[9,8224]],[0xa1,[34,34]],
 [0x14,[0,8224]],[0x15,[0,8224]],[0x26,[8,8]],[0x27,[8,8]],[0x28,[8,8]],[0x29,[8,8]],
 [0x2a,[2,2]],[0x2b,[2,2]],[0x82,[2,2]],[0x80,[8,8]],[0x81,[2,2]],[0x83,[2,2]],[0x84,[2,2]],
 [0x12,[2,2]],[0x13,[2,2]],[0x19,[2,2]],[0x55,[2,2]],[0x225,[4,8224]],[0x8b,[4,8224]],
 [0x20b,[16,8224]],[0xd7,[4,8224]],[0x1b7,[2,2]],[0x1bc,[2,2]],
])
function harmless(rec: Record, allowed: Map<number,[number,number]>) {
 const bounds = allowed.get(rec.id)
 if (!bounds) fail(`XLS_UNSUPPORTED: BIFF record 0x${rec.id.toString(16).padStart(4,'0')} is outside the value-only profile.`)
 length(rec.data,...bounds!)
 if ([0x12,0x13,0x19].includes(rec.id) && u16(rec.data)) fail('XLS_UNSUPPORTED: Protected worksheets require an explicit source copy.')
 if (rec.id === 0x0e && u16(rec.data) !== 1) fail('XLS_NUMBER: Precision-as-displayed workbooks are unsupported.')
}
function unsafe(id: number) {
 if ([0x2f,0xd3].includes(id)) fail('XLS_ENCRYPTION: Encrypted workbooks are refused.')
 if ([0x6,0x206,0x406,0x221,0x4bc,0x236].includes(id)) fail('XLS_FORMULA: Formula-bearing legacy workbooks are refused; import an explicit values-only copy.')
 if ([0x1ae,0x17,0x23,0x59,0x5a,0x1b8].includes(id)) fail('XLS_EXTERNAL: External references and linked content are refused.')
 if ([0x18,0xd3,0x1ba,0x1bd,0x5d,0xeb,0xec,0x1b6].includes(id)) fail('XLS_ACTIVE_CONTENT: Names, VBA, XLM, drawings and embedded objects are refused.')
}
export function biff(bytes: Buffer, selected: unknown) {
 const bof = (start: number, type: number) => { const rec = record(bytes,start); length(rec.data,16); if (rec.id !== 0x809 || u16(rec.data) !== 0x600 || u16(rec.data,2) !== type) fail('XLS_BIFF: Only BIFF8 ordinary worksheet workbooks are supported.'); return rec.end }
 let at = bof(0,5), date1904 = false, eof = false, sstSeen = false
 const sheets: {name:string;offset:number}[] = [], styles: number[] = [], formats = new Map<number,string>(); let strings: string[] = []
 while (at < bytes.length) {
  const rec = record(bytes,at), data = rec.data; at = rec.end; unsafe(rec.id)
  if (rec.id === 0xa) { length(data,0); eof=true; break }
  if (rec.id === 0x85) {
   length(data,8,70)
   if (data[4] !== 0 || data[5] !== 0) fail('XLS_ACTIVE_CONTENT: Hidden sheets, chart sheets and XLM macro sheets are refused.')
   const name = text(data.subarray(6),true)
   if (!name || sheets.some(sheet=>sheet.name===name) || sheets.length >= 32) fail('XLS_SHEET: Invalid or excessive sheet inventory.')
   sheets.push({name,offset:u32(data)})
  } else if (rec.id === 0x22) { length(data,2); if (u16(data)>1) fail('XLS_DATE: Invalid date system.'); date1904=!!u16(data) }
  else if (rec.id === 0xe0) { length(data,20); styles.push(u16(data,2)) }
  else if (rec.id === 0x41e) { length(data,5,8224); const id=u16(data); if (id<164 || formats.has(id)) fail('XLS_FORMAT: Duplicate or invalid custom format.'); formats.set(id,text(data.subarray(2))) }
  else if (rec.id === 0xfc) {
   if (sstSeen) fail('XLS_STRING: Duplicate shared-string table.'); sstSeen=true
   const parts = [data]
   while (at+4<=bytes.length && u16(bytes,at)===0x3c) { const next=record(bytes,at); parts.push(next.data); at=next.end }
   strings=sharedStrings(parts)
  } else harmless(rec,globalHarmless)
 }
 if (!eof || !sheets.length || !styles.length || typeof selected !== 'string' || !sheets.some(sheet=>sheet.name===selected)) fail('XLS_SHEET: Choose an exact existing sheet name; at most 32 visible ordinary worksheets are supported.')
 let result: {rows:(string|null)[][];types:(Kind|'mixed'|null)[]} | undefined
 const ordered = [...sheets].sort((a,b)=>a.offset-b.offset)
 for (const sheet of ordered) {
  if (sheet.offset !== at) fail('XLS_BIFF: Worksheet offsets overlap or leave unparsed content.')
  at=bof(at,0x10); eof=false
  const rows: (string|null)[][] = [], types: Set<Kind>[] = [], seen = new Set<number>(); let width=0, dimensions: number[] | undefined
  const put = (row: number,col: number,style: number,raw: string|number|boolean|null,kind: Kind='text') => {
   if (!dimensions || row >= Math.min(FILE_LIMITS.rows+1,65536) || col >= FILE_LIMITS.columns || row < dimensions[0] || row >= dimensions[1] || col < dimensions[2] || col >= dimensions[3] || style >= styles.length || seen.has(row*65536+col)) fail('XLS_TABLE_LIMIT: Invalid, duplicate or out-of-dimensions cell.')
   if (row===0 && (kind!=='text' || typeof raw!=='string')) fail('XLS_HEADERS: Column headers must be text cells.')
   seen.add(row*65536+col)
   let cell = raw === null ? null : typeof raw === 'boolean' ? String(raw) : String(raw)
   if (typeof raw === 'number') { const parsed=value(raw,styles[style],formats,date1904); cell=parsed.value; kind=parsed.kind }
   if (cell !== null && cell.length>FILE_LIMITS.cell) fail('XLS_STRING: Cell exceeds the text bound.')
   while (rows.length<=row) rows.push([])
   rows[row][col]=cell; width=Math.max(width,col+1)
   if (row>0 && cell!==null) { types[col]??=new Set(); types[col].add(kind) }
  }
  while (at < bytes.length) {
   const rec=record(bytes,at), d=rec.data; at=rec.end; unsafe(rec.id)
   if (rec.id===0xa) { length(d,0); eof=true; break }
   if (rec.id===0x200) {
    length(d,14); if (dimensions) fail('XLS_TABLE: Duplicate dimensions.')
    dimensions=[u32(d),u32(d,4),u16(d,8),u16(d,10)]
    if (dimensions[0]!==0 || dimensions[2]!==0 || dimensions[1]<2 || dimensions[1]>Math.min(FILE_LIMITS.rows+1,65536) || !dimensions[3] || dimensions[3]>FILE_LIMITS.columns || (dimensions[1]-1)*(dimensions[3]*3+1)>FILE_LIMITS.tableBytes) fail('XLS_TABLE_LIMIT: The complete declared table exceeds the bounded rectangle.')
   } else if ([0x203,0x27e,0xfd,0x205,0x201,0x204].includes(rec.id)) {
    length(d,rec.id===0x203?14:rec.id===0x27e||rec.id===0xfd?10:rec.id===0x205?8:rec.id===0x201?6:9,rec.id===0x204?8224:rec.id===0x203?14:rec.id===0x27e||rec.id===0xfd?10:rec.id===0x205?8:6)
    const row=u16(d), col=u16(d,2), style=u16(d,4)
    if (rec.id===0x203) put(row,col,style,f64(d,6),'number')
    else if (rec.id===0x27e) put(row,col,style,rk(u32(d,6)),'number')
    else if (rec.id===0xfd) { const id=u32(d,6); if (id>=strings.length) fail('XLS_STRING: Missing shared string.'); put(row,col,style,strings[id]) }
    else if (rec.id===0x204) put(row,col,style,text(d.subarray(6)))
    else if (rec.id===0x201) put(row,col,style,null)
    else { if (d[7]!==0 || d[6]>1) fail('XLS_CELL_ERROR: Resolve error cells before import.'); put(row,col,style,!!d[6],'boolean') }
   } else if ([0xbd,0xbe].includes(rec.id)) {
    const step=rec.id===0xbd?6:2; length(d,6+step,8224)
    const first=u16(d,2), last=u16(d,d.length-2)
    if (last<first || last>=FILE_LIMITS.columns || d.length!==6+(last-first+1)*step) fail('XLS_RECORD: Invalid packed cell record.')
    for (let col=first;col<=last;col++) { const offset=4+(col-first)*step; put(u16(d),col,u16(d,offset),rec.id===0xbd?rk(u32(d,offset+2)):null,'number') }
   } else harmless(rec,sheetHarmless)
  }
  if (!eof || !dimensions || rows.length!==dimensions[1] || width!==dimensions[3]) fail('XLS_TABLE: Incomplete worksheet rectangle or missing EOF.')
  for (const row of rows) for (let col=0;col<width;col++) if (row[col]===undefined) row[col]=null
  if (rows[0].some((cell,col)=>typeof cell!=='string' || !cell || styles.length===0 || !seen.has(col))) fail('XLS_HEADERS: Supply complete text column headers.')
  if (sheet.name===selected) result={rows,types:Array.from({length:width},(_,i)=>types[i]?.size===1?[...types[i]][0]:types[i]?.size?'mixed':null)}
 }
 if (bytes.subarray(at).some(Boolean)) fail('XLS_BIFF: Unparsed workbook content follows the last worksheet.')
 return {...result!,sheet:selected as string,sheets:sheets.map(sheet=>sheet.name),formulas:[] as {cell:string;formula:string;cached:string}[]}
}
