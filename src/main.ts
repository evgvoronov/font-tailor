import { Notice, Plugin, getLanguage, normalizePath } from 'obsidian';
import { BodyFonts } from './apply';
import { loadCatalog } from './catalog';
import { FaceSet, FamilyFiles, PreviewFonts, downloadBlocks, fetchBlocks, tuple } from './fonts';
import { defaultScripts, keepsBlock } from './scripts';
import { FontTailorSettingTab } from './settings';
import { FontInfo, SLOT_IDS, SlotValues, nearestWeight, resolve } from './slots';

interface Data {
	slots: SlotValues;
	/** "My languages". Unset means: Latin plus the app and system languages. */
	scripts?: string[];
	/** Catalog entries of fonts in use, so startup needs neither the catalog nor the network. */
	fonts: Record<string, FontInfo>;
	files: Record<string, FamilyFiles>;
	previewCollapsed?: boolean;
}

export default class FontTailorPlugin extends Plugin {
	data!: Data;
	/** Called after any change, so an open settings tab can redraw. */
	onChange: (() => void) | null = null;
	private catalog: Promise<FontInfo[]> | null = null;
	private byName = new Map<string, FontInfo>();
	private body = new BodyFonts();
	private faces = new FaceSet();
	readonly preview = new PreviewFonts();
	private syncing: Promise<void> = Promise.resolve();
	/** Windows that get the fonts: main, popouts, and the settings window while it shows this tab. */
	private docs = new Set<Document>();

	async onload() {
		const saved = (await this.loadData()) as Partial<Data> | null;
		this.data = { slots: {}, fonts: {}, files: {}, ...saved };
		this.addSettingTab(new FontTailorSettingTab(this.app, this));
		// Not activeDocument: that is the settings window when the plugin is enabled from there.
		this.docs.add(this.app.workspace.containerEl.doc);
		this.registerEvent(this.app.workspace.on('window-open', (_, win) => this.addDoc(win.document)));
		this.registerEvent(this.app.workspace.on('window-close', (_, win) => this.removeDoc(win.document)));
		this.applyFonts();
		this.register(() => {
			this.body.clear();
			this.faces.clear();
			this.preview.clear();
		});
		// Finishes downloads that failed earlier (offline). Does nothing when all files are there.
		this.app.workspace.onLayoutReady(() => this.sync());
	}

	addDoc(doc: Document): void {
		if (this.docs.has(doc)) return;
		this.docs.add(doc);
		this.applyFonts();
	}

	removeDoc(doc: Document): void {
		// The first entry is the main window; it stays.
		if (doc === this.docs.values().next().value || !this.docs.delete(doc)) return;
		this.applyFonts();
	}

	info = (family: string): FontInfo | undefined => this.data.fonts[family] ?? this.byName.get(family);

	get scripts(): string[] {
		return this.data.scripts ?? defaultScripts([getLanguage(), ...navigator.languages]);
	}

	get fontsDir(): string {
		return normalizePath(`${this.manifest.dir ?? ''}/fonts`);
	}

	getCatalog(force = false): Promise<FontInfo[]> {
		if (!this.catalog || force) {
			this.catalog = loadCatalog(this.app.vault.adapter, normalizePath(`${this.manifest.dir ?? ''}/catalog.json`), force)
				.then((fonts) => {
					this.byName = new Map(fonts.map((f) => [f.family, f]));
					return fonts;
				});
			this.catalog.catch(() => (this.catalog = null));
		}
		return this.catalog;
	}

	/** Changes the slots, applies them and offers Undo in a notice. */
	async changeSlots(change: (slots: SlotValues) => void, message: string, font?: FontInfo): Promise<void> {
		const prev = structuredClone(this.data.slots);
		if (font) this.data.fonts[font.family] = font;
		change(this.data.slots);
		await this.commit();
		notify(message, () => {
			this.data.slots = prev;
			void this.commit();
		});
	}

	async setScripts(ids: string[]): Promise<void> {
		this.data.scripts = ids;
		await this.commit();
	}

	private async commit(): Promise<void> {
		await this.saveData(this.data);
		this.applyFonts();
		this.onChange?.();
		this.sync();
	}

	private applyFonts(): void {
		this.faces.clear();
		this.body.clear();
		const adapter = this.app.vault.adapter;
		for (const family of this.usedFamilies().keys()) {
			for (const f of this.data.files[family]?.faces ?? []) {
				const src = `url("${adapter.getResourcePath(f.file)}")${f.format ? ` format("${f.format}")` : ''}`;
				for (const doc of this.docs) this.faces.add(doc, family, src, f);
			}
		}
		this.body.apply([...this.docs].map((d) => d.body), this.data.slots, this.info);
	}

	/** Family to the css2 tuples its slots need. */
	private usedFamilies(): Map<string, Set<string>> {
		const used = new Map<string, Set<string>>();
		for (const id of SLOT_IDS) {
			const r = resolve(this.data.slots, id, this.info);
			const font = r.family ? this.info(r.family) : undefined;
			if (!r.family || !font) continue;
			const weight = font.weights.includes(r.weight) ? r.weight : nearestWeight(font.weights, r.weight);
			const set = used.get(r.family) ?? new Set();
			// No true italic at this weight: fetch the upright and let the browser slant it.
			set.add(tuple(weight, r.italic && font.italics.includes(weight)));
			used.set(r.family, set);
		}
		return used;
	}

	/** Downloads whatever the slots and scripts need that is not on disk yet. Runs one at a time. */
	sync(): void {
		this.syncing = this.syncing.then(() => this.syncNow());
	}

	private async syncNow(): Promise<void> {
		const scripts = this.scripts;
		let changed = false;
		for (const [family, needed] of this.usedFamilies()) {
			const have = this.data.files[family];
			const tuples = [...new Set([...(have?.tuples ?? []), ...needed])];
			const wanted = [...new Set([...(have?.scripts ?? []), ...scripts])];
			if (have && tuples.length === have.tuples.length && wanted.length === have.scripts.length) continue;
			const progress = new Notice(`Downloading ${family}…`, 0);
			try {
				const blocks = (await fetchBlocks(family, tuples)).filter((b) => keepsBlock(b.label, wanted));
				const faces = await downloadBlocks(this.app.vault.adapter, this.fontsDir, family, blocks);
				this.data.files[family] = { tuples, scripts: wanted, faces };
				changed = true;
			} catch (e) {
				console.error('Font Tailor: download failed', family, e);
				new Notice(`Could not download ${family}. Check the connection. Font Tailor tries again on the next change or restart.`);
			} finally {
				progress.hide();
			}
		}
		if (!changed) return;
		await this.saveData(this.data);
		this.applyFonts();
		this.onChange?.();
	}
}

/** A notice with an Undo button. */
function notify(message: string, undo: () => void): void {
	const frag = createFragment((f) => {
		const row = f.createDiv('ft-notice');
		row.createSpan({ cls: 'ft-notice-msg', text: message });
		const btn = row.createEl('button', { text: 'Undo', cls: 'ft-undo' });
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			undo();
			notice.hide();
		});
	});
	const notice = new Notice(frag, 6000);
}
