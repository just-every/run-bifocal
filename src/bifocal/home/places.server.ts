import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { ownerIdentity } from '../data/snapshots/store'
import { displayZone } from '../company/display-zone'
import { stamp } from '../../app/time'

export type PlaceRow = { href: string; name: string; meta?: string }
export type OwnerPlaces = { dashboards: PlaceRow[]; answers: PlaceRow[]; files: PlaceRow[] }

/** "demo-orders" reads "Demo orders", as public/bifocal/format.js labels it in the answer list. */
function label(id: string) {
 const text = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[-_.\s]+/).filter(Boolean).map(word => /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()).join(' ')
 return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A row's short time, as the answer list shows it: "Oct 26, 10:02 pm ET", with the year only before this one. */
function short(value: string, zone: string) {
 const full = stamp(value, zone), [, date, year, time] = /^\S+ (\S+ \d+), (\d{4}), (.+)$/.exec(full) ?? []
 return date ? `${date}${year === stamp(new Date().toISOString(), zone).split(', ')[1] ? '' : ', ' + year}, ${time}` : full
}

/** App home's daily places for the owner: the latest saved dashboards, retained answers and imported datasets. */
export async function ownerPlaces(env: Bindings, authority: Authority): Promise<OwnerPlaces> {
 const ownerId = await ownerIdentity(env, authority), zone = await displayZone(env, authority.email)
 const rows = async <T>(query: string, ...values: unknown[]) => (await env.DB.prepare(query).bind(...values).all<T>()).results
 const dashboards = await rows<{ id: string; title: string; created_at: string }>("SELECT id,title,created_at FROM bf_query_artifacts WHERE owner_id=? AND kind='dashboard' UNION ALL SELECT id,title,created_at FROM bf_analytics_boards WHERE owner_id=? AND kind='dashboard' ORDER BY created_at DESC LIMIT 3", ownerId, ownerId)
 const answers = await rows<{ id: string; created_at: string; query_json: string }>('SELECT id,created_at,query_json FROM bf_query_snapshots WHERE owner_id=? ORDER BY created_at DESC LIMIT 3', ownerId)
 const files = await rows<{ id: string }>('SELECT id FROM bf_file_tables ORDER BY id LIMIT 4')
 return {
  dashboards: dashboards.map(row => ({ href: `/app/dashboards/${row.id}`, name: row.title, meta: `Saved ${short(row.created_at, zone)}` })),
  answers: answers.map(row => {
   const definition = JSON.parse(row.query_json) as { dataset: string; measures: { id: string }[] }
   return { href: `/app/queries/${row.id}`, name: [label(definition.dataset), definition.measures.map(measure => label(measure.id)).join(', ')].filter(Boolean).join(' · '), meta: short(row.created_at, zone) }
  }),
  files: files.map(row => ({ href: `/app/import?dataset=${encodeURIComponent(row.id)}#current`, name: label(row.id), meta: row.id })),
 }
}
