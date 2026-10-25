/** Complete native tables remain below D1's per-value ceiling. A row allowance
 * never overrides the original-file, decoded-text or resulting-table bounds. */
export const FILE_LIMITS={bytes:1048576,rows:200000,columns:64,cell:4096,tableBytes:1900000,envelopeBytes:8388608,chunkBytes:65536} as const
// XLSX keeps its independently bounded ZIP expansion and XML structure. Dense
// workbooks can reach those bounds before the shared row-position allowance.
export const WORKBOOK_LIMITS={bytes:524288,entries:128,entryBytes:1048576,expandedBytes:4194304,xmlNodes:100000,xmlDepth:64,markup:50000} as const
export const originalBase64Limit=(bytes:number)=>Math.ceil(bytes/3)*4
