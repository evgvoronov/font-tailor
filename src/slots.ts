// Slot tree and the fallback chain. No Obsidian imports, so the test can run it in plain Node.

export type SlotId =
	| 'text' | 'text.italic' | 'text.bold' | 'text.boldItalic'
	| 'headings' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
	| 'interface'
	| 'mono' | 'mono.inline' | 'mono.block';

export interface SlotValue {
	family: string;
	weight: number;
	italic: boolean;
}

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
