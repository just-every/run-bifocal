// Foundation navigation only: analytical routes are not implemented yet.
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export function navigation(role: string) {
 return `<nav aria-label="App"><ul><li><a href="/app">App home</a></li><li><a href="/">Lobby</a></li>${role === 'owner' ? '<li><a href="/auth/settings/identity">Identity settings</a></li>' : ''}</ul></nav><form method="post" action="/auth/signout"><button type="submit">Sign out</button></form>`
}
