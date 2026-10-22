import { escapeHtml, navigation } from './navigation'
import { identity } from '../identity'

export function homePage(operator: { displayName: string; role: string }) {
 return `<h1>App home</h1><p>Signed in as ${escapeHtml(operator.displayName)}</p><h2>Foundation is ready</h2><p>Sign-in, first-run setup and account tools are available in this installation.</p><h2>Native data tools</h2><p>Owners can review and import bounded CSV/XLSX files, manage US company calendars and currency rates, run exact queries and retain tabular dashboard/report answers. General source sync, semantic-model authoring, SQL/notebooks and scheduled delivery remain unfinished. Installation archives are separate from business-data imports.</p><p><a href="${escapeHtml(identity.runSite!)}/run">Run and installation guide</a> · <a href="${escapeHtml(identity.runSite!)}/contract">Product contract</a></p>${navigation(operator.role)}`
}
