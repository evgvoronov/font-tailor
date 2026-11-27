import { DataAdapter, normalizePath, requestUrl } from 'obsidian';

// Google picks the file format by user agent. A desktop Chrome UA gets woff2 everywhere, mobile included.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** One @font-face block of Google's CSS. */
export interface Block {
	label: string;
	style: string;
	weight: string;
	range: string;
	url: string;
	format: string;
}

/** A downloaded face: like Block, but `file` is a vault path. */
export interface Face {
	style: string;
	weight: string;
	range: string;
	file: string;
	format: string;
}

/** What is on disk for one family. Only grows, so undo never re-downloads. */
export interface FamilyFiles {
	tuples: string[];
	scripts: string[];
	faces: Face[];
}

/** "ital,wght" tuple, as the css2 API wants it. */
export function tuple(weight: number, italic: boolean): string {
	return `${italic ? 1 : 0},${weight}`;
}

export function cssUrl(family: string, tuples: string[]): string {
	// css2 rejects tuples out of order.
	const sorted = [...new Set(tuples)].sort((a, b) => {
		const [ai = 0, aw = 0] = a.split(',').map(Number);
		const [bi = 0, bw = 0] = b.split(',').map(Number);
		return ai - bi || aw - bw;
	});
	return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${sorted.join(';')}&display=swap`;
}

export function parseCss(css: string): Block[] {
	const blocks: Block[] = [];
	const re = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
	for (let m = re.exec(css); m; m = re.exec(css)) {
		const body = m[2] ?? '';
		const prop = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? '';
		const src = /url\(([^)]+)\)\s*(?:format\(['"]?([\w-]+)['"]?\))?/.exec(body);
		if (!src?.[1]) continue;
		blocks.push({
			label: m[1] ?? '',
			style: prop('font-style') || 'normal',
			weight: prop('font-weight') || '400',
			range: prop('unicode-range'),
			url: src[1].replace(/['"]/g, ''),
			format: src[2] ?? '',
		});
	}
	return blocks;
}

export async function fetchBlocks(family: string, tuples: string[]): Promise<Block[]> {
	const res = await requestUrl({ url: cssUrl(family, tuples), headers: { 'User-Agent': UA } });
	return parseCss(res.text);
}

function slug(family: string): string {
	return family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Downloads the blocks' files into `dir/<family>/`, skipping files already there. */
export async function downloadBlocks(adapter: DataAdapter, dir: string, family: string, blocks: Block[]): Promise<Face[]> {
	const folder = normalizePath(`${dir}/${slug(family)}`);
	if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
	const faces: Face[] = [];
	for (const b of blocks) {
		const name = b.url.split('/').pop()?.split('?')[0] ?? '';
		if (!/^[\w.-]+$/.test(name)) continue;
		const file = `${folder}/${name}`;
		if (!(await adapter.exists(file))) {
			const res = await requestUrl({ url: b.url });
			await adapter.writeBinary(file, res.arrayBuffer);
		}
		faces.push({ style: b.style, weight: b.weight, range: b.range, file, format: b.format });
	}
	return faces;
}

/**
 * FontFace objects in each window's document.fonts. Every window (main, popouts, the settings
 * window of Obsidian 1.15+) has its own font set. The lint rules forbid <style> elements, and this unloads cleanly.
 */
export class FaceSet {
	private faces: { doc: Document; face: FontFace }[] = [];

	add(doc: Document, family: string, src: string, d: { style: string; weight: string; range: string }): void {
		const desc: FontFaceDescriptors = { style: d.style, weight: d.weight, display: 'swap' };
		if (d.range) desc.unicodeRange = d.range;
		try {
			// The window's own FontFace: a face built in another window's realm is rejected.
			const Face = (doc.defaultView as (Window & { FontFace: typeof FontFace }) | null)?.FontFace ?? FontFace;
			const face = new Face(family, src, desc);
			doc.fonts.add(face);
			this.faces.push({ doc, face });
		} catch (e) {
			console.warn('Font Tailor: bad font face', family, e);
		}
	}

	clear(): void {
		for (const { doc, face } of this.faces) doc.fonts.delete(face);
		this.faces = [];
	}
}

/** Picker previews, straight from Google while the settings are open. Applied fonts never use these. */
export class PreviewFonts {
	private faces = new FaceSet();
	private loaded = new Set<string>();

	load(doc: Document, family: string, tuples: string[], keep: (label: string) => boolean): void {
		const key = `${family}|${[...tuples].sort().join(';')}`;
		if (this.loaded.has(key)) return;
		this.loaded.add(key);
		fetchBlocks(family, tuples)
			.then((blocks) => blocks.filter((b) => keep(b.label)).forEach((b) => this.faces.add(doc, family, `url("${b.url}")`, b)))
			.catch(() => this.loaded.delete(key));
	}

	clear(): void {
		this.faces.clear();
		this.loaded.clear();
	}
}
