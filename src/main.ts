import { Notice, Plugin, getLanguage, normalizePath } from 'obsidian';
import { BodyFonts } from './apply';
import { loadCatalog } from './catalog';
import { FaceSet, FamilyFiles, PreviewFonts, downloadBlocks, fetchBlocks, tuple } from './fonts';
import { defaultScripts, keepsBlock } from './scripts';
import { FONT_FILE, IMPORT_FOLDER, SourceSettings, defaultSources, measureScripts, nodeFs, renders, scanDeviceFolders, scanSystem, scanVault } from './sources';
import { readFontFile } from './fontfile';
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
	sources?: SourceSettings;
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
	private local: Promise<FontInfo[]> | null = null;
	/** Folder fonts read once per session; FontFace needs the bytes. */
	private buffers = new Map<string, ArrayBuffer | null>();
	/** Family to why its font is not on this device. */
	readonly missing = new Map<string, string>();

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

	get sources(): SourceSettings {
		return this.data.sources ?? defaultSources(this.app.vault.configDir);
	}

	async setSources(sources: SourceSettings): Promise<void> {
		this.data.sources = sources;
		this.local = null;
		await this.saveData(this.data);
		await this.getLocalFonts();
		this.onChange?.();
	}

	/** Fonts from the vault, device folders and the system, scanned once per session or after a change. */
	getLocalFonts(force = false): Promise<FontInfo[]> {
		if (!this.local || force) {
			this.local = this.scanLocal();
			this.local.catch(() => (this.local = null));
		}
		return this.local;
	}

	private async scanLocal(): Promise<FontInfo[]> {
		const s = this.sources;
		const [vault, folders, system] = await Promise.all([
			scanVault(this.app, s.vaultFolders),
			scanDeviceFolders(s.deviceFolders),
			s.systemFonts ? scanSystem() : Promise.resolve([]),
		]);
		const doc = this.app.workspace.containerEl.doc;
		for (const f of [...vault, ...folders].filter((x) => x.unknownScripts)) {
			const file = f.files?.[0];
			const src = file && (f.source === 'vault' ? this.app.vault.adapter.getResourcePath(file.path) : this.readDeviceFile(file.path));
			if (src) f.subsets = await measureScripts(doc, src);
			f.unknownScripts = false;
		}
		const all = [...vault, ...folders, ...system];
		// Keep stored entries of fonts in use up to date (new weights, moved files).
		let changed = false;
		for (const f of all) {
			const used = this.data.fonts[f.family];
			if (used && used.source === f.source && JSON.stringify(used) !== JSON.stringify(f)) {
				this.data.fonts[f.family] = f;
				changed = true;
			}
		}
		if (changed) {
			await this.saveData(this.data);
			this.applyFonts();
		}
		return all;
	}

	/** Copies font files into the vault's import folder, then rescans. Returns how many were imported. */
	async importFiles(files: File[]): Promise<number> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(IMPORT_FOLDER))) await adapter.mkdir(IMPORT_FOLDER);
		let n = 0;
		for (const file of files) {
			const target = normalizePath(`${IMPORT_FOLDER}/${file.name}`);
			try {
				if (!FONT_FILE.test(file.name)) throw new Error('not a font file');
				const buf = await file.arrayBuffer();
				// Rejects files that only look like fonts.
				await readFontFile(async (o, l) => new Uint8Array(buf, o, Math.max(0, Math.min(l, buf.byteLength - o))), file.name);
				if (await adapter.exists(target)) throw new Error('a file with this name is already there');
				await adapter.writeBinary(target, buf);
				n++;
			} catch (e) {
				new Notice(`Skipped ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		if (!this.sources.vaultFolders.includes(IMPORT_FOLDER)) await this.setSources({ ...this.sources, vaultFolders: [...this.sources.vaultFolders, IMPORT_FOLDER] });
		else await this.getLocalFonts(true);
		this.onChange?.();
		return n;
	}

	/** Font sources for the faces of a vault or folder font; src is null when the file is not on this device. */
	localFaces(info: FontInfo): { src: string | ArrayBuffer | null; d: { style: string; weight: string; range: string } }[] {
		return (info.files ?? []).map((file) => ({
			src: info.source === 'vault' ? `url("${this.app.vault.adapter.getResourcePath(file.path)}")` : this.readDeviceFile(file.path),
			d: { style: file.italic ? 'italic' : 'normal', weight: String(file.weight), range: '' },
		}));
	}

	private readDeviceFile(path: string): ArrayBuffer | null {
		if (!this.buffers.has(path)) {
			const node = nodeFs();
			let buf: ArrayBuffer | null = null;
			try {
				if (node) {
					const b = node.fs.readFileSync(path);
					buf = new Uint8Array(b).buffer;
				}
			} catch {
				buf = null;
			}
			this.buffers.set(path, buf);
		}
		return this.buffers.get(path) ?? null;
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
		const before = JSON.stringify([...this.missing]);
		this.missing.clear();
		const adapter = this.app.vault.adapter;
		const main = this.app.workspace.containerEl.doc;
		for (const family of this.usedFamilies().keys()) {
			const info = this.info(family);
			const source = info?.source ?? 'google';
			if (source === 'google') {
				for (const f of this.data.files[family]?.faces ?? []) {
					const src = `url("${adapter.getResourcePath(f.file)}")${f.format ? ` format("${f.format}")` : ''}`;
					for (const doc of this.docs) this.faces.add(doc, family, src, f);
				}
			} else if (source === 'system') {
				if (!nodeFs()) this.missing.set(family, 'Installed on another device');
				else if (!renders(main, family, 'abcdefghijklmnopqrstuvwxyz')) this.missing.set(family, 'Not installed on this device');
			} else if (info) {
				for (const { src, d } of this.localFaces(info)) {
					if (!src) {
						this.missing.set(family, nodeFs() ? 'File not found on this device' : 'Added on another device');
						continue;
					}
					for (const doc of this.docs) {
						this.faces.add(doc, family, src, d)?.load().catch(() => {
							if (this.missing.has(family)) return;
							this.missing.set(family, 'Font file is missing from the vault');
							this.onChange?.();
						});
					}
				}
			}
		}
		this.body.apply([...this.docs].map((d) => d.body), this.data.slots, this.info);
		if (JSON.stringify([...this.missing]) !== before) this.onChange?.();
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
			if ((this.info(family)?.source ?? 'google') !== 'google') continue;
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
