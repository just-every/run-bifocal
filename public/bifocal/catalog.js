import { $, status } from './catalog-shared.js'
if ($('library-search')) $('library-search').addEventListener('submit', event => {
 event.preventDefault()
 const params = new URLSearchParams()
 for (const [key, value] of new FormData(event.currentTarget)) if (String(value).trim()) params.set(key, String(value).trim())
 window.location.assign('/app/library' + (params.size ? '?' + params : ''))
})
try {
 if (document.body.dataset.catalogId) { const { startItem } = await import('./catalog-item.js'); startItem(JSON.parse(document.body.dataset.catalogItem)) }
 if ($('library-privacy-form')) { const { startSettings } = await import('./catalog-settings.js'); await startSettings() }
} catch (error) { status(error.message || 'The library controls could not start. Reload this page.', true) }
