import { App, Platform, normalizePath } from 'obsidian';
import { FontMeta, Reader, SCRIPT_PROBES, readFontFile } from './fontfile';
import type { FontInfo, LocalFile, Source } from './slots';

export const FONT_FILE = /\.(ttf|otf|ttc|woff2?)$/i;

export interface SourceSettings {
	/** Vault folders scanned for font files. */
	vaultFolders: string[];
	/** Desktop folders outside the vault. Synced in data.json, but only used where they exist. */
	deviceFolders: string[];
	/** Desktop: list installed system fonts. */
	systemFonts: boolean;
}

/** Vault folder that imported files are copied to. Outside the config folder, so every sync tool picks it up. */
export const IMPORT_FOLDER = 'fonts';

export function defaultSources(configDir: string): SourceSettings {
	return { vaultFolders: [`${configDir}/fonts`, IMPORT_FOLDER], deviceFolders: [], systemFonts: true };
}

/** Fonts that live only on this device and do not sync. */
export const deviceOnly = (f: FontInfo) => f.source === 'folder' || f.source === 'system';

/** The concrete source the user set up: "Vault: fonts", "Folder: …\\Fonts", "Imported", "System fonts". */
export function sourceLabel(f: FontInfo, imported: string[]): string {
	switch (f.source ?? 'google') {
		case 'google': return 'Google Fonts';
		case 'system': return 'System fonts';
		case 'vault': return f.files?.length && f.files.every((x) => imported.includes(x.path)) ? 'Imported' : `Vault: ${f.origin ?? ''}`;
		default: return `Folder: ${shortPath(f.origin ?? '')}`;
	}
}

/** Last two parts of a long path, e.g. "…\\Design\\Fonts". */
function shortPath(p: string): string {
	const parts = p.split(/[\\/]+/).filter(Boolean);
	return parts.length > 3 ? `…${p.includes('\\') ? '\\' : '/'}${parts.slice(-2).join(p.includes('\\') ? '\\' : '/')}` : p;
}

interface Node {
	fs: typeof import('fs');
	path: typeof import('path');
	home: string;
	env: Record<string, string | undefined>;
}

/** Node modules on desktop, null on mobile. */
export function nodeFs(): Node | null {
	if (!Platform.isDesktop) return null;
	/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- desktop only, guarded above */
	const os = require('os') as typeof import('os');
	return {
		fs: require('fs') as typeof import('fs'),
		path: require('path') as typeof import('path'),
		home: os.homedir(),
		env: (require('process') as typeof import('process')).env,
	};
	/* eslint-enable @typescript-eslint/no-require-imports, no-undef -- end of the desktop-only block */
}

const bufferReader = (buf: ArrayBuffer): Reader => async (o, n) => new Uint8Array(buf, o, Math.max(0, Math.min(n, buf.byteLength - o)));

interface Found {
	meta: FontMeta;
	path: string;
}

/** Groups faces into families. Scripts come from the regular face, or any face that has them. */
function group(found: Found[], source: Source, origin?: string): FontInfo[] {
	const by = new Map<string, Found[]>();
	for (const f of found) by.set(f.meta.family, [...(by.get(f.meta.family) ?? []), f]);
	return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([family, list]) => {
		const sorted = [...list].sort((a, b) => Number(a.meta.italic) - Number(b.meta.italic) || Math.abs(a.meta.weight - 400) - Math.abs(b.meta.weight - 400));
		const scripts = sorted.find((f) => f.meta.scripts)?.meta.scripts;
		const uniq = (italic: boolean) => [...new Set(list.filter((f) => f.meta.italic === italic).map((f) => f.meta.weight))].sort((a, b) => a - b);
		const weights = uniq(false);
		return {
			family,
			category: list.some((f) => f.meta.mono) ? 'mono' : 'local',
			// Unknown (WOFF2 only): measured later in the browser.
			subsets: scripts ?? [],
			weights: weights.length ? weights : uniq(true),
			italics: uniq(true),
			source,
			origin,
			files: list.map((f): LocalFile => ({ path: f.path, weight: f.meta.weight, italic: f.meta.italic })),
			unknownScripts: !scripts,
		};
	});
}

