import type { Bindings } from './auth.server'

/** The visitor imports their own data; only the owner's first run is complete. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
 const owner = await env.DB.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner' AND status='active'").bind(ownerEmail).first<{ id: string }>()
 if (!owner) throw new Error('Demo owner is missing')
 await env.DB.prepare('INSERT INTO oa_first_run(singleton, completed_by, completed_at) VALUES(1, ?, ?) ON CONFLICT DO NOTHING').bind(owner.id, now.getTime()).run()
}
