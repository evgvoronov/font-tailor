import { Notice, Setting, setIcon } from 'obsidian';
import type FontTailorPlugin from './main';
import { scriptsOf } from './scripts';
import { formatSize, inUseLabel, tupleStyles, usedFirst } from './slots';

/** "Downloaded fonts" in the settings tab: one row per Google family on disk, collapsed by default. */
export class DownloadsSection {
	private open = false;
	/** Drops the size lookup of an older render. */
	private renders = 0;

	constructor(private el: HTMLElement, private plugin: FontTailorPlugin) {}

	render(): void {
		const el = this.el;
		el.empty();
		const files = this.plugin.data.files;
		const families = usedFirst(Object.keys(files).sort((a, b) => a.localeCompare(b)), (f) => this.plugin.downloadUsers(f).length > 0);
		const n = families.length;
		const area = el.createDiv({ cls: ['ft-area', 'ft-downloads', this.open ? 'is-open' : ''] });
		const head = new Setting(area).setName('Downloaded fonts');
		const count = `${n} ${n === 1 ? 'family' : 'families'}`;
		head.setDesc(n ? count : 'Nothing yet. A Google font is downloaded when a slot uses it.');
		if (!n) return;
		const exp = head.infoEl.createEl('button', { cls: 'ft-expander', attr: { 'aria-expanded': String(this.open) } });
		setIcon(exp.createSpan(), 'chevron-right');
		exp.appendText(this.open ? 'Hide' : 'Show');
		exp.addEventListener('click', () => {
			this.open = !this.open;
			this.render();
		});

		const list = area.createDiv('ft-children');
		const sizeEls = new Map<string, HTMLElement>();
		for (const family of families) {
			const f = files[family];
			if (!f) continue;
			const users = this.plugin.downloadUsers(family);
			const row = new Setting(list).setName(family);
			row.settingEl.addClass('ft-child');
			row.nameEl.addClass('ft-name');
			if (users.length) row.nameEl.createSpan({ cls: 'ft-badge mod-in-use', text: inUseLabel(users) });
			sizeEls.set(family, row.descEl.createSpan());
			row.descEl.appendText(`${tupleStyles(f.tuples).join(', ')} · ${scriptsOf(f.scripts).map((s) => s.name).join(', ')}`);
			// Only fonts no slot uses can go; deleting a used one would just download it again.
			if (!users.length) row.addExtraButton((b) => b.setIcon('trash-2').setTooltip(`Delete ${family}`).onClick(() => {
				this.plugin.deleteDownload(family).catch((e) => {
					console.error('Font Tailor: delete', family, e);
					new Notice(`Could not delete ${family}.`);
				});
			}));
		}

		const id = ++this.renders;
		this.plugin.diskSizes().then((sizes) => {
			if (id !== this.renders) return;
			let total = 0;
			for (const [family, bytes] of sizes) {
				total += bytes;
				sizeEls.get(family)?.setText(`${bytes ? formatSize(bytes) : 'Files missing'} · `);
			}
			head.setDesc(`${count}, ${formatSize(total)} in the vault`);
		}).catch((e) => console.error('Font Tailor: disk sizes', e));
	}
}
