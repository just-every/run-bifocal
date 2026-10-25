import { authConfig } from '../auth.server'
import { configure } from '../modules/operator-auth/config.mjs'
import { AuthStore } from '../modules/operator-auth/accounts/store.mjs'
import { oaSessions } from '../modules/operator-auth/accounts/oa.mjs'

/** The isolated demo's seed uses a short-lived native owner session. */
export async function demoSession(env, ownerEmail) {
 const store = new AuthStore(env.DB), owner = await store.byEmail(ownerEmail)
 if (!owner || owner.role !== 'owner' || owner.status !== 'active') throw new Error('Demo owner is missing')
 const sessions = oaSessions({ config: configure(authConfig(env)), store, clock: Date.now })
 const session = await sessions.newSession()
 const record = await store.issue({ operatorId: owner.id, expectedVersion: owner.version, session, now: Date.now(), kind: 'native' })
 const cookie = sessions.completed(session, record, '/app').cookie.split(';')[0]
 return { cookie, ownerId: owner.id, close: () => store.run('UPDATE oa_sessions SET revoked_at=? WHERE id=?', [Date.now(), session.id]) }
}
