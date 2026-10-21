// This edition's identity: what its installed Lobby and its run site say.
// The name and color are the ones setup saves in src/branding.json; the tagline
// is the approved hero's line (design desk, 20 Oct 2026).
import type { EditionIdentity } from './base/identity'
import branding from './branding.json'
import site from '../deploy-site.json'

export const identity: EditionIdentity = {
  product: branding.name,
  deployment: branding.name,
  purpose: '{deployment}’s business intelligence and reporting.',
  tagline: 'Ask in plain English. Get the chart, the query, the certified definition and the rows, from every database and app you run.',
  signInPath: '/signin',
  // The run site `rer deploy --site` publishes (deploy-site.json).
  runSite: `https://${site.domain}`,
  // An installed instance serves the Lobby at /.
  installedHome: 'lobby',
  theme: '/rer-theme.css',
  mark: '/brand/mark.svg',
  band: '/brand/band.svg',
  fonts: '/fonts/fonts.css',
  accentColor: branding.primaryColor,
}
