// Reads family, weight, italic, fixed pitch and covered scripts from TTF, OTF, TTC and WOFF files.
// WOFF2 tables are Brotli-compressed and Obsidian's Chromium has no Brotli DecompressionStream, so for
// WOFF2 only the file name is used here; scripts are then measured in the browser (see sources.ts).
// No Obsidian imports, so the test can run it in plain Node.

/** Reads `length` bytes at `offset`. Lets callers read only the tables they need from big files. */
export type Reader = (offset: number, length: number) => Promise<Uint8Array>;

export interface FontMeta {
	family: string;
	weight: number;
	italic: boolean;
	mono: boolean;
	/** Script ids (see scripts.ts) the cmap covers; null when unknown (WOFF2). */
	scripts: string[] | null;
}

// Code points a font must have to count as supporting a script.
export const SCRIPT_PROBES: Record<string, number[]> = {
	latin: [0x41, 0x7a],
	cyrillic: [0x416, 0x44f],
	greek: [0x3bb, 0x3a9],
	vietnamese: [0x1a1, 0x1ea1],
	arabic: [0x627, 0x644],
	hebrew: [0x5d0, 0x5ea],
	thai: [0xe01, 0xe2d],
	devanagari: [0x915, 0x93e],
	japanese: [0x3042, 0x30a2],
	korean: [0xac00, 0xd55c],
	'chinese-simplified': [0x4e2d, 0x8bf4],
	'chinese-traditional': [0x4e2d, 0x8aaa],
	'chinese-hongkong': [0x4e2d, 0x8aaa],
};

const u16 = (b: Uint8Array, o: number) => (b[o] ?? 0) << 8 | (b[o + 1] ?? 0);
const u32 = (b: Uint8Array, o: number) => ((u16(b, o) << 16) >>> 0) + u16(b, o + 2);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);

type Tables = Map<string, () => Promise<Uint8Array>>;

/** Parses every font in the file (TTC holds several). Throws on files it cannot read. */
export async function readFontFile(read: Reader, fileName: string): Promise<FontMeta[]> {
	const head = await read(0, 12);
	const sig = tag(head, 0);
	if (sig === 'wOF2') return [fromFileName(fileName)];
	if (sig === 'wOFF') return [await metaOf(await woffTables(read, await read(0, 44)))];
	if (sig === 'ttcf') {
		const n = u32(head, 8);
		const offsets = await read(12, 4 * n);
		const out: FontMeta[] = [];
		for (let i = 0; i < n; i++) out.push(await metaOf(await sfntTables(read, u32(offsets, 4 * i))));
		return out;
	}
	if (sig === '\0\x01\0\0' || sig === 'OTTO' || sig === 'true') return [await metaOf(await sfntTables(read, 0))];
	throw new Error(`Not a font: ${fileName}`);
}

async function sfntTables(read: Reader, at: number): Promise<Tables> {
	const n = u16(await read(at + 4, 2), 0);
	const dir = await read(at + 12, 16 * n);
	const tables: Tables = new Map();
	for (let i = 0; i < n; i++) {
		const o = 16 * i;
		const off = u32(dir, o + 8);
		const len = u32(dir, o + 12);
		tables.set(tag(dir, o), () => read(off, len));
	}
	return tables;
}

