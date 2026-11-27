// "In use" and "downloaded" checks. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FontInfo, type SlotValues, downloadState, formatSize, inUseLabel, tupleStyles, usedBy, usedFirst } from '../src/slots.ts';

const lora: FontInfo = { family: 'Lora', category: 'serif', subsets: ['latin'], weights: [400, 700], italics: [400, 700] };

void test('usedBy lists the set slots per family, in slot order', () => {
	const values: SlotValues = {
		'text.italic': { family: 'Lora', weight: 400, italic: true },
		text: { family: 'Lora', weight: 400, italic: false },
		mono: { family: 'JetBrains Mono', weight: 400, italic: false },
	};
	const used = usedBy(values);
	assert.deepEqual(used.get('Lora'), ['text', 'text.italic']);
	assert.deepEqual(used.get('JetBrains Mono'), ['mono']);
	assert.equal(used.has('Literata'), false);
	assert.equal(inUseLabel(used.get('Lora') ?? []), 'In use: Text, Italic');
	assert.equal(usedBy({}).size, 0);
});

void test('downloadState tells full from partial', () => {
	assert.equal(downloadState(undefined, lora), null);
	assert.equal(downloadState({ tuples: [], scripts: [] }, lora), null);
	assert.equal(downloadState({ tuples: ['0,400'], scripts: ['latin'] }, lora), 'partial');
	assert.equal(downloadState({ tuples: ['0,400', '0,700', '1,400', '1,700'], scripts: ['latin'] }, lora), 'full');
});

void test('tupleStyles names styles, uprights first', () => {
	assert.deepEqual(tupleStyles(['1,400', '0,700', '0,400', '1,700']), ['Regular', 'Bold', 'Italic', 'Bold italic']);
});

void test('usedFirst moves used items up and keeps the order', () => {
	assert.deepEqual(usedFirst(['a', 'b', 'c', 'd'], (x) => x === 'c' || x === 'd'), ['c', 'd', 'a', 'b']);
	assert.deepEqual(usedFirst(['a', 'b'], () => false), ['a', 'b']);
});

void test('formatSize', () => {
	assert.equal(formatSize(300), '1 KB');
	assert.equal(formatSize(51200), '50 KB');
	assert.equal(formatSize(2.5 * 1048576), '2.5 MB');
});
