// Fallback chain checks, ported from the mockup's self-check. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FontInfo, type SlotValues, controls, fakeNote, resolve } from '../src/slots.ts';
import { defaultScripts, keepsBlock, missingScripts } from '../src/scripts.ts';

const font = (family: string, weights: number[], italics: number[] = weights, subsets = ['latin', 'cyrillic']): FontInfo =>
	({ family, category: 'serif', subsets, weights, italics });
const FONTS = [
	font('Literata', [300, 400, 500, 600, 700, 800]),
	font('Lora', [400, 500, 600, 700]),
	font('Playfair Display', [400, 500, 600, 700, 800, 900]),
	font('JetBrains Mono', [300, 400, 500, 600, 700, 800]),
	font('IBM Plex Mono', [300, 400, 500, 600, 700]),
	font('Golos Text', [400, 500, 600, 700, 800], []),
	font('Lobster', [400], []),
];
const info = (f: string) => FONTS.find((x) => x.family === f);

const precise: SlotValues = {
	text: { family: 'Literata', weight: 400, italic: false },
	'text.italic': { family: 'Lora', weight: 400, italic: true },
	'text.bold': { family: 'Literata', weight: 600, italic: false },
	headings: { family: 'Playfair Display', weight: 700, italic: false },
	h1: { family: 'Playfair Display', weight: 900, italic: false },
	interface: { family: 'Golos Text', weight: 400, italic: false },
	mono: { family: 'JetBrains Mono', weight: 400, italic: false },
	'mono.block': { family: 'IBM Plex Mono', weight: 400, italic: false },
};

void test('bold italic follows Bold, then Italic, then Text', () => {
	assert.deepEqual(pick(resolve(precise, 'text.boldItalic', info)), ['Literata', 600, true]);
	const noBold = { ...precise };
	delete noBold['text.bold'];
	assert.deepEqual(pick(resolve(noBold, 'text.boldItalic', info)), ['Lora', 700, true]);
	assert.deepEqual(pick(resolve({ text: precise.text }, 'text.boldItalic', info)), ['Literata', 700, true]);
});

void test('headings fall back to Text, levels to Headings', () => {
	assert.deepEqual(pick(resolve(precise, 'h2', info)), ['Playfair Display', 700, false]);
	assert.deepEqual(pick(resolve(precise, 'h1', info)), ['Playfair Display', 900, false]);
	assert.deepEqual(pick(resolve({ text: precise.text }, 'h3', info)), ['Literata', 700, false]);
});

void test('code falls back to Monospace', () => {
	assert.equal(resolve(precise, 'mono.inline', info).family, 'JetBrains Mono');
	assert.equal(resolve(precise, 'mono.block', info).family, 'IBM Plex Mono');
	assert.equal(resolve(precise, 'mono.inline', info).role, 'mono');
});

void test('empty means Obsidian default', () => {
	assert.equal(resolve({}, 'headings', info).family, null);
	assert.equal(resolve({}, 'interface', info).family, null);
	assert.equal(resolve({ text: precise.text }, 'interface', info).family, null);
});

void test('missing weights snap to the nearest and are flagged', () => {
	const r = resolve({ text: { family: 'Lobster', weight: 400, italic: false } }, 'text.bold', info);
	assert.equal(r.weight, 400);
	assert.equal(fakeNote(r, info), 'no 700 weight');
	const i = resolve({ text: { family: 'Golos Text', weight: 400, italic: false } }, 'text.italic', info);
	assert.equal(fakeNote(i, info), 'slanted, no true italic');
});

void test('a set slot stops the chain for hover highlighting', () => {
	assert.equal(controls(precise, 'text', 'text.italic'), false);
	assert.equal(controls(precise, 'headings', 'h2'), true);
	assert.equal(controls(precise, 'headings', 'h1'), false);
	assert.equal(controls(precise, 'text.bold', 'text.boldItalic'), true);
});

void test('scripts: defaults, missing, downloaded blocks', () => {
	assert.deepEqual(defaultScripts(['ru', 'en-US']), ['latin', 'cyrillic']);
	assert.deepEqual(defaultScripts(['ja']), ['latin', 'japanese']);
	assert.deepEqual(defaultScripts(['zh-TW']), ['latin', 'chinese-traditional']);
	assert.deepEqual(missingScripts(['latin'], ['latin', 'cyrillic']).map((s) => s.id), ['cyrillic']);
	assert.ok(keepsBlock('cyrillic-ext', ['cyrillic']));
	assert.ok(keepsBlock('latin', []));
	assert.ok(!keepsBlock('greek', ['cyrillic']));
	assert.ok(!keepsBlock('[3]', ['cyrillic']));
	assert.ok(keepsBlock('[3]', ['japanese']));
});

function pick(r: { family: string | null; weight: number; italic: boolean }) {
	return [r.family, r.weight, r.italic];
}
