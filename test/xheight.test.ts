// Matching x-height of mixed fonts. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FontInfo, type SlotValues, exRatio, xHeightAdjust } from '../src/slots.ts';

const font = (family: string): FontInfo => ({ family, category: 'mono', subsets: ['latin'], weights: [400, 700], italics: [] });
const info = (f: string) => font(f);
const v = (family: string, italic = false) => ({ family, weight: 400, italic });

void test('exRatio turns a 100ex box into x-height / font-size', () => {
	// JetBrains Mono: x-height 0.55 em, so 100ex at 100px is 5500px wide.
	assert.equal(exRatio(5500, 100), 0.55);
	assert.equal(exRatio(4000, 16), null); // 2.5 em is no real x-height: a failed measurement
	assert.equal(exRatio(5234.6, 100), 0.523);
	assert.equal(exRatio(0, 100), null);
	assert.equal(exRatio(NaN, 100), null);
});

void test('only inline slots whose family differs from Text get the adjust', () => {
	const values: SlotValues = { text: v('JetBrains Mono'), 'text.italic': v('Caveat', true) };
	// Bold and bold italic inherit; bold italic follows Italic, so it is Caveat too.
	assert.deepEqual(xHeightAdjust(values, info, 0.55), { 'text.italic': 0.55, 'text.boldItalic': 0.55 });
});

void test('same family as Text, headings and code blocks are left alone', () => {
	const values: SlotValues = {
		text: v('Literata'),
		'text.bold': v('Literata'),
		headings: v('Playfair Display'),
		'mono.block': v('IBM Plex Mono'),
	};
	assert.deepEqual(xHeightAdjust(values, info, 0.5), {});
});

void test('inline code and an empty Text slot', () => {
	// Text empty: Obsidian's font is the text, and its measured ratio is passed in.
	const values: SlotValues = { mono: v('JetBrains Mono'), 'text.italic': v('Caveat', true) };
	assert.deepEqual(xHeightAdjust(values, info, 0.52), { 'text.italic': 0.52, 'text.boldItalic': 0.52, 'mono.inline': 0.52 });
	assert.deepEqual(xHeightAdjust({}, info, 0.52), {});
});
