# Font Tailor

An Obsidian plugin for picking free fonts from Google Fonts and overriding fonts either broadly (all text, the interface, monospace) or precisely (italic, bold, bold italic, each heading level, inline code, code blocks).

## How it works

Settings has a tree of slots. An empty slot uses the slot it hangs under:

- Italic, Bold and Bold italic use Text. Bold italic uses Bold if Bold is set, otherwise Italic, otherwise Text.
- Headings use Text; H1 to H6 use Headings.
- Inline code and Code blocks use Monospace.
- Text, Interface and Monospace use Obsidian's own font when empty.

A slot sets family, weight and italic. The preview next to the slots is a sample note in your languages; hover a slot to see what it changes, or select part of the note to pick its font.

**My languages** lists the scripts you write in (Latin, Cyrillic, Greek, CJK and others). The default is Latin plus the scripts of Obsidian's language and your system languages. The picker shows one sample line per script, can hide fonts that miss one of them, and a slot whose font lacks a script says which script falls back to another font.

## Network use

Font Tailor uses the network only for these, and works offline once fonts are downloaded:

- `https://fonts.google.com/metadata/fonts`: the font list, cached in the plugin folder for 30 days.
- `https://fonts.googleapis.com/css2` and `https://fonts.gstatic.com`: when you apply a font, the files for the weights and styles your slots use, in the subsets of your languages, are saved to `.obsidian/plugins/font-tailor/fonts/` and loaded from there.
- While the font picker is open, its previews load from Google directly.

No telemetry, no account, no API key. Removing a slot or disabling the plugin gives the fonts back to Obsidian; downloaded files stay in the vault.

## Development

Needs Node.js 18 or newer (tests need 22.6 or newer).

- `npm install` installs dependencies.
- `npm run dev` rebuilds `main.js` from `src/main.ts` on every change.
- `npm run build` type-checks and makes a production build.
- `npm run lint` runs ESLint with the Obsidian rules.
- `npm test` checks the fallback chain (`test/fallback.test.ts`).

Source map: `slots.ts` (slot tree and fallback chain), `scripts.ts` (writing systems and samples), `catalog.ts` (font list), `fonts.ts` (downloads and font faces), `apply.ts` (body classes and CSS variables; the selectors are in `styles.css`), `settings.ts`, `picker.ts`, `note.ts` (preview).

## Manual install

Copy `main.js`, `styles.css` and `manifest.json` to `<Vault>/.obsidian/plugins/font-tailor/`, then enable Font Tailor in Settings, Community plugins.

## Releasing

Set `minAppVersion` in `manifest.json` if needed, then run `npm version patch` (or `minor`, `major`). It bumps the version in `package.json` and `manifest.json` and adds the entry to `versions.json`. Pushing a tag runs `.github/workflows/release.yml`, which builds and creates a draft GitHub release with `main.js`, `manifest.json` and `styles.css`.

See https://docs.obsidian.md for the API.
