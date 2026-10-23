import { strToU8, zipSync } from 'fflate'
import { fail, type Cell } from '../query/types'
export type ExportColumn={name:string;type:string}
const xml=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
export function exportTable(columns:ExportColumn[],rows:Cell[][],format:'csv'|'xlsx'):{body:BodyInit;type:string} {
 if(format==='csv') {
  const cell=(value:Cell,type:string)=>{let text=value===null?'':String(value);if(type==='text'&&/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'}
  return {body:[columns.map(c=>cell(c.name,'text')).join(','),...rows.map(row=>row.map((value,i)=>cell(value,columns[i].type)).join(','))].join('\r\n')+'\r\n',type:'text/csv; charset=utf-8'}
 }
 const reference=(index:number)=>{let text='';for(let n=index+1;n;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text}
 const cell=(value:Cell,type:string,ref:string)=>{
  if(value===null)return `<c r="${ref}"/>`
  if(type==='number'||type==='money'){
   const text=String(value)
   if(!/^-?\d+(?:\.\d+)?$/.test(text)||text.replace(/[^0-9]/g,'').replace(/^0+/,'').length>15)fail('xlsx_numeric_precision_limit',422)
   return `<c r="${ref}" t="n"><v>${text}</v></c>`
  }
  if(type==='boolean')return `<c r="${ref}" t="b"><v>${value?1:0}</v></c>`
  if(type==='date')return `<c r="${ref}" t="d"><v>${xml(String(value))}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`
 }
 const data=[columns.map(c=>c.name),...rows].map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>cell(v,r===0?'text':columns[c].type,reference(c)+(r+1))).join('')}</row>`).join('')
 const ns='http://schemas.openxmlformats.org/',parts={
  '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  '_rels/.rels':`<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="r1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml':`<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets><sheet name="Question" sheetId="1" r:id="r1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="r1" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`
 }
 return {body:new Uint8Array(zipSync(Object.fromEntries(Object.entries(parts).map(([name,text])=>[name,strToU8('<?xml version="1.0" encoding="UTF-8"?>'+text)])))).buffer,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
}
