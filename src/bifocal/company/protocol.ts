export class ConventionsError extends Error {
 constructor(readonly code: string, readonly status = 422, readonly details?: unknown) { super(code) }
}
export function requireValue(condition: unknown, code: string, details?: unknown): asserts condition {
 if (!condition) throw new ConventionsError(code, 422, details)
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
 requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'object_required')
 const result = value as Record<string, unknown>
 requireValue(Object.keys(result).every(key => keys.includes(key)), 'unknown_field', { allowed: keys })
 return result
}
export function text(value: unknown, field: string, max = 160): string {
 requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value), 'invalid_text', { field, max })
 return value.trim()
}
export function integer(value: unknown, field: string, min: number, max: number): number {
 requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'invalid_integer', { field, min, max })
 return value
}
export function identifier(value: unknown): string {
 requireValue(typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value), 'invalid_id')
 return value
}
export async function body(request: Request): Promise<Record<string, unknown>> {
 if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !request.body) throw new ConventionsError('json_body_required', 400)
 const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, content = ''
 try {
  for (;;) {
   const chunk = await reader.read(); if (chunk.done) break
   bytes += chunk.value.byteLength
   if (bytes > 262144) throw new ConventionsError('request_too_large', 413)
   content += decoder.decode(chunk.value, { stream: true })
  }
  content += decoder.decode()
  const parsed: unknown = JSON.parse(content)
  requireValue(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'object_required')
  return parsed as Record<string, unknown>
 } catch (error) {
  if (error instanceof ConventionsError) throw error
  throw new ConventionsError('invalid_json', 400)
 } finally { await reader.cancel(); reader.releaseLock() }
}
