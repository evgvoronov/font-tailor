import { App, ButtonComponent, ExtraButtonComponent, Menu, Platform, PluginSettingTab, Setting, SettingDefinitionItem, requireApiVersion, setIcon } from 'obsidian';
import { fontCss } from './apply';
import type FontTailorPlugin from './main';
import { DownloadsSection } from './downloads';
import { renderNote } from './note';
import { FontPicker } from './picker';
import { SourcesModal } from './sourcesModal';
import { SCRIPTS, missingScripts, scriptsOf } from './scripts';
import { AREAS, SLOTS, SLOT_IDS, SlotId, controls, fakeNote, parentOf, resolve, styleName } from './slots';

/** Settings search finds the tab by these. */
const SEARCH_TERMS = ['My languages', 'Font sources', 'Match x-height of mixed fonts', 'Reset all overrides', 'Downloaded fonts', 'Google Fonts', 'Preview', ...SLOT_IDS.map((id) => SLOTS[id].name)];

// Obsidian lists this tab under the manifest name, "Font Tailor".
export class FontTailorSettingTab extends PluginSettingTab {
	private open = new Set<SlotId>(['text']);
	private slotsEl: HTMLElement | null = null;
	private noteEl: HTMLElement | null = null;
	private langs: Setting | null = null;
	private sourcesRow: Setting | null = null;
	private resetAll: Setting | null = null;
	private downloads: DownloadsSection | null = null;

	constructor(app: App, private plugin: FontTailorPlugin) {
		super(app, plugin);
	}

	/**
	 * Obsidian 1.13+ renders the tab from this list and indexes it for settings search. The slots and the
	 * pinned preview do not fit separate rows, so one row holds the whole layout and its aliases make each
	 * setting findable. Older versions never call this and use display().
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [{
			name: 'Font slots and preview',
			desc: 'Fonts per slot, languages, font sources, downloaded fonts.',
			aliases: SEARCH_TERMS,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass('ft-tab-row');
				this.build(setting.settingEl);
				return () => this.teardown();
			},
		}];
	}

	display(): void {
		this.containerEl.empty();
		this.build(this.containerEl);
	}

	hide(): void {
		this.teardown();
		super.hide();
	}

	private teardown(): void {
		this.plugin.onChange = null;
		this.plugin.preview.clear();
		this.plugin.removeDoc(this.containerEl.doc);
		this.containerEl.removeClass('ft-tab-host');
	}

	private build(parent: HTMLElement): void {
		// Lets styles.css widen the settings column for this tab only.
		this.containerEl.addClass('ft-tab-host');
		// Listeners go on this child, so they are dropped with it on the next render.
		const el = parent.createDiv('ft-tab');
		const left = el.createDiv('ft-slots');
		left.createEl('p', {
			cls: 'ft-intro',
			text: 'Pick fonts from Google Fonts. An empty slot uses the slot it hangs under, so one font for text already covers italic, bold and headings. Fonts are downloaded into the vault once and then work offline.',
		});
		this.langs = new Setting(left)
			.setName('My languages')
			.setTooltip('Scripts you write in. The picker checks fonts against them, the preview shows them, and downloads include them.')
			.addButton((b) => b.setButtonText('Change').onClick((e) => this.languageMenu(e)));
		this.sourcesRow = new Setting(left)
			.setName('Font sources')
			.addButton((b) => b.setButtonText('Manage').onClick(() => new SourcesModal(this.app, this.plugin).open()));
		new Setting(left)
			.setName('Match x-height of mixed fonts')
			.setDesc('When italic, bold or inline code use another font than the text, scale it to the height of the text\'s lowercase letters.')
			.addToggle((t) => t.setValue(this.plugin.data.matchXHeight !== false).onChange((v) => void this.plugin.setMatchXHeight(v)));
		this.slotsEl = left.createDiv();
		this.resetAll = new Setting(left).setName('Reset all overrides').addButton((b) =>
			destructive(b).setButtonText('Reset all').onClick(() => {
				const n = Object.keys(this.plugin.data.slots).length;
				void this.plugin.changeSlots((s) => {
					for (const k of Object.keys(s) as SlotId[]) delete s[k];
				}, `Reset ${n} override${n === 1 ? '' : 's'}`);
			}),
		);
		this.downloads = new DownloadsSection(left.createDiv(), this.plugin);

		const aside = el.createDiv({ cls: ['ft-preview', this.plugin.data.previewCollapsed ? 'is-collapsed' : ''] });
		const bar = aside.createDiv('ft-preview-bar');
		bar.createDiv({ cls: 'ft-preview-title', text: 'Preview' });
		// Only shown in the narrow layout, where the preview is a compact panel over the slots.
		new ExtraButtonComponent(bar).setIcon('chevrons-down-up').setTooltip('Collapse or expand the preview').onClick(() => {
			this.plugin.data.previewCollapsed = !this.plugin.data.previewCollapsed;
			aside.toggleClass('is-collapsed', this.plugin.data.previewCollapsed);
			void this.plugin.saveData(this.plugin.data);
		}).extraSettingsEl.addClass('ft-collapse');
		this.noteEl = aside.createDiv('ft-note');
		aside.createDiv({ cls: 'ft-legend', text: 'Hover a slot to see what it changes here. Select any part of the note to pick its font.' });

		el.addEventListener('mouseover', (e) => this.onHover(e));
		el.addEventListener('focusin', (e) => this.onHover(e));
		this.noteEl.addEventListener('click', (e) => this.onNoteClick(e));
		this.noteEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') this.onNoteClick(e);
		});
		this.plugin.onChange = () => this.render();
		this.plugin.addDoc(el.doc);
		this.render();
	}

	private render(): void {
		this.renderLanguages();
		this.renderSlots();
		this.downloads?.render();
		if (this.noteEl) renderNote(this.noteEl, scriptsOf(this.plugin.scripts), this.plugin.data.slots, this.plugin.info, this.plugin.adjust());
	}

	private renderLanguages(): void {
		this.langs?.setDesc(scriptsOf(this.plugin.scripts).map((s) => s.name).join(', '));
		const s = this.plugin.sources;
		const parts = ['Google Fonts', `${s.vaultFolders.length} vault folder${s.vaultFolders.length === 1 ? '' : 's'}`];
		if (s.deviceFolders.length) parts.push(`${s.deviceFolders.length} folder${s.deviceFolders.length === 1 ? '' : 's'} on this device`);
		if (s.systemFonts && Platform.isDesktop) parts.push('installed fonts');
		this.sourcesRow?.setDesc(parts.join(', '));
	}

	/** One script per item; each click toggles it. At least one stays chosen. */
	private languageMenu(e: MouseEvent): void {
		const chosen = this.plugin.scripts;
		const menu = new Menu();
		for (const s of SCRIPTS) {
			const on = chosen.includes(s.id);
			menu.addItem((i) => i.setTitle(s.name).setChecked(on).setDisabled(on && chosen.length === 1).onClick(() => {
				const next = on ? chosen.filter((id) => id !== s.id) : [...chosen, s.id];
				void this.plugin.setScripts(SCRIPTS.map((x) => x.id).filter((id) => next.includes(id)));
			}));
		}
		menu.showAtMouseEvent(e);
	}

