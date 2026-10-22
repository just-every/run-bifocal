import type { Bindings } from '../../auth.server'

/** The zone a signed-in person reads times in: their own preference, else the company's (the viewer-timezone door's
 * rule). Pages render every time on one clock in it. */
export async function displayZone(env: Bindings, email: string): Promise<string> {
 const row = await env.DB.prepare("SELECT COALESCE(p.timezone,json_extract(c.value_json,'$.timezone')) AS timezone FROM bf_company_settings c LEFT JOIN bf_viewer_timezones p ON p.operator_email=? WHERE c.singleton=1").bind(email).first<{ timezone: string }>()
 if (!row) throw new Error('company_schema_unavailable')
 return row.timezone
}
