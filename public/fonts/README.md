# Fonts

Every face is self-hosted under the SIL Open Font License 1.1; each folder
holds its license (`LICENSE.txt`). `fonts.css` declares them all once, and no
page makes a third-party font request.

| Folder | Face | Used for | Upstream |
| --- | --- | --- | --- |
| `kaushan-script/` | Kaushan Script 400 | the run site's brush headings ("Bifocal shows its work.") | https://github.com/google/fonts/tree/main/ofl/kaushanscript |
| `mona-sans/` | Mona Sans, weights 200 to 900 (width 100) | the run site's sentences, numerals, labels, buttons and the Bifocal wordmark; the installed app's headings, figures and wordmark | https://github.com/github/mona-sans |

The Kaushan Script and Mona Sans files are Fontsource's unmodified Latin
subsets (`@fontsource/kaushan-script` 5.3.0, `kaushan-script-latin-400-normal.woff2`;
`@fontsource-variable/mona-sans` 5.3.0, `mona-sans-latin-wght-normal.woff2`,
the weight axis at the default width). Neither subset carries the arrow, so
the run site draws its arrows as inline SVG. The brush headings are thickened
with a text stroke in their own color; the font files are unchanged.

The root document links `/fonts/fonts.css` once, outside the temporary dev SSR
stylesheet, and preloads only Mona Sans. Do not import this CSS from a
component. The installed app sets its text in the system UI face
(`--font-ui` in `public/rer-theme.css`), so the app downloads one face, for
its headings, figures and wordmark. The run site's pages preload Mona Sans and
Kaushan Script.
