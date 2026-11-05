import { Buffer } from 'node:buffer'
import { WorkbookError } from '../xlsx'
import { WORKBOOK_LIMITS, originalBase64Limit } from '../limits'

export const fail = (message: string): never => { throw new WorkbookError(message) }
const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd
/** MS-CFB v3 and v4, bounded before allocation. All reachable chains have exclusive
 * ownership; unused allocated sectors and additional storage trees are refused.
 * Small Workbook streams use the root mini stream and its separately checked FAT. */
export function compound(base64: string): { bytes: Buffer; workbook: Buffer } {
 if (base64.length > originalBase64Limit(WORKBOOK_LIMITS.bytes)) fail('XLS_BYTE_LIMIT: Workbook exceeds the original byte bound.')
 const bytes = Buffer.from(base64, 'base64')
 if (bytes.toString('base64') !== base64) fail('XLS_BASE64: Supply canonical original workbook bytes.')
 if (bytes.length < 512 || bytes.length > WORKBOOK_LIMITS.bytes || bytes.subarray(0,8).toString('hex') !== 'd0cf11e0a1b11ae1') fail('XLS_CFB: Supply a complete compound-file workbook.')
 const major = bytes.readUInt16LE(26), sectorSize = 2 ** bytes.readUInt16LE(30)
 if (![3,4].includes(major) || sectorSize !== (major === 3 ? 512 : 4096) || bytes.readUInt16LE(28) !== 0xfffe || bytes.readUInt16LE(32) !== 6 || bytes.readUInt32LE(56) !== 4096 || bytes.subarray(8,24).some(Boolean) || bytes.subarray(34,40).some(Boolean) || bytes.readUInt32LE(52) || bytes.subarray(512,sectorSize).some(Boolean) || bytes.length % sectorSize) fail('XLS_CFB: Unsupported or inconsistent compound-file header.')
 const count = bytes.length / sectorSize - 1, owners = new Map<number,string>()
 const sector = (id: number) => {
  if (!Number.isInteger(id) || id < 0 || id >= count) fail('XLS_CFB_CHAIN: Sector is outside the original file.')
  return bytes.subarray((id+1)*sectorSize,(id+2)*sectorSize)
 }
 const claim = (id: number, owner: string) => { sector(id); if (owners.has(id)) fail('XLS_CFB_CHAIN: Cyclic or overlapping sector ownership.'); owners.set(id,owner) }
 const fatCount = bytes.readUInt32LE(44), fat: number[] = []
 // At this byte bound every FAT sector fits the header DIFAT. Extended DIFATs
 // cannot be necessary and are refused instead of allocating from their claims.
 if (!fatCount || fatCount > Math.ceil(count / (sectorSize/4)) || bytes.readUInt32LE(68) !== END || bytes.readUInt32LE(72)) fail('XLS_CFB_CHAIN: Unsupported or oversized FAT inventory.')
 for (let i=0;i<109;i++) {
  const id = bytes.readUInt32LE(76+i*4)
  if (i >= fatCount) { if (id !== FREE) fail('XLS_CFB_CHAIN: Unexpected DIFAT entry.'); continue }
  claim(id,'fat'); const data = sector(id)
  for (let at=0;at<data.length;at+=4) fat.push(data.readUInt32LE(at))
 }
 for (const id of owners.keys()) if (fat[id] !== FAT) fail('XLS_CFB_CHAIN: FAT sector is not marked as FAT.')
 const chain = (start: number, owner: string, size?: number) => {
  const ids: number[] = []; let id = start
  if (size === 0 && ![END,FREE].includes(id)) fail('XLS_CFB_CHAIN: Empty stream has an allocated chain.')
  while (id !== END && !(size === 0 && id === FREE)) {
   claim(id,owner); ids.push(id)
   if (ids.length > count || (size !== undefined && ids.length > Math.ceil(size/sectorSize))) fail('XLS_CFB_CHAIN: Stream chain exceeds its declared length.')
   id = fat[id]
  }
  if (size !== undefined && ids.length !== Math.ceil(size/sectorSize)) fail('XLS_CFB_CHAIN: Stream chain is incomplete.')
  return ids
 }
 const collect = (ids: number[], size = ids.length*sectorSize) => Buffer.concat(ids.map(sector),ids.length*sectorSize).subarray(0,size)
 const directoryIds = chain(bytes.readUInt32LE(48),'directory')
 if (!directoryIds.length || (major === 3 ? bytes.readUInt32LE(40) !== 0 : bytes.readUInt32LE(40) !== directoryIds.length)) fail('XLS_CFB_DIRECTORY: Invalid directory sector count.')
 const directory = collect(directoryIds)
 type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number }
 const entries: Entry[] = []
 for (let at=0;at<directory.length;at+=128) {
  const type = directory[at+66], length = directory.readUInt16LE(at+64)
  if (!type) { entries.push({name:'',type:0,left:FREE,right:FREE,child:FREE,start:END,size:0}); continue }
  if (![2,5].includes(type) || length < 2 || length > 64 || length % 2 || directory.readUInt16LE(at+length-2) || directory[at+67] > 1 || directory.subarray(at+80,at+96).some(Boolean)) fail('XLS_ACTIVE_CONTENT: Storage objects or invalid directory entries are refused.')
  const name = directory.subarray(at,at+length-2).toString('utf16le'), size = directory.readUInt32LE(at+120)
  if (!name || /[\x00-\x04/\\:!]/.test(name) || directory.readUInt32LE(at+124) || size > WORKBOOK_LIMITS.bytes) fail('XLS_CFB_DIRECTORY: Unsupported stream name or size.')
  entries.push({name,type,left:directory.readUInt32LE(at+68),right:directory.readUInt32LE(at+72),child:directory.readUInt32LE(at+76),start:directory.readUInt32LE(at+116),size})
 }
 const root = entries[0]
 if (!root || root.type !== 5 || root.name !== 'Root Entry' || root.left !== FREE || root.right !== FREE) fail('XLS_CFB_DIRECTORY: Missing compound-file root.')
 const visited = new Set<number>([0]), streams: Entry[] = [], names = new Set<string>(), pending = [root.child]
 while (pending.length) {
  const id = pending.pop()!
  if (id === FREE) continue
  const entry = entries[id]
  if (!entry || entry.type !== 2 || visited.has(id) || entry.child !== FREE || names.has(entry.name.toLowerCase())) fail('XLS_CFB_DIRECTORY: Cyclic, duplicate or incomplete directory tree.')
  visited.add(id); names.add(entry.name.toLowerCase()); pending.push(entry.left,entry.right)
  if (!['Workbook','\u0005SummaryInformation','\u0005DocumentSummaryInformation','\u0001CompObj'].includes(entry.name)) fail('XLS_ACTIVE_CONTENT: VBA, embedded objects, encryption and additional streams are refused.')
  streams.push(entry)
 }
 if (entries.some((entry,id)=>entry.type && !visited.has(id)) || streams.filter(entry=>entry.name==='Workbook').length !== 1) fail('XLS_CFB_DIRECTORY: Unreachable entries or missing Workbook stream.')
 const miniCount = bytes.readUInt32LE(64)
 if (miniCount > Math.ceil(count/16)) fail('XLS_CFB_CHAIN: Oversized mini FAT inventory.')
 const miniData = collect(chain(bytes.readUInt32LE(60),'mini-fat',miniCount*sectorSize)), miniFat: number[] = []
 for (let at=0;at<miniData.length;at+=4) miniFat.push(miniData.readUInt32LE(at))
 if (root.size % 64) fail('XLS_CFB_CHAIN: Root mini stream is not sector aligned.')
 const miniStream = collect(chain(root.start,'mini-root',root.size)), miniOwners = new Set<number>()
 let workbook: Buffer | undefined
 for (const entry of streams) {
  let data: Buffer
  if (entry.size >= 4096) data = collect(chain(entry.start,entry.name,entry.size),entry.size)
  else {
   const ids: number[] = []; let id = entry.start
   while (id !== END && !(entry.size === 0 && id === FREE)) {
    if (id >= miniStream.length/64 || id >= miniFat.length || miniOwners.has(id) || ids.length >= Math.ceil(entry.size/64)) fail('XLS_CFB_CHAIN: Invalid, cyclic or overlapping mini stream.')
    miniOwners.add(id); ids.push(id); id = miniFat[id]
   }
   if (ids.length !== Math.ceil(entry.size/64)) fail('XLS_CFB_CHAIN: Incomplete mini stream.')
   data = Buffer.concat(ids.map(id=>miniStream.subarray(id*64,(id+1)*64))).subarray(0,entry.size)
  }
  if (entry.name === 'Workbook') workbook = data
 }
 for (let i=0;i<count;i++) if (!owners.has(i) && fat[i] !== FREE) fail('XLS_CFB_CHAIN: Unreferenced allocated sector.')
 for (let i=0;i<miniFat.length;i++) if (!miniOwners.has(i) && miniFat[i] !== FREE) fail('XLS_CFB_CHAIN: Unreferenced allocated mini sector.')
 return {bytes,workbook:workbook!}
}
