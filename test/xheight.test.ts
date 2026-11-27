/// <reference types="node" />
// Size: x-height matching (Auto), manual sizes, their inheritance, and loading old settings. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FontInfo, type Resolved, type SlotValues, exRatio, loadSlots, sizeAdjust, slotSize } from '../src/slots.ts';

const font = (family: string): FontInfo => ({ family, category: 'mono', subsets: ['latin'], weights: [400, 700], italics: [] });
const info = (f: string) => font(f);
const v = (family: string, italic = false, size?: number) => ({ family, weight: 400, italic, ...(size ? { size } : {}) });
// x-height / font-size per family; Obsidian's own font (family null) is 0.52.
const RATIO: Record<string, number> = { 'JetBrains Mono': 0.55, Caveat: 0.4, Literata: 0.5, 'Playfair Display': 0.52, 'IBM Plex Mono': 0.53 };
const ratio = (r: Resolved) => (r.family ? RATIO[r.family] : 0.52);
const adjust = (values: SlotValues, match = true) => sizeAdjust(values, info, ratio, match);

void test('exRatio turns a 100ex box into x-height / font-size', () => {
	// JetBrains Mono: x-height 0.55 em, so 100ex at 100px is 5500px wide.
	assert.equal(exRatio(5500, 100), 0.55);
	assert.equal(exRatio(4000, 16), null); // 2.5 em is no real x-height: a failed measurement
	assert.equal(exRatio(5234.6, 100), 0.523);
	assert.equal(exRatio(0, 100), null);
	assert.equal(exRatio(NaN, 100), null);
});

void test('Auto: inline slots in another family than Text get Text\'s x-height', () => {
	const values: SlotValues = { text: v('JetBrains Mono'), 'text.italic': v('Caveat', true) };
	// Bold and bold italic inherit; bold italic follows Italic, so it is Caveat too.
	assert.deepEqual(adjust(values), { 'text.italic': 0.55, 'text.boldItalic': 0.55 });
	assert.deepEqual(adjust(values, false), {});
});

void test('Auto: same family as Text, headings and code blocks are left alone', () => {
	const values: SlotValues = { text: v('Literata'), 'text.bold': v('Literata'), headings: v('Playfair Display'), 'mono.block': v('IBM Plex Mono') };
	assert.deepEqual(adjust(values), {});
});

void test('Auto: inline code and an empty Text slot', () => {
	// Text empty: Obsidian's font is the text, and its measured ratio is used.
	const values: SlotValues = { mono: v('JetBrains Mono'), 'text.italic': v('Caveat', true) };
	assert.deepEqual(adjust(values), { 'text.italic': 0.52, 'text.boldItalic': 0.52, 'mono.inline': 0.52 });
	assert.deepEqual(adjust({}), {});
});

void test('a manual size scales the slot by exactly that factor', () => {
	const values: SlotValues = { text: v('JetBrains Mono'), 'text.italic': v('Caveat', true, 1.15) };
	// Caveat's own ratio times 1.15, instead of Text's x-height.
	assert.equal(adjust(values)['text.italic'], 0.46);
	assert.equal(adjust(values, false)['text.italic'], 0.46);
});

void test('children that inherit the font inherit the size, unless they set their own', () => {
	const values: SlotValues = { text: v('Literata', false, 1.2), headings: v('Playfair Display'), h2: v('Playfair Display', false, 0.9) };
	assert.equal(slotSize(values, 'text.italic', info), 1.2);
	assert.equal(slotSize(values, 'h1', info), undefined); // Headings sets its own font, on Auto
	assert.equal(slotSize(values, 'h2', info), 0.9);
	const a = adjust(values);
	assert.equal(a.text, 0.6);
	assert.equal(a['text.italic'], 0.6);
	assert.equal(a['text.boldItalic'], 0.6);
	assert.equal(a.h1, undefined);
	assert.equal(a.h2, 0.468);
	// Monospace is not under Text, so Text's size does not reach it.
	assert.equal(adjust({ ...values, mono: v('JetBrains Mono') })['mono.block'], undefined);
});

void test('Auto inline slots follow a sized Text', () => {
	const values: SlotValues = { text: v('JetBrains Mono', false, 1.1), 'text.italic': v('Caveat', true), 'text.bold': v('JetBrains Mono') };
	const a = adjust(values);
	assert.equal(a['text.italic'], 0.605); // Text's x-height at 110%
	assert.equal(a['text.bold'], 0.605); // own font, Auto: as tall as the sized Text
	assert.equal(adjust(values, false)['text.italic'], 0.44); // no matching: Caveat at 110%
});

void test('settings from 1.0 load unchanged; bad sizes are dropped', () => {
	const old: SlotValues = { text: v('Literata'), mono: v('JetBrains Mono') };
	assert.deepEqual(loadSlots(old), old);
	assert.deepEqual(loadSlots(undefined), {});
	const saved = { text: { ...v('Literata'), size: 1.15 }, h1: { ...v('Lora'), size: 7 }, h2: { ...v('Lora'), size: 'big' } } as unknown as SlotValues;
	assert.deepEqual(loadSlots(saved), { text: { ...v('Literata'), size: 1.15 }, h1: v('Lora'), h2: v('Lora') });
});