/** Font files in vault folders (recursive). Works on mobile. */
export async function scanVault(app: App, folders: string[]): Promise<FontInfo[]> {
	const adapter = app.vault.adapter;
	const found: Found[] = [];
	const walk = async (dir: string): Promise<void> => {
		if (!(await adapter.exists(dir))) return;
		const list = await adapter.list(dir);
		for (const file of list.files.filter((f) => FONT_FILE.test(f))) {
			try {
				const buf = await adapter.readBinary(file);
				for (const meta of await readFontFile(bufferReader(buf), file)) found.push({ meta, path: file });
			} catch (e) {
				console.debug('Font Tailor: skipped', file, e);
			}
		}
		for (const sub of list.folders) await walk(sub);
	};
	// One entry per configured folder, so the picker can say which folder a font is in.
	const out: FontInfo[] = [];
	for (const f of folders) {
		found.length = 0;
		await walk(normalizePath(f));
		out.push(...group(found, 'vault', normalizePath(f)));
	}
	return out;
}

/** Font files in folders outside the vault. Desktop only; reads just the tables it needs. */
export async function scanDeviceFolders(dirs: string[], source: Source = 'folder'): Promise<FontInfo[]> {
	const node = nodeFs();
	if (!node) return [];
	const { fs, path } = node;
	const found: Found[] = [];
	const walk = async (dir: string, depth: number): Promise<void> => {
		let entries: import('fs').Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory() && depth < 4) await walk(full, depth + 1);
			else if (FONT_FILE.test(e.name)) {
				let fd: import('fs').promises.FileHandle | null = null;
				try {
					fd = await fs.promises.open(full, 'r');
					const handle = fd;
					const read: Reader = async (o, n) => {
						const b = new Uint8Array(n);
						const { bytesRead } = await handle.read(b, 0, n, o);
						return b.subarray(0, bytesRead);
					};
					for (const meta of await readFontFile(read, e.name)) found.push({ meta, path: full });
				} catch {
					// Not a font we can read; skip it.
				} finally {
					await fd?.close();
				}
			}
		}
	};
	if (source === 'system') {
		for (const d of dirs) await walk(d, 0);
		return group(found, source);
	}
	const out: FontInfo[] = [];
	for (const d of dirs) {
		found.length = 0;
		await walk(d, 0);
		out.push(...group(found, source, d));
	}
	return out;
}

interface LocalFontData {
	family: string;
	blob(): Promise<Blob>;
}

/** Installed fonts: the Local Font Access API if Electron allows it, else the OS font folders. */
export async function scanSystem(): Promise<FontInfo[]> {
	const node = nodeFs();
	if (!node) return [];
	const query = (window as Window & { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
	if (query) {
		try {
			const found: Found[] = [];
			for (const fd of await query()) {
				const blob = await fd.blob();
				const metas = await readFontFile(async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()), fd.family);
				const meta = metas.find((m) => m.family === fd.family) ?? metas[0];
				// The API's family is the name CSS knows, so it wins over the file's.
				if (meta) found.push({ meta: { ...meta, family: fd.family }, path: '' });
			}
			if (found.length) return group(found, 'system').map((f) => ({ ...f, files: [] }));
		} catch (e) {
			console.debug('Font Tailor: queryLocalFonts unavailable, scanning font folders', e);
		}
	}
	const { path, home, env } = node;
	const dirs = Platform.isWin
		? [path.join(env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts')]
		: Platform.isMacOS
			? ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library', 'Fonts')]
			: ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.local', 'share', 'fonts'), path.join(home, '.fonts')];
	// System fonts are used by name in CSS, so their files are not needed.
	return (await scanDeviceFolders(dirs, 'system')).map((f) => ({ ...f, files: [] }));
}

/** Does `family` draw `text`? Compares widths against two different fallbacks. */
export function renders(doc: Document, family: string, text: string): boolean {
	const canvas = doc.body.createEl('canvas');
	canvas.remove();
	const ctx = canvas.getContext('2d');
	if (!ctx) return false;
	const w = (font: string) => {
		ctx.font = font;
		return ctx.measureText(text).width;
	};
	const mono = w(`40px "${family}", monospace`);
	const serif = w(`40px "${family}", serif`);
	return mono === serif && (mono !== w('40px monospace') || serif !== w('40px serif'));
}

let probeId = 0;

/** Scripts of a font file the parser could not read (WOFF2), by loading it and measuring. */
export async function measureScripts(doc: Document, src: string | ArrayBuffer): Promise<string[]> {
	const name = `ft-probe-${++probeId}`;
	const Face = (doc.defaultView as (Window & { FontFace: typeof FontFace }) | null)?.FontFace ?? FontFace;
	const face = new Face(name, typeof src === 'string' ? `url("${src}")` : src);
	doc.fonts.add(face);
	try {
		await face.load();
		return Object.entries(SCRIPT_PROBES).filter(([, cps]) => renders(doc, name, String.fromCodePoint(...cps))).map(([id]) => id);
	} catch {
		return [];
	} finally {
		doc.fonts.delete(face);
	}
}
