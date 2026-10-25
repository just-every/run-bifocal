export async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('') }
export function base64(bytes) { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text) }
export function fileLimits(form) {
 const limits={csvBytes:Number(form.getAttribute('data-csv-bytes')),xlsxBytes:Number(form.getAttribute('data-xlsx-bytes')),maxBytes:Number(form.getAttribute('data-envelope-bytes')),chunkBytes:Number(form.getAttribute('data-chunk-bytes'))}
 if(Object.values(limits).some(value=>!Number.isSafeInteger(value)||value<1))throw Error('Import bounds are unavailable. Reload this page before uploading.')
 return limits
}
function delimiter(text) {
 // Count separators outside quotes in the first complete logical record.
 const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 }; let quoted = false
 for (let index = 0; index < text.length; index++) {
  const ch = text[index]
  if (ch === '"') { if (quoted && text[index + 1] === '"') index++; else quoted = !quoted }
  else if (!quoted && (ch === '\n' || ch === '\r')) break
  else if (!quoted && ch in counts) counts[ch]++
 }
 const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
 if (!sorted[0][1] || sorted[0][1] === sorted[1][1]) throw Error('Delimiter is ambiguous. Select it explicitly.')
 return sorted[0][0]
}
export async function envelope(form) {
 const file = form.elements.file.files[0], datasetId = form.elements.dataset.value
 if (!file) throw Error('Choose a CSV or XLSX file.')
 const limits=fileLimits(form),workbook=/\.xlsx$/i.test(file.name),bound=workbook?limits.xlsxBytes:limits.csvBytes
 if(file.size>bound)throw Error(`The selected ${workbook?'XLSX':'CSV'} file exceeds ${bound} bytes.`)
 const bytes = new Uint8Array(await file.arrayBuffer())
 if (!/\.(csv|xlsx)$/i.test(file.name)) throw Error('Choose CSV or XLSX. Macro-enabled workbooks are refused.')
 let encoding = form.elements.encoding.value, separator = form.elements.delimiter.value, data
 if (workbook) { encoding = 'utf-8'; separator = ','; data = base64(bytes) }
 else {
  if (encoding === 'auto') encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8'
  try { data = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw Error('Invalid encoding. Select the original file encoding explicitly.') }
  if(new TextEncoder().encode(data).length>limits.csvBytes)throw Error(`Decoded CSV text exceeds ${limits.csvBytes} UTF-8 bytes.`)
  separator = separator === 'auto' ? delimiter(data) : separator === 'tab' ? '\t' : separator
 }
 const result = { version: 1, datasetId, filename: file.name, encoding, delimiter: separator, nullValue: form.elements.null.value, mode: form.elements.mode.value, formulaTreatment: workbook ? 'cached-values-preserve-formulas' : 'literal-text', data }
 if (form.elements.sourceKind?.value) result.lineage = {kind:form.elements.sourceKind.value,link:form.elements.sourceLink.value,description:form.elements.sourceDescription.value,from:form.elements.sourceFrom.value,to:form.elements.sourceTo.value,timezone:form.elements.sourceTimezone.value,observedAt:new Date().toISOString(),schema:form.elements.sourceKind.value === 'vane-export' ? 'run-vane report CSV v1 @ 8549e6e129e1725d8e85d8d25ca3814831f204da' : form.elements.sourceKind.value === 'easel-export' ? 'run-easel dataset CSV @ 277548b08ec1a0ebf588db971b099df865405f84' : 'owner-supplied business table export'}
 if (form.elements.key.value) result.key = form.elements.key.value
 if (form.elements.columns.value.trim()) { try { result.columns = JSON.parse(form.elements.columns.value) } catch { throw Error('Column mapping must be a JSON object mapping every column.') } }
 if (workbook) { if (!form.elements.sheet.value) throw Error('Enter the exact XLSX sheet name.'); result.sheet = form.elements.sheet.value }
 else result.originalBase64 = base64(bytes)
 return result
}
export async function upload(input, call, progress, datasetId = input.datasetId, limits = {maxBytes:1048576,chunkBytes:65536}) {
 const bytes = new TextEncoder().encode(JSON.stringify(input)), hash = await sha256(bytes), key = 'bifocal-upload:' + datasetId
 if (bytes.length > limits.maxBytes) throw Error(`The reviewed envelope exceeds ${limits.maxBytes} bytes. Split this file before uploading.`)
 let saved; try { saved = JSON.parse(sessionStorage.getItem(key)) } catch {}
 let uploadId = saved?.hash === hash ? saved.id : undefined
 const totalChunks = Math.ceil(bytes.length / limits.chunkBytes)
 for (let index = 0; index < totalChunks; index++) {
  const chunk = bytes.slice(index * limits.chunkBytes, (index + 1) * limits.chunkBytes)
  progress(`Uploading chunk ${index + 1} of ${totalChunks}…`)
  const response = await call('uploads', { ...(uploadId ? { uploadId } : {}), name: 'file-envelope.json', bundleSha256: hash, totalBytes: bytes.length, totalChunks, index, chunkSha256: await sha256(chunk), base64: base64(chunk) }, datasetId)
  uploadId = response.uploadId; sessionStorage.setItem(key, JSON.stringify({ hash, id: uploadId }))
 }
 return uploadId
}

export function originalFile(originals) {
 const retained=originals.find(entry=>entry.original.status==='retained')
 if(!retained)throw Error('Original unavailable after erasure or credential removal.')
 const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0))
 const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(retained.original.base64)))
 if(envelope.version!==1 || typeof envelope.filename!=='string' || typeof envelope.data!=='string')throw Error('Original custody format is not a file envelope.')
 if(envelope.spreadsheet)return {name:'spreadsheet-range-snapshot.json',bytes:new TextEncoder().encode(JSON.stringify(envelope))}
 return {name:envelope.filename,bytes:envelope.originalBase64?decode(envelope.originalBase64):/\.xlsx$/i.test(envelope.filename)?decode(envelope.data):new TextEncoder().encode(envelope.data)}
}
