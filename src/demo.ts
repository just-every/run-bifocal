import { runtimeBindings, type Bindings } from './auth.server'
import { retailDatasets } from './demo/data'
import { demoSession } from './demo/session.mjs'
import { demoDoor, importDemoDataset } from './demo/door'
import { seedRetailAnswers } from './demo/answers'

/** Authored fictional retail data, only in the demo wrapper's throwaway database. */
export async function seedDemo(original: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
 if (original.RER_DEMO !== '1') throw new Error('Demo data requires demo mode')
 const env = runtimeBindings(original), session = await demoSession(env, ownerEmail)
 try {
  const call = demoDoor(env, session.cookie)
  for (const dataset of retailDatasets) await importDemoDataset(call, dataset)
  await seedRetailAnswers(call)
  await env.DB.prepare('INSERT INTO oa_first_run(singleton, completed_by, completed_at) VALUES(1, ?, ?) ON CONFLICT DO NOTHING').bind(session.ownerId, now.getTime()).run()
 } finally { await session.close() }
}
