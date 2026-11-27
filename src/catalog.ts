import { DataAdapter, requestUrl } from 'obsidian';
import type { FontInfo } from './slots';

// Public JSON behind fonts.google.com. No API key. Sorted here by popularity.
const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const MAX_AGE = 30 * 24 * 3600 * 1000;

const CATEGORY: Record<string, string> = {
	'Sans Serif': 'sans', Serif: 'serif', Monospace: 'mono', Display: 'display', Handwriting: 'hand',
};

interface RawFamily {
	family: string;
	category: string;
	subsets: string[];
	fonts: Record<string, unknown>;
	popularity?: number;
}

interface CatalogFile {
	fetched: number;
	fonts: FontInfo[];
}

export function trimMetadata(text: string): FontInfo[] {
	// The endpoint once prefixed its JSON with an anti-XSSI guard; strip it if it comes back.
	const json = JSON.parse(text.replace(/^\)\]\}'\s*/, '')) as { familyMetadataList: RawFamily[] };
	return json.familyMetadataList
		.slice()
		.sort((a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9))
		.map((x) => {
			const keys = Object.keys(x.fonts);
			const nums = (italic: boolean) => keys.filter((k) => k.endsWith('i') === italic).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
			return {
				family: x.family,
				category: CATEGORY[x.category] ?? 'display',
				subsets: x.subsets.filter((s) => s !== 'menu'),
				weights: nums(false),
				italics: nums(true),
			};
		})
		.filter((f) => f.weights.length > 0);
}

/** Cached catalog, refreshed from Google when older than a month. Works from the cache when offline. */
export async function loadCatalog(adapter: DataAdapter, path: string, force = false): Promise<FontInfo[]> {
	let cached: CatalogFile | null = null;
	try {
		if (await adapter.exists(path)) cached = JSON.parse(await adapter.read(path)) as CatalogFile;
	} catch (e) {
		console.warn('Font Tailor: unreadable catalog cache', e);
	}
	if (cached && !force && Date.now() - cached.fetched < MAX_AGE) return cached.fonts;
	try {
		const res = await requestUrl({ url: METADATA_URL });
		const fonts = trimMetadata(res.text);
		await adapter.write(path, JSON.stringify({ fetched: Date.now(), fonts } satisfies CatalogFile));
		return fonts;
	} catch (e) {
		if (cached) return cached.fonts;
		throw e;
	}
}
