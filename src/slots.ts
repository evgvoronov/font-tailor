// Slot tree, the fallback chain, and which fonts are in use or downloaded. No Obsidian imports, so the test can run it in plain Node.

export type SlotId =
	| 'text' | 'text.italic' | 'text.bold' | 'text.boldItalic'
	| 'headings' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
	| 'interface'
	| 'mono' | 'mono.inline' | 'mono.block';

export interface SlotValue {
	family: string;
	weight: number;
	italic: boolean;
	/** Manual size factor, SIZE_MIN to SIZE_MAX. Unset means Auto. */
	size?: number;
}

export const SIZE_MIN = 0.8;
export const SIZE_MAX = 1.3;

export type SlotValues = Partial<Record<SlotId, SlotValue>>;

/** Which Obsidian font a slot falls back to when nothing up its chain is set. */
export type Role = 'text' | 'interface' | 'mono';

interface SlotDef {
	name: string;
	desc?: string;
	parent?: SlotId;
	role?: Role;
	/** Style the slot adds to what it inherits. */
	own?: { weight?: number; italic?: boolean };
}

export const SLOTS: Record<SlotId, SlotDef> = {
	text: { name: 'Text', desc: 'Notes in editing and reading view', role: 'text' },
	'text.italic': { name: 'Italic', desc: '*emphasis*', parent: 'text', own: { italic: true } },
	'text.bold': { name: 'Bold', desc: '**strong**', parent: 'text', own: { weight: 700 } },
	'text.boldItalic': { name: 'Bold italic', desc: '***both***', parent: 'text' }, // parent picked at runtime
	headings: { name: 'Headings', desc: 'All heading levels', parent: 'text', own: { weight: 700 } },
	h1: { name: 'H1', parent: 'headings' },
	h2: { name: 'H2', parent: 'headings' },
	h3: { name: 'H3', parent: 'headings' },
	h4: { name: 'H4', parent: 'headings' },
	h5: { name: 'H5', parent: 'headings' },
	h6: { name: 'H6', parent: 'headings' },
	interface: { name: 'Interface', desc: 'Menus, sidebars, tabs, this settings window', role: 'interface' },
	mono: { name: 'Monospace', desc: 'Code, frontmatter, tables in source mode', role: 'mono' },
	'mono.inline': { name: 'Inline code', desc: '`code` inside a paragraph', parent: 'mono' },
	'mono.block': { name: 'Code blocks', desc: 'Fenced ``` blocks', parent: 'mono' },
};

export const SLOT_IDS = Object.keys(SLOTS) as SlotId[];

export const AREAS: { id: SlotId; kids: SlotId[]; summary?: string }[] = [
	{ id: 'text', kids: ['text.italic', 'text.bold', 'text.boldItalic'], summary: 'Italic, bold, bold italic' },
	{ id: 'headings', kids: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], summary: 'Each level H1 to H6' },
	{ id: 'interface', kids: [] },
	{ id: 'mono', kids: ['mono.inline', 'mono.block'], summary: 'Inline code, code blocks' },
];

/** Where a font comes from. Google fonts are downloaded; the rest are used where they are. */
export type Source = 'google' | 'vault' | 'folder' | 'system';

/** One face of a local font: a vault path (vault) or an absolute path (folder). */
export interface LocalFile {
	path: string;
	weight: number;
	italic: boolean;
}

/** What the catalog knows about a family. */
export interface FontInfo {
	family: string;
	category: string;
	subsets: string[];
	weights: number[];
	/** Weights that have a true italic. */
	italics: number[];
	/** Unset means Google. */
	source?: Source;
	/** The configured vault or device folder a local font was found in. */
	origin?: string;
	files?: LocalFile[];
	/** WOFF2 files whose scripts could not be read yet. */
	unknownScripts?: boolean;
}

export type FontLookup = (family: string) => FontInfo | undefined;