	private renderSlots(): void {
		const el = this.slotsEl;
		if (!el) return;
		el.empty();
		const values = this.plugin.data.slots;
		for (const a of AREAS) {
			const area = el.createDiv({ cls: ['ft-area', this.open.has(a.id) ? 'is-open' : ''] });
			const row = this.slotRow(area, a.id, SLOTS[a.id].parent && !values[a.id] ? `Empty, uses ${SLOTS[SLOTS[a.id].parent ?? 'text'].name}` : SLOTS[a.id].desc ?? '');
			if (!a.kids.length) continue;
			const set = a.kids.filter((k) => values[k]).length;
			const open = this.open.has(a.id);
			const exp = row.infoEl.createEl('button', { cls: 'ft-expander', attr: { 'aria-expanded': String(open) } });
			setIcon(exp.createSpan(), 'chevron-right');
			exp.appendText(a.summary ?? '');
			if (set) {
				exp.appendText(' · ');
				exp.createSpan({ cls: 'ft-count', text: `${set} set` });
			}
			exp.addEventListener('click', () => {
				if (this.open.has(a.id)) this.open.delete(a.id);
				else this.open.add(a.id);
				this.renderSlots();
			});
			const kids = area.createDiv('ft-children');
			for (const k of a.kids) this.slotRow(kids, k, this.inheritDesc(k)).settingEl.addClass('ft-child');
		}
		const n = Object.keys(values).length;
		this.resetAll?.setDesc(n === 0
			? 'Nothing is overridden. Obsidian uses its own fonts.'
			: `Clears ${n} override${n === 1 ? '' : 's'} and gives the fonts back to Obsidian. Downloaded font files stay in the vault until you delete them below.`);
		for (const c of this.resetAll?.components ?? []) c.setDisabled(n === 0);
	}

	private inheritDesc(id: SlotId): string {
		if (this.plugin.data.slots[id]) return SLOTS[id].desc ?? '';
		const p = parentOf(this.plugin.data.slots, id);
		return p ? `Empty, uses ${SLOTS[p].name}` : "Empty, uses Obsidian's font";
	}

