// Where the run site's links go. The run site never links an instance-only route (/signin, /setup, /app).
// Bifocal has no hosted demo yet (demo.run-bifocal.com does not resolve), so "Try the demo" opens /run, where Bifocal
// starts on your own computer.
import run from '../run.json'

export const links = { home: '/', run: '/run', demo: '/run', docs: '/docs', contract: '/contract', source: run.repository }
export const docsPath = (slug: string) => `/docs/${slug}`