export interface Resolved {
	/** null means Obsidian's own font. */
	family: string | null;
	weight: number;
	italic: boolean;
	/** Slot that supplied the family, or null. */
	from: SlotId | null;
	role: Role;
	/** Weight the chain asked for before snapping to the family's weights. */
	wantWeight: number;
}

export function parentOf(values: SlotValues, id: SlotId): SlotId | null {
	if (id === 'text.boldItalic') {
		if (values['text.bold']) return 'text.bold';
		if (values['text.italic']) return 'text.italic';
		return 'text';
	}
	return SLOTS[id].parent ?? null;
}

function ownOf(values: SlotValues, id: SlotId): { weight?: number; italic?: boolean } {
	if (id === 'text.boldItalic') {
		const p = parentOf(values, id);
		return p === 'text.bold' ? { italic: true } : p === 'text.italic' ? { weight: 700 } : { weight: 700, italic: true };
	}
	return SLOTS[id].own ?? {};
}

export function slotRole(id: SlotId): Role {
	let s = id;
	for (let p = SLOTS[s].parent; p; p = SLOTS[s].parent) s = p;
	return SLOTS[s].role ?? 'text';
}

export function nearestWeight(weights: number[], want: number): number {
	return weights.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), weights[0] ?? want);
}

export function resolve(values: SlotValues, id: SlotId, info: FontLookup = () => undefined): Resolved {
	const role = slotRole(id);
	const v = values[id];
	if (v) return { family: v.family, weight: v.weight, italic: v.italic, from: id, role, wantWeight: v.weight };
	const p = parentOf(values, id);
	const own = ownOf(values, id);
	const base = p ? resolve(values, p, info) : { family: null, weight: 400, italic: false, from: null };
	const want = own.weight ?? base.weight;
	const font = base.family ? info(base.family) : undefined;
	return {
		family: base.family,
		weight: font ? nearestWeight(font.weights, want) : want,
		italic: own.italic ?? base.italic,
		from: base.from,
		role,
		wantWeight: want,
	};
}

/** Does `slot` decide the font of text that belongs to `target`? Walks up until a set slot stops the chain. */
export function controls(values: SlotValues, slot: SlotId, target: SlotId): boolean {
	for (let s: SlotId | null = target; s; s = parentOf(values, s)) {
		if (s === slot) return true;
		if (values[s]) return false;
	}
	return false;
}

const WEIGHT_NAME: Record<number, string> = {
	100: 'Thin', 200: 'Extralight', 300: 'Light', 400: 'Regular', 500: 'Medium',
	600: 'Semibold', 700: 'Bold', 800: 'Extrabold', 900: 'Black',
};

export function weightName(w: number): string {
	return WEIGHT_NAME[w] ?? String(w);
}

export function styleName(weight: number, italic: boolean): string {
	if (!italic) return weightName(weight);
	return weight === 400 ? 'Italic' : `${weightName(weight)} italic`;
}

/** A style the family cannot draw, so the browser fakes it. Shown so the user knows why it looks off. */
export function fakeNote(r: Resolved, info: FontLookup): string {
	const font = r.family ? info(r.family) : undefined;
	if (!font) return '';
	if (r.italic && !font.italics.length) return 'slanted, no true italic';
	if (r.italic && !font.italics.includes(r.weight)) return `no ${r.weight} italic`;
	if (r.wantWeight > r.weight + 100) return `no ${r.wantWeight} weight`;
	return '';
}

// ---------- Which fonts the slots use and what is downloaded ----------

/** What is on disk for a Google family; the same shape as FamilyFiles in fonts.ts. */
export interface Downloaded {
	tuples: string[];
	scripts: string[];
}

/** Family to the set slots that chose it, in slot order. Slots that only inherit a font are left out. */
export function usedBy(values: SlotValues): Map<string, SlotId[]> {
	const used = new Map<string, SlotId[]>();
	for (const id of SLOT_IDS) {
		const v = values[id];
		if (v) used.set(v.family, [...(used.get(v.family) ?? []), id]);
	}
	return used;
}