	private slotRow(parent: HTMLElement, id: SlotId, desc: string): Setting {
		const { slots } = this.plugin.data;
		const info = this.plugin.info;
		const set = !!slots[id];
		const r = resolve(slots, id, info);
		const row = new Setting(parent).setDesc(desc);
		row.settingEl.dataset.row = id;
		row.nameEl.addClass('ft-name');
		if (set) row.nameEl.createSpan('ft-dot');
		row.nameEl.appendText(SLOTS[id].name);

		// Warn on the slot that sets the font, not on every slot that inherits it.
		const font = set && r.family ? info(r.family) : undefined;
		const missing = font ? missingScripts(font.subsets, this.plugin.scripts) : [];
		const absent = set && r.family ? this.plugin.missing.get(r.family) : undefined;
		if (absent) row.descEl.createDiv({ cls: 'ft-warn', text: `${absent}. Falls back to Obsidian's font.` });
		else if (missing.length) {
			const names = missing.map((s) => s.name).join(', ');
			row.descEl.createDiv({ cls: 'ft-warn', text: `${names} ${missing.length === 1 ? 'falls' : 'fall'} back to another font` });
		}

		const family = r.family ?? 'Obsidian default';
		let meta = styleName(r.weight, r.italic);
		const fake = fakeNote(r, info);
		if (fake) meta += ` · ${fake}`;
		const btn = row.controlEl.createEl('button', {
			cls: ['ft-font-btn', set ? '' : 'is-inherited'],
			attr: { 'aria-label': `${SLOTS[id].name} font: ${family} ${meta}. Change`, title: `${family} · ${meta}` },
		});
		const adjust = this.plugin.adjust()[id];
		btn.createSpan({ cls: 'ft-family', text: family }).setCssStyles({ ...fontCss(r), fontSizeAdjust: adjust ? String(adjust) : '' });
		btn.createSpan({ cls: 'ft-style', text: meta });
		btn.addEventListener('click', () => this.pick(id));
		row.addExtraButton((b) => {
			b.setIcon('rotate-ccw').setTooltip(`Reset ${SLOTS[id].name}`).onClick(() => {
				void this.plugin.changeSlots((s) => delete s[id], `${SLOTS[id].name} reset`);
			});
			b.extraSettingsEl.addClass('ft-reset');
			if (!set) b.extraSettingsEl.addClass('is-hidden');
		});
		return row;
	}

	private pick(id: SlotId): void {
		const area = AREAS.find((a) => a.kids.includes(id));
		if (area && !this.open.has(area.id)) {
			this.open.add(area.id);
			this.renderSlots();
		}
		new FontPicker(this.app, this.plugin, id).open();
	}

	private onHover(e: Event): void {
		const t = e.target instanceof HTMLElement ? e.target : null;
		const row = t?.closest<HTMLElement>('[data-row]');
		const part = t?.closest<HTMLElement>('[data-slot]');
		const slot = (row?.dataset.row ?? part?.dataset.slot ?? null) as SlotId | null;
		const values = this.plugin.data.slots;
		const note = this.noteEl;
		if (!note) return;
		let first: HTMLElement | null = null;
		for (const n of Array.from(note.querySelectorAll<HTMLElement>('[data-slot]'))) {
			const on = !!slot && controls(values, slot, n.dataset.slot as SlotId);
			n.toggleClass('is-hl', on);
			if (on && !first) first = n;
		}
		// The compact preview scrolls on its own: bring what the hovered slot controls into view.
		// Not scrollIntoView, which would also scroll the settings pane.
		if (row && first) {
			const r = first.getBoundingClientRect();
			const box = note.getBoundingClientRect();
			if (r.top < box.top || r.bottom > box.bottom) note.scrollTop += r.top - box.top - 12;
		}
		this.slotsEl?.querySelectorAll<HTMLElement>('[data-row]').forEach((n) => {
			const on = n.dataset.row === slot;
			(n.hasClass('ft-child') ? n : n.parentElement)?.toggleClass('is-hl', on);
		});
	}

	private onNoteClick(e: Event): void {
		const t = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-slot]') : null;
		if (!t?.dataset.slot) return;
		e.preventDefault();
		this.pick(t.dataset.slot as SlotId);
	}
}

/** setDestructive() is Obsidian 1.13+; before that the same look comes from the mod-warning class. */
function destructive(b: ButtonComponent): ButtonComponent {
	if (requireApiVersion('1.13.0')) return b.setDestructive();
	b.buttonEl.addClass('mod-warning');
	return b;
}
