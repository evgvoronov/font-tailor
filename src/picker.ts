import { App, ButtonComponent, DropdownComponent, Modal, ToggleComponent, setIcon, setTooltip } from 'obsidian';
import { tuple } from './fonts';
import type FontTailorPlugin from './main';
import { keepsBlock, missingScripts, scriptsOf } from './scripts';
import { deviceOnly, sourceLabel } from './sources';
import { FontInfo, SLOTS, SlotId, nearestWeight, parentOf, resolve, slotRole, styleName, weightName } from './slots';

const CATS: [string, string][] = [['all', 'All'], ['mine', 'My fonts'], ['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono'], ['display', 'Display'], ['hand', 'Handwriting']];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS);
const PAGE = 60;

export class FontPicker extends Modal {
	private cat: string;
	private onlyMine = true;
	private query = '';
	private sample = '';
	private sel: FontInfo | null = null;
	private selFamily: string | null;
	private weight: number;
	private italic: boolean;
	private fonts: FontInfo[] = [];
	private list: FontInfo[] = [];
	private rows = new Map<HTMLElement, FontInfo>();
	private shown = 0;
	private listEl!: HTMLElement;
	private catsEl!: HTMLElement;
	private styleEl!: HTMLElement;
	private applyBtn!: ButtonComponent;
	private sampleEl!: HTMLTextAreaElement;
	private rowObserver: IntersectionObserver | null = null;
	private catalogFailed = false;
	private sourceFilter = '';
	private sourceDrop!: DropdownComponent;
	private sizes = new Map<string, number>();
	/** Family to the labels of every source that has it. */
	private sourcesOf = new Map<string, string[]>();
	private mineToggle!: ToggleComponent;
	private moreObserver: IntersectionObserver | null = null;

	constructor(app: App, private plugin: FontTailorPlugin, private slot: SlotId) {
		super(app);
		const { slots } = plugin.data;
		const r = resolve(slots, slot, plugin.info);
		this.selFamily = slots[slot]?.family ?? r.family;
		this.weight = r.weight;
		this.italic = r.italic;
		this.cat = slotRole(slot) === 'mono' ? 'mono' : 'all';
	}