/** "In use: Text, Italic". */
export function inUseLabel(slots: SlotId[]): string {
	return `In use: ${slots.map((s) => SLOTS[s].name).join(', ')}`;
}

/** Full when every weight and italic of the family is on disk. */
export function downloadState(files: Downloaded | undefined, font: FontInfo): 'full' | 'partial' | null {
	if (!files?.tuples.length) return null;
	return files.tuples.length < font.weights.length + font.italics.length ? 'partial' : 'full';
}

/** Style names of "ital,wght" tuples, uprights first, by weight. */
export function tupleStyles(tuples: string[]): string[] {
	return tuples
		.map((t) => t.split(',').map(Number) as [number, number])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1])
		.map(([i, w]) => styleName(w, i === 1));
}

/** Fonts in use first; the order within each group stays. */
export function usedFirst<T>(list: T[], used: (item: T) => boolean): T[] {
	return [...list.filter(used), ...list.filter((x) => !used(x))];
}

export function formatSize(bytes: number): string {
	return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

// ---------- Size: matching x-height of mixed fonts, or a manual factor ----------

/** Slots drawn inside a line of Text, so their font sits next to Text's. */
const INLINE: SlotId[] = ['text.italic', 'text.bold', 'text.boldItalic', 'mono.inline'];

/** Manual size of a slot: its own, or that of the slot it takes its font from. Undefined means Auto. */
export function slotSize(values: SlotValues, id: SlotId, info: FontLookup = () => undefined): number | undefined {
	const from = resolve(values, id, info).from;
	return from ? values[from]?.size : undefined;
}

/**
 * font-size-adjust per slot. `ratio` gives a font's x-height / font-size, undefined until measured.
 * Manual size: the font's own ratio times the size, so it grows by exactly that factor.
 * Auto, inline slots only: as tall as the Text around it (Text's own size included), and with `match`
 * a different family gets Text's x-height. Block slots on Auto are left alone.
 */
export function sizeAdjust(values: SlotValues, info: FontLookup, ratio: (r: Resolved) => number | undefined, match: boolean): Partial<Record<SlotId, number>> {
	const text = resolve(values, 'text', info);
	const textSize = slotSize(values, 'text', info) ?? 1;
	const times = (r: number | undefined, f: number) => (r === undefined ? undefined : Math.round(r * f * 1000) / 1000);
	const out: Partial<Record<SlotId, number>> = {};
	for (const id of SLOT_IDS) {
		const r = resolve(values, id, info);
		if (!r.family) continue;
		const size = slotSize(values, id, info);
		let a: number | undefined;
		if (size !== undefined) a = times(ratio(r), size);
		else if (INLINE.includes(id)) {
			if (match && r.family !== text.family) a = times(ratio(text), textSize);
			else if (textSize !== 1) a = times(ratio(r), textSize);
		}
		if (a) out[id] = a;
	}
	return out;
}

/** Slots as any version saved them. 1.0 had no size; a size outside the slider's range is dropped. */
export function loadSlots(saved: SlotValues | undefined): SlotValues {
	const out: SlotValues = {};
	for (const [id, v] of Object.entries(saved ?? {}) as [SlotId, SlotValue][]) {
		const { size, ...rest } = v;
		out[id] = typeof size === 'number' && size >= SIZE_MIN && size <= SIZE_MAX ? { ...rest, size } : rest;
	}
	return out;
}

/** x-height / font-size from the width of a `100ex` box at `fontPx`, rounded to 3 places. Null when it cannot be measured. */
export function exRatio(width100ex: number, fontPx: number): number | null {
	const r = width100ex / 100 / fontPx;
	return r > 0 && r < 2 ? Math.round(r * 1000) / 1000 : null;
}
