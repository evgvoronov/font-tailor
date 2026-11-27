# Font Tailor

An Obsidian plugin for picking free fonts from Google Fonts and overriding fonts either broadly (all text, the interface, monospace) or precisely (bold, italic, bold italic, headings).

Status: scaffold only. The plugin loads and shows an empty settings tab.

Built from [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin).

## Development

Needs Node.js 18 or newer.

- `npm install` installs dependencies.
- `npm run dev` rebuilds `main.js` from `src/main.ts` on every change.
- `npm run build` type-checks and makes a production build.
- `npm run lint` runs ESLint with the Obsidian rules.

## Manual install

Copy `main.js`, `styles.css` and `manifest.json` to `<Vault>/.obsidian/plugins/font-tailor/`, then enable Font Tailor in Settings, Community plugins.

## Releasing

Set `minAppVersion` in `manifest.json` if needed, then run `npm version patch` (or `minor`, `major`). It bumps the version in `package.json` and `manifest.json` and adds the entry to `versions.json`. Pushing a tag runs `.github/workflows/release.yml`, which builds and creates a draft GitHub release with `main.js`, `manifest.json` and `styles.css`.

See https://docs.obsidian.md for the API.
