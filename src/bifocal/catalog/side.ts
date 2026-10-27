// Library's side list, shared by the Library pages and the saved dashboards and reports filed in it. The section's link
// is the current page for everything filed under it; Library settings is current only on its own page.
export function librarySide(current: 'library' | 'settings', owner: boolean) {
 const link = (href: string, label: string, on: boolean) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${label}</a>`
 return `<nav class="sidelist" aria-label="Library">${link('/app/library', 'Library', current === 'library')}${link('/app/apps', 'Apps', false)}${owner ? link('/app/library/settings', 'Library settings', current === 'settings') : ''}</nav>`
}
