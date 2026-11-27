import { fontCss } from './apply';
import { Script } from './scripts';
import { FontLookup, SLOTS, SlotId, SlotValues, resolve, styleName } from './slots';

/** Splits a sample line on *italic*, **bold**, ***bold italic*** and `code`. */
export function parseLine(line: string): { text: string; slot: SlotId }[] {
	const out: { text: string; slot: SlotId }[] = [];
	const re = /(\*{1,3}|`)(.+?)\1/g;
	let last = 0;
	for (let m = re.exec(line); m; m = re.exec(line)) {
		if (m.index > last) out.push({ text: line.slice(last, m.index), slot: 'text' });
		const mark = m[1];
		const slot: SlotId = mark === '`' ? 'mono.inline' : mark === '*' ? 'text.italic' : mark === '**' ? 'text.bold' : 'text.boldItalic';
		out.push({ text: m[2] ?? '', slot });
		last = m.index + m[0].length;
	}
	if (last < line.length) out.push({ text: line.slice(last), slot: 'text' });
	return out;
}

/** A sample note with one line per chosen script. Every part carries data-slot so hover and click can find it. */
export function renderNote(el: HTMLElement, scripts: Script[], values: SlotValues, info: FontLookup, adjust: Partial<Record<SlotId, number>> = {}): void {
	el.empty();
	const part = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, slot: SlotId, text: string) => {
		const r = resolve(values, slot, info);
		const node = parent.createEl(tag, { text, attr: { 'data-slot': slot, tabindex: '0', role: 'button' } });
		node.setCssStyles({ ...fontCss(r), fontSizeAdjust: String(adjust[slot] ?? 'none') });
		node.title = `${SLOTS[slot].name}: ${r.family ?? 'Obsidian default'} ${styleName(r.weight, r.italic)}`;
		return node;
	};
	part(el.createDiv('ft-note-tabbar'), 'span', 'interface', 'Notes / Font diary');
	const body = el.createDiv('ft-note-body');
	type Level = 1 | 2 | 3 | 4 | 5 | 6;
	const heading = (level: Level) => scripts.map((s) => `${s.heading} ${level}`).join(' · ');
	const h = (level: Level) => part(body, 'div', `h${level}`, heading(level)).addClasses(['ft-h', `ft-h${level}`]);
	h(1);
	for (const s of scripts) {
		const p = body.createEl('p', { attr: { dir: 'auto' } });
		for (const seg of parseLine(s.line)) {
			const tag = seg.slot === 'mono.inline' ? 'code' : seg.slot === 'text.bold' ? 'strong' : seg.slot === 'text' ? 'span' : 'em';
			part(p, tag, seg.slot, seg.text);
		}
	}
	h(2);
	part(body, 'p', 'text', scripts.map((s) => s.sample).join('. ') + '.');
	h(3);
	h(4);
	h(5);
	h(6);
	const pre = part(body, 'pre', 'mono.block', '');
	pre.createSpan({ cls: 'ft-c', text: '// 0O 1lI {} [] => !=' });
	for (const s of scripts) {
		pre.appendText(`\nconst ${s.id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())} = `);
		pre.createSpan({ cls: 'ft-s', text: `"${s.sample.split(' ').slice(0, 3).join(' ')}"` });
		pre.appendText(';');
	}
}
