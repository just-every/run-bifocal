# Fonts

Every face is self-hosted under the SIL Open Font License 1.1; each folder
holds its licence (`LICENSE.txt`). `fonts.css` declares them all once, and no
page makes a third-party font request.

| Folder | Face | Used for | Upstream |
| --- | --- | --- | --- |
| `kaushan-script/` | Kaushan Script 400 | the run site's brush headings ("Bifocal shows its work.") | https://github.com/google/fonts/tree/main/ofl/kaushanscript |
| `mona-sans/` | Mona Sans, weights 200 to 900 (width 100) | the run site's sentences, numerals, labels, buttons and the Bifocal wordmark | https://github.com/github/mona-sans |
| `outfit/` | Outfit, weights 100 to 900 | the installed app, sign-in and setup | https://github.com/Outfitio/Outfit-Fonts |

The Kaushan Script and Mona Sans files are Fontsource's unmodified Latin
subsets (`@fontsource/kaushan-script` 5.3.0, `kaushan-script-latin-400-normal.woff2`;
`@fontsource-variable/mona-sans` 5.3.0, `mona-sans-latin-wght-normal.woff2`,
the weight axis at the default width). Neither subset carries the arrow, so
the run site draws its arrows as inline SVG. The brush headings are thickened
with a text stroke in their own colour; the font files are unchanged. The
Outfit files are Fontsource's Latin and Latin Extended subsets.

The root document links `/fonts/fonts.css` once, outside the temporary dev SSR
stylesheet, and preloads only the primary Latin Outfit file. Do not import this
CSS from a component. Every app body-font stack uses `--font-body`, including
the local `Outfit Fallback` before generic fallback fonts; controls inherit it.
The run site's pages preload Mona Sans and Kaushan Script.

Outfit's fallback scales use Outfit/Arial advance-width ratios over A-Z, a-z
and 0-9 at weights 400, 500 and 700. Ascent, descent and line gap match
Outfit's 1000, -260 and 0 per 1000 units, divided by each scale. Matching
metrics reduces layout movement; different glyph designs cannot have identical
widths in every piece of text. Recalculate the fallback and preload when
changing the app's brand font.