async function woffTables(read: Reader, head: Uint8Array): Promise<Tables> {
	const n = u16(head, 12);
	const dir = await read(44, 20 * n);
	const tables: Tables = new Map();
	for (let i = 0; i < n; i++) {
		const o = 20 * i;
		const off = u32(dir, o + 4);
		const comp = u32(dir, o + 8);
		const orig = u32(dir, o + 12);
		tables.set(tag(dir, o), async () => {
			const data = await read(off, comp);
			return comp < orig ? inflate(data) : data;
		});
	}
	return tables;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function metaOf(tables: Tables): Promise<FontMeta> {
	const get = async (t: string) => (await tables.get(t)?.()) ?? null;
	const name = await get('name');
	const os2 = await get('OS/2');
	const headT = await get('head');
	const post = await get('post');
	const cmap = await get('cmap');
	const family = (name && (nameString(name, 16) ?? nameString(name, 1))) ?? '';
	if (!family) throw new Error('Font has no family name');
	const macStyle = headT ? u16(headT, 44) : 0;
	return {
		family,
		weight: os2 ? u16(os2, 4) || 400 : macStyle & 1 ? 700 : 400,
		italic: os2 ? (u16(os2, 62) & 1) === 1 : (macStyle & 2) === 2,
		mono: post ? u32(post, 12) !== 0 : false,
		scripts: cmap ? scriptsIn(cmap) : null,
	};
}

/** A name record, preferring Windows English, then any Windows, then Mac Roman. */
export function nameString(t: Uint8Array, id: number): string | null {
	const count = u16(t, 2);
	const strings = u16(t, 4);
	let best: { score: number; text: string } | null = null;
	for (let i = 0; i < count; i++) {
		const r = 6 + 12 * i;
		if (u16(t, r + 6) !== id) continue;
		const platform = u16(t, r);
		const lang = u16(t, r + 4);
		const len = u16(t, r + 8);
		const off = strings + u16(t, r + 10);
		const bytes = t.subarray(off, off + len);
		let text: string;
		let score: number;
		if (platform === 3 || platform === 0) {
			text = '';
			for (let j = 0; j + 1 < bytes.length; j += 2) text += String.fromCharCode(u16(bytes, j));
			score = platform === 3 && lang === 0x409 ? 3 : 2;
		} else if (platform === 1) {
			text = String.fromCharCode(...bytes);
			score = 1;
		} else continue;
		if (text.trim() && (!best || score > best.score)) best = { score, text: text.trim() };
	}
	return best?.text ?? null;
}

/** Scripts whose probe code points are all in the cmap (formats 4 and 12). */
export function scriptsIn(cmap: Uint8Array): string[] {
	const has = coverage(cmap);
	return Object.entries(SCRIPT_PROBES).filter(([, cps]) => cps.every(has)).map(([id]) => id);
}

function coverage(t: Uint8Array): (cp: number) => boolean {
	const n = u16(t, 2);
	let pick = -1;
	let pickFormat = 0;
	for (let i = 0; i < n; i++) {
		const off = u32(t, 4 + 8 * i + 4);
		const format = u16(t, off);
		if (format === 12 || (format === 4 && pickFormat !== 12)) {
			pick = off;
			pickFormat = format;
		}
	}
	if (pickFormat === 12) {
		const groups = u32(t, pick + 12);
		return (cp) => {
			for (let g = 0; g < groups; g++) {
				const o = pick + 16 + 12 * g;
				if (cp >= u32(t, o) && cp <= u32(t, o + 4)) return true;
			}
			return false;
		};
	}
	if (pickFormat === 4) {
		const segs = u16(t, pick + 6) / 2;
		const ends = pick + 14;
		const starts = ends + 2 * segs + 2;
		// shortcut: a code point inside a segment counts as covered even if it maps to glyph 0; fine for script detection.
		return (cp) => {
			for (let s = 0; s < segs; s++) if (cp <= u16(t, ends + 2 * s) && cp >= u16(t, starts + 2 * s) && cp !== 0xffff) return true;
			return false;
		};
	}
	return () => false;
}

const WEIGHT_WORDS: [RegExp, number][] = [
	[/thin|hairline/i, 100], [/extra-?light|ultra-?light/i, 200], [/light/i, 300], [/medium/i, 500],
	[/semi-?bold|demi-?bold/i, 600], [/extra-?bold|ultra-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];

const STYLE_TOKEN = /^(?:thin|hairline|extra|ultra|semi|demi|light|regular|normal|book|medium|bold|black|heavy|italic|oblique|[1-9]00|vf|variable)+$/i;

/** Family, weight and italic guessed from a name like "Inter-SemiBoldItalic.woff2" or "lora_700_italic.woff2". */
export function fromFileName(fileName: string): FontMeta {
	const base = (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]+$/, '');
	const tokens = base.split(/[-_\s]+/).filter(Boolean);
	const style: string[] = [];
	while (tokens.length > 1 && STYLE_TOKEN.test(tokens[tokens.length - 1] ?? '')) style.unshift(tokens.pop() ?? '');
	const s = style.join(' ');
	const family = tokens.join(' ');
	const num = /([1-9]00)/.exec(s)?.[1];
	return {
		family,
		weight: num ? Number(num) : WEIGHT_WORDS.find(([re]) => re.test(s))?.[1] ?? 400,
		italic: /italic|oblique/i.test(s),
		mono: /mono|code/i.test(family),
		scripts: null,
	};
}
