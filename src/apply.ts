import { FontLookup, Resolved, SlotId, SlotValues, resolve } from './slots';

// What Obsidian itself would use, so glyphs the chosen font lacks fall back to the user's normal font.
const FALLBACK: Record<Resolved['role'], string> = {
	text: 'var(--font-text-override), var(--font-text-theme), var(--font-default)',
	interface: 'var(--font-interface-override), var(--font-interface-theme), var(--font-default)',
	mono: 'var(--font-monospace-override), var(--font-monospace-theme), var(--font-monospace-default)',
};

export function fontStack(r: Resolved): string {
	return r.family ? `"${r.family}", ${FALLBACK[r.role]}` : FALLBACK[r.role];
}

export function fontCss(r: Resolved): Partial<CSSStyleDeclaration> {
	return { fontFamily: fontStack(r), fontWeight: String(r.weight), fontStyle: r.italic ? 'italic' : 'normal' };
}

// Slots that styles.css targets with a body class. The rest map straight onto Obsidian's variables.
const CLASS_KEY: Partial<Record<SlotId, string>> = {
	text: 'text', 'text.italic': 'italic', 'text.bold': 'bold', 'text.boldItalic': 'bold-italic',
	interface: 'interface', 'mono.inline': 'code-inline', 'mono.block': 'code-block',
};
const OBSIDIAN_VAR: Partial<Record<SlotId, string>> = {
	text: '--font-text', interface: '--font-interface', mono: '--font-monospace',
};
const HEADINGS: SlotId[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/** Sets body classes and inline variables for every slot that resolves to a font. clear() undoes all of it. */
export class BodyFonts {
	private applied: { body: HTMLElement; props: string[]; classes: string[] }[] = [];

	/** `adjust` is font-size-adjust per slot, from sizeAdjust(). */
	apply(bodies: HTMLElement[], values: SlotValues, info: FontLookup, adjust: Partial<Record<SlotId, number>> = {}): void {
		const props: Record<string, string> = {};
		const classes: string[] = [];
		for (const id of new Set([...Object.keys(CLASS_KEY), ...Object.keys(OBSIDIAN_VAR), ...HEADINGS] as SlotId[])) {
			const r = resolve(values, id, info);
			if (!r.family) continue;
			const stack = fontStack(r);
			const weight = String(r.weight);
			const style = r.italic ? 'italic' : 'normal';
			const obsidianVar = OBSIDIAN_VAR[id];
			if (obsidianVar) props[obsidianVar] = stack;
			if (HEADINGS.includes(id)) {
				props[`--${id}-font`] = stack;
				props[`--${id}-weight`] = weight;
				props[`--${id}-style`] = style;
				const a = adjust[id];
				if (a) props[`--ft-${id}-adjust`] = String(a);
			}
			const key = CLASS_KEY[id];
			if (key) {
				classes.push(`ft-${key}`);
				props[`--ft-${key}-family`] = stack;
				props[`--ft-${key}-weight`] = weight;
				props[`--ft-${key}-style`] = style;
				const a = adjust[id];
				if (a) props[`--ft-${key}-adjust`] = String(a);
			}
		}
		// Turns on the size rules in styles.css, which also stop one slot's size from reaching the next.
		if (Object.keys(adjust).length) classes.push('ft-sized');
		for (const body of bodies) {
			body.setCssProps(props);
			body.addClasses(classes);
			this.applied.push({ body, props: Object.keys(props), classes });
		}
	}

	clear(): void {
		for (const { body, props, classes } of this.applied) {
			for (const p of props) body.style.removeProperty(p);
			body.removeClasses(classes);
		}
		this.applied = [];
	}
}
