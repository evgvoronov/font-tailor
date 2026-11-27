/// <reference types="node" />
// Font file parsing on synthetic fonts built here, so no font files are needed. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { fromFileName, readFontFile } from '../src/fontfile.ts';

const be16 = (n: number) => [n >> 8 & 255, n & 255];
const be32 = (n: number) => [...be16(n >>> 16), ...be16(n & 0xffff)];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function nameTable(records: [number, string][]): number[] {
	const strings: number[] = [];
	const recs: number[] = [];
	for (const [id, text] of records) {
		const bytes = [...text].flatMap((c) => be16(c.charCodeAt(0)));
		recs.push(...be16(3), ...be16(1), ...be16(0x409), ...be16(id), ...be16(bytes.length), ...be16(strings.length));
		strings.push(...bytes);
	}
	return [...be16(0), ...be16(records.length), ...be16(6 + recs.length), ...recs, ...strings];
}

// cmap format 4 with one segment per range, plus the required 0xFFFF end segment.
function cmapTable(ranges: [number, number][]): number[] {
	const segs = [...ranges, [0xffff, 0xffff] as [number, number]];
	const n = segs.length;
	const sub = [
		...be16(4), ...be16(0), ...be16(0), ...be16(n * 2), ...be16(0), ...be16(0), ...be16(0),
		...segs.flatMap(([, e]) => be16(e)), ...be16(0), ...segs.flatMap(([s]) => be16(s)),
		...segs.flatMap(() => be16(1)), ...segs.flatMap(() => be16(0)),
	];
	sub.splice(2, 2, ...be16(sub.length));
	return [...be16(0), ...be16(1), ...be16(3), ...be16(1), ...be32(12), ...sub];
}

function os2(weight: number, italic: boolean): number[] {
	const t = new Array(78).fill(0) as number[];
	t.splice(4, 2, ...be16(weight));
	t.splice(62, 2, ...be16(italic ? 1 : 0));
	return t;
}

const post = (mono: boolean) => [...be32(0x30000), ...new Array(8).fill(0) as number[], ...be32(mono ? 1 : 0), ...new Array(16).fill(0) as number[]];

const TABLES: [string, number[]][] = [
	['OS/2', os2(700, true)],
	['cmap', cmapTable([[0x20, 0x7e], [0x400, 0x45f]])],
	['name', nameTable([[1, 'Test Sans Bold'], [2, 'Bold Italic'], [16, 'Test Sans'], [17, 'Bold Italic']])],
	['post', post(false)],
];

function sfnt(tables: [string, number[]][]): Uint8Array {
	const out = [...be32(0x10000), ...be16(tables.length), 0, 0, 0, 0, 0, 0];
	let off = 12 + 16 * tables.length;
	const body: number[] = [];
	for (const [tag, data] of tables) {
		out.push(...ascii(tag), ...be32(0), ...be32(off + body.length), ...be32(data.length));
		body.push(...data, ...new Array((4 - data.length % 4) % 4).fill(0) as number[]);
	}
	return new Uint8Array([...out, ...body]);
}

function woff(tables: [string, number[]][]): Uint8Array {
	const head = [...ascii('wOFF'), ...be32(0x10000), ...be32(0), ...be16(tables.length), ...new Array(30).fill(0) as number[]];
	let off = 44 + 20 * tables.length;
	const dir: number[] = [];
	const body: number[] = [];
	for (const [tag, data] of tables) {
		const z = [...deflateSync(Uint8Array.from(data))];
		dir.push(...ascii(tag), ...be32(off + body.length), ...be32(z.length), ...be32(data.length), ...be32(0));
		body.push(...z, ...new Array((4 - z.length % 4) % 4).fill(0) as number[]);
	}
	return new Uint8Array([...head, ...dir, ...body]);
}

const reader = (b: Uint8Array) => async (o: number, n: number) => b.subarray(o, o + n);
const expected = { family: 'Test Sans', weight: 700, italic: true, mono: false, scripts: ['latin', 'cyrillic'] };

void test('reads a TTF: typographic family, weight, italic, scripts from cmap', async () => {
	assert.deepEqual(await readFontFile(reader(sfnt(TABLES)), 'TestSans-BoldItalic.ttf'), [expected]);
});

void test('reads a WOFF by inflating its tables', async () => {
	assert.deepEqual(await readFontFile(reader(woff(TABLES)), 'TestSans-BoldItalic.woff'), [expected]);
});

void test('rejects files that are not fonts', async () => {
	await assert.rejects(readFontFile(reader(new TextEncoder().encode('hello, not a font')), 'x.ttf'));
});

void test('WOFF2 falls back to the file name', async () => {
	const b = new Uint8Array([...ascii('wOF2'), ...new Array(8).fill(0) as number[]]);
	assert.deepEqual(await readFontFile(reader(b), 'Inter-SemiBoldItalic.woff2'), [{ family: 'Inter', weight: 600, italic: true, mono: false, scripts: null }]);
	assert.deepEqual(fromFileName('lora_700_italic.woff2'), { family: 'lora', weight: 700, italic: true, mono: false, scripts: null });
	assert.deepEqual(fromFileName('JetBrainsMono-Regular.woff2'), { family: 'JetBrainsMono', weight: 400, italic: false, mono: true, scripts: null });
	assert.equal(fromFileName('Roboto-ExtraLight.woff2').weight, 200);
});