	onOpen(): void {
		const { slots } = this.plugin.data;
		const info = this.plugin.info;
		const name = SLOTS[this.slot].name;
		const cur = slots[this.slot];
		const p = parentOf(slots, this.slot);
		const pr = p ? resolve(slots, p, info) : null;
		const r = resolve(slots, this.slot, info);
		this.modalEl.addClass('ft-picker');
		const el = this.contentEl;

		const head = el.createDiv('ft-picker-head');
		head.createEl('h2', { text: `Font for ${name}` });
		head.createEl('p', {
			text: cur
				? `Now ${cur.family} ${styleName(cur.weight, cur.italic)}.` + (p ? ` Clearing it falls back to ${SLOTS[p].name}: ${pr?.family ?? 'Obsidian default'}.` : ' Clearing it gives the slot back to Obsidian.')
				: p ? `Empty now, so it uses ${SLOTS[p].name}: ${pr?.family ?? 'Obsidian default'} ${styleName(r.weight, r.italic)}.` : "Empty now, so Obsidian's own font is used.",
		});

		const tools = el.createDiv('ft-picker-tools');
		const search = tools.createEl('input', { type: 'search', attr: { 'aria-label': 'Search fonts', placeholder: 'Search fonts', autocomplete: 'off' } });
		search.addEventListener('input', () => {
			this.query = search.value;
			this.renderList();
		});
		search.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.apply();
			}
		});
		const toolRow = tools.createDiv('ft-tool-row');
		this.catsEl = toolRow.createDiv({ cls: 'ft-chips', attr: { role: 'group', 'aria-label': 'Category' } });
		this.sourceDrop = new DropdownComponent(toolRow).onChange((v) => {
			this.sourceFilter = v;
			this.renderList();
		});
		this.sourceDrop.selectEl.addClass('ft-source-filter');
		this.sourceDrop.selectEl.setAttr('aria-label', 'Source');
		const toggleLabel = toolRow.createEl('label', { cls: 'ft-toggle', text: 'Supports my languages' });
		this.mineToggle = new ToggleComponent(toggleLabel).setValue(this.onlyMine).setTooltip(scriptsOf(this.plugin.scripts).map((s) => s.name).join(', ')).onChange((v) => {
			this.onlyMine = v;
			this.renderList();
		});
		this.sampleEl = tools.createEl('textarea', { attr: { 'aria-label': 'Sample text', rows: '2', spellcheck: 'false' } });
		this.sampleEl.value = this.defaultSample();
		this.sampleEl.addEventListener('input', () => {
			this.sample = this.sampleEl.value.trim() ? this.sampleEl.value : '';
			this.refreshRows();
		});

		this.listEl = el.createDiv({ cls: 'ft-font-list', attr: { role: 'listbox', 'aria-label': 'Fonts' } });
		this.listEl.createDiv({ cls: 'ft-list-empty', text: 'Loading the font list…' });

		const foot = el.createDiv('ft-picker-foot');
		this.styleEl = foot.createDiv('ft-style-row');
		const actions = foot.createDiv('ft-foot-actions');
		if (cur) {
			actions.createEl('button', { cls: 'ft-linkish', text: `Clear, use ${p ? SLOTS[p].name : 'Obsidian default'}` }).addEventListener('click', () => {
				this.close();
				void this.plugin.changeSlots((s) => delete s[this.slot], `${name} cleared`);
			});
		}
		actions.createSpan('ft-spacer');
		new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
		this.applyBtn = new ButtonComponent(actions).setCta().setButtonText('Use font').onClick(() => this.apply());

		this.scope.register([], 'ArrowDown', (e) => this.move(e, 1));
		this.scope.register([], 'ArrowUp', (e) => this.move(e, -1));

		this.rowObserver = new IntersectionObserver((entries) => {
			for (const e of entries) {
				const font = this.rows.get(e.target as HTMLElement);
				if (e.isIntersecting && font) this.loadPreview(font, [this.rowWeight(font)]);
			}
		}, { root: this.listEl });
		this.moreObserver = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) this.appendRows();
		}, { root: this.listEl });

		this.renderCats();
		this.renderStyle();
		search.focus();
		void this.loadFonts();
	}

	onClose(): void {
		this.rowObserver?.disconnect();
		this.moreObserver?.disconnect();
		this.contentEl.empty();
	}

	/** Local fonts first (fewer, and the user put them there), then Google by popularity. */
	private async loadFonts(retry = false): Promise<void> {
		const [google, local] = await Promise.all([
			this.plugin.getCatalog(retry).catch((e) => {
				console.error('Font Tailor: catalog', e);
				return null;
			}),
			this.plugin.getLocalFonts().catch((e) => {
				console.error('Font Tailor: local fonts', e);
				return [];
			}),
		]);
		this.catalogFailed = !google;
		this.fonts = [...local, ...(google ?? [])];
		this.sizes = await this.plugin.diskSizes().catch(() => new Map<string, number>());
		this.sourcesOf.clear();
		for (const f of this.fonts) this.sourcesOf.set(f.family, [...(this.sourcesOf.get(f.family) ?? []), this.label(f)]);
		this.sourceDrop.selectEl.empty();
		this.sourceDrop.addOption('', 'All my sources');
		for (const l of [...new Set(local.map((f) => this.label(f)))].sort()) this.sourceDrop.addOption(l, l);
		this.sourceDrop.setValue(this.sourceFilter);
		this.renderCats();
		const source = this.selFamily ? this.plugin.info(this.selFamily)?.source ?? 'google' : null;
		this.sel = this.fonts.find((f) => f.family === this.selFamily && (f.source ?? 'google') === source) ?? null;
		this.renderList();
		this.renderStyle();
		this.scrollToSelected();
	}

	private defaultSample(): string {
		const lines = scriptsOf(this.plugin.scripts).map((s) => s.sample);
		return (slotRole(this.slot) === 'mono' ? ['0O 1lI {} [] => != ;', ...lines] : lines).join('\n');
	}

	private sampleLines(): string[] {
		return (this.sample || this.defaultSample()).split('\n').filter((l) => l.trim());
	}

	private filtered(): FontInfo[] {
		const q = this.query.trim().toLowerCase();
		const mine = this.plugin.scripts;
		return this.fonts.filter((f) =>
			(this.cat === 'all' || f.category === this.cat || (this.cat === 'mine' && (f.source ?? 'google') !== 'google' && (!this.sourceFilter || this.label(f) === this.sourceFilter))) &&
			(!this.onlyMine || !missingScripts(f.subsets, mine).length) &&
			(!q || f.family.toLowerCase().includes(q)));
	}

	private label(f: FontInfo): string {
		return sourceLabel(f, this.plugin.data.imported ?? []);
	}

	/** The copy the slots use, when this family is in use: same source and folder. */
	private isUsedCopy(f: FontInfo): boolean {
		const used = this.plugin.data.fonts[f.family];
		return !!used && (used.source ?? 'google') === (f.source ?? 'google') && (used.origin ?? f.origin) === f.origin;
	}

	private renderCats(): void {
		this.sourceDrop.selectEl.toggle(this.cat === 'mine' && this.sourceDrop.selectEl.options.length > 2);
		this.catsEl.empty();
		for (const [id, label] of CATS) {
			const chip = this.catsEl.createEl('button', { cls: ['ft-chip', this.cat === id ? 'is-active' : ''], text: label, attr: { 'aria-pressed': String(this.cat === id) } });
			chip.addEventListener('click', () => {
				this.cat = id;
				this.renderCats();
				this.renderList();
			});
		}
	}

	private renderList(): void {
		this.rowObserver?.disconnect();
		this.moreObserver?.disconnect();
		this.rows.clear();
		this.listEl.empty();
		this.list = this.filtered();
		this.shown = 0;
		if (this.catalogFailed) {
			const note = this.listEl.createDiv({ cls: 'ft-list-note', text: 'Could not load Google Fonts. Check the connection. ' });
			new ButtonComponent(note).setButtonText('Try again').onClick(() => void this.loadFonts(true));
		}
		if (this.list.length) {
			this.appendRows();
			return;
		}
		const empty = this.listEl.createDiv('ft-list-empty');
		const q = this.query.trim();
		empty.appendText(`No fonts match${q ? ` "${q}"` : ''}${this.cat !== 'all' ? ` in ${CAT_LABEL[this.cat] ?? this.cat}` : ''}${this.onlyMine ? ' that support your languages' : ''}.`);
		empty.createEl('br');
		if (this.onlyMine) {
			new ButtonComponent(empty).setButtonText('Show all fonts').onClick(() => {
				this.onlyMine = false;
				this.mineToggle.setValue(false);
				this.renderList();
			});
		} else if (this.cat !== 'all') {
			new ButtonComponent(empty).setButtonText('Search all categories').onClick(() => {
				this.cat = 'all';
				this.renderCats();
				this.renderList();
			});
		}
	}

	/** Renders the next page of rows; a sentinel at the end asks for more. */
	private appendRows(): void {
		this.listEl.querySelector('.ft-more')?.remove();
		const mine = this.plugin.scripts;
		const current = this.plugin.data.slots[this.slot]?.family;
		for (const f of this.list.slice(this.shown, this.shown + PAGE)) {
			const row = this.listEl.createDiv({ cls: ['ft-font-row', f.family === current && this.isUsedCopy(f) ? 'is-current' : ''], attr: { role: 'option' } });
			const meta = row.createDiv('ft-font-row-meta');
			meta.createEl('b', { text: f.family });
			const tags = meta.createDiv('ft-tags');
			const cat = CAT_LABEL[f.category];
			tags.createSpan({ text: `${cat ? `${cat} · ` : ''}${f.weights.length} weight${f.weights.length > 1 ? 's' : ''}${f.italics.length ? ', italic' : ''}` });
			const missing = missingScripts(f.subsets, mine);
			if (missing.length) tags.createSpan({ cls: 'ft-badge', text: `No ${missing.map((s) => s.name).join(', ')}` });
			this.sourceBadge(tags, f);
			row.createDiv('ft-font-row-sample');
			row.addEventListener('click', () => this.select(f));
			row.addEventListener('dblclick', () => this.apply());
			this.rows.set(row, f);
			this.refreshRow(row, f);
			this.rowObserver?.observe(row);
		}
		this.shown = Math.min(this.list.length, this.shown + PAGE);
		if (this.shown < this.list.length) this.moreObserver?.observe(this.listEl.createDiv('ft-more'));
	}

	private rowWeight(f: FontInfo): number {
		return nearestWeight(f.weights, this.weight);
	}

	private refreshRow(row: HTMLElement, f: FontInfo): void {
		row.toggleClass('is-selected', this.sel === f);
		row.setAttr('aria-selected', String(this.sel === f));
		const sample = row.querySelector<HTMLElement>('.ft-font-row-sample');
		if (!sample) return;
		sample.empty();
		for (const line of this.sampleLines()) sample.createDiv({ text: line, attr: { dir: 'auto' } });
		sample.setCssStyles({
			fontFamily: `"${f.family}", var(--font-default)`,
			fontWeight: String(this.rowWeight(f)),
			fontStyle: this.italic ? 'italic' : 'normal',
		});
	}

	/** Restyles rendered rows; re-observing makes the visible ones load the new style. */
	private refreshRows(): void {
		this.rows.forEach((f, row) => {
			this.refreshRow(row, f);
			this.rowObserver?.unobserve(row);
			this.rowObserver?.observe(row);
		});
	}

	private loadPreview(f: FontInfo, weights: number[]): void {
		if (f.source === 'system') return;
		if (f.source && f.source !== 'google') {
			this.plugin.preview.loadLocal(this.contentEl.doc, f.family, this.plugin.localFaces(f));
			return;
		}
		const scripts = this.plugin.scripts;
		this.plugin.preview.load(this.contentEl.doc, f.family, weights.map((w) => tuple(w, this.italic && f.italics.includes(w))), (label) => keepsBlock(label, scripts));
	}

	private select(f: FontInfo): void {
		this.sel = f;
		this.rows.forEach((font, row) => {
			row.toggleClass('is-selected', font === f);
			row.setAttr('aria-selected', String(font === f));
		});
		this.renderStyle();
	}

	private move(e: KeyboardEvent, step: number): void {
		if (!this.list.length) return;
		e.preventDefault();
		const i = this.sel ? this.list.indexOf(this.sel) : -1;
		const n = Math.max(0, Math.min(this.list.length - 1, i + step));
		while (n >= this.shown) this.appendRows();
		const f = this.list[n];
		if (f) this.select(f);
		this.scrollToSelected();
	}

	private scrollToSelected(): void {
		if (this.sel && !this.list.slice(0, this.shown).includes(this.sel)) {
			const n = this.list.indexOf(this.sel);
			while (n >= this.shown) this.appendRows();
		}
		this.listEl.querySelector('.ft-font-row.is-selected')?.scrollIntoView({ block: 'nearest' });
	}

	/** Source name, a this-device-only marker, and for Google fonts what is downloaded. */
	private sourceBadge(tags: HTMLElement, f: FontInfo): void {
		const label = this.label(f);
		const badge = tags.createSpan({ cls: 'ft-badge mod-source', text: label });
		const lines = [f.source === 'google' || !f.source ? 'Downloaded from Google Fonts when a slot uses it.' : f.source === 'system' ? 'Installed on this computer.' : `${f.source === 'folder' ? 'Folder' : 'Vault folder'}: ${f.origin ?? ''}`];
		const others = (this.sourcesOf.get(f.family) ?? []).filter((l) => l !== label);
		if (others.length) {
			lines.push(`Also in: ${others.join(', ')}.`);
			const used = this.plugin.data.fonts[f.family];
			if (used && this.plugin.inUse(f.family)) lines.push(this.isUsedCopy(f) ? 'Your slots use this copy.' : `Your slots use the copy from ${this.label(used)}.`);
		}
		setTooltip(badge, lines.join('\n'));
		if (deviceOnly(f)) {
			const icon = tags.createSpan({ cls: 'ft-marker', attr: { 'aria-label': 'This device only' } });
			setIcon(icon, 'laptop');
			setTooltip(icon, 'Only on this device. It does not sync; other devices fall back to Obsidian\'s font.');
		}
		const files = (f.source ?? 'google') === 'google' ? this.plugin.data.files[f.family] : undefined;
		if (files) {
			const total = f.weights.length + f.italics.length;
			const partial = files.tuples.length < total;
			const icon = tags.createSpan({ cls: ['ft-marker', 'mod-downloaded'], attr: { 'aria-label': partial ? 'Partly downloaded' : 'Downloaded' } });
			setIcon(icon, partial ? 'circle-dashed' : 'circle-check');
			const styles = files.tuples.map((t) => {
				const [i = '0', w = '400'] = t.split(',');
				return styleName(Number(w), i === '1');
			});
			const size = this.sizes.get(f.family);
			setTooltip(icon, `${partial ? `Partly downloaded: ${styles.length} of ${total} styles` : 'Downloaded: all styles'}\n${styles.join(', ')}\n${scriptsOf(files.scripts).map((s) => s.name).join(', ')}${size ? `\n${formatSize(size)} in the vault` : ''}`);
		}
	}

	private renderStyle(): void {
		const el = this.styleEl;
		el.empty();
		const f = this.sel;
		if (!f) {
			el.createSpan({ text: this.fonts.length ? 'Choose a font above.' : '' });
			this.applyBtn.setDisabled(true).setButtonText('Use font');
			return;
		}
		this.weight = nearestWeight(f.weights, this.weight);
		this.loadPreview(f, f.weights);
		el.createSpan({ text: 'Weight' });
		const weights = el.createDiv({ cls: 'ft-weights', attr: { role: 'group', 'aria-label': 'Weight' } });
		for (const w of f.weights) {
			const b = weights.createEl('button', { cls: ['ft-weight', w === this.weight ? 'is-active' : ''], text: String(w), attr: { title: weightName(w), 'aria-pressed': String(w === this.weight) } });
			b.setCssStyles({ fontFamily: `"${f.family}", var(--font-default)`, fontWeight: String(w), fontStyle: this.italic ? 'italic' : 'normal' });
			b.addEventListener('click', () => {
				this.weight = w;
				this.renderStyle();
				this.refreshRows();
			});
		}
		const label = el.createEl('label', { cls: 'ft-toggle', text: 'Italic' });
		new ToggleComponent(label).setValue(this.italic).onChange((v) => {
			this.italic = v;
			this.renderStyle();
			this.refreshRows();
		});
		if (this.italic && !f.italics.includes(this.weight)) {
			el.createSpan({ text: f.italics.length ? `No italic at ${this.weight}. Obsidian would slant it.` : 'No true italic. Obsidian would slant the upright.' });
		}
		if ((f.source ?? 'google') === 'google') {
			const note = el.createSpan({ cls: 'ft-download-note' });
			const t = tuple(this.weight, this.italic && f.italics.includes(this.weight));
			const key = `${f.family}|${t}`;
			this.plugin.estimate(f.family, [t]).then((bytes) => {
				if (!note.isConnected || `${this.sel?.family}|${tuple(this.weight, this.italic && f.italics.includes(this.weight))}` !== key) return;
				note.setText(bytes ? `Downloads about ${formatSize(bytes)} for this style` : 'This style is already downloaded');
			}).catch(() => note.setText('Needs a connection to download'));
		}
		this.applyBtn.setDisabled(false).setButtonText(`Use ${f.family} ${styleName(this.weight, this.italic)}`);
	}

	private apply(): void {
		const f = this.sel;
		if (!f) return;
		const value = { family: f.family, weight: this.weight, italic: this.italic };
		this.close();
		void this.plugin.changeSlots((s) => (s[this.slot] = value), `${SLOTS[this.slot].name}: ${f.family} ${styleName(value.weight, value.italic)}`, f);
	}
}

function formatSize(bytes: number): string {
	return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
