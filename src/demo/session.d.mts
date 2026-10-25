import type { Bindings } from '../auth.server'
export function demoSession(env: Bindings, ownerEmail: string): Promise<{cookie: string; ownerId: string; close(): Promise<unknown>}>
