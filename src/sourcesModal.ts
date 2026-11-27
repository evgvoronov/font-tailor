import { App, Modal, Notice, Setting, normalizePath } from 'obsidian';
import type FontTailorPlugin from './main';
import { IMPORT_FOLDER, SourceSettings, nodeFs } from './sources';
import type { FontInfo } from './slots';

/** Where fonts come from: vault folders, imports, and on desktop, folders on this device and installed fonts. */
export class SourcesModal extends Modal {
	constructor(app: App, private plugin: FontTailorPlugin) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Font sources');
		this.modalEl.addClass('ft-sources');
		// Files dropped anywhere on the dialog are imported.
		this.contentEl.addEventListener('dragover', (e) => {
			e.preventDefault();
			this.contentEl.addClass('is-dragover');
		});
		this.contentEl.addEventListener('dragleave', () => this.contentEl.removeClass('is-dragover'));
		this.contentEl.addEventListener('drop', (e) => {
			e.preventDefault();
			this.contentEl.removeClass('is-dragover');
			void this.import(Array.from(e.dataTransfer?.files ?? []));
		});
		void this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const el = this.contentEl;
		el.empty();
		el.createDiv({ cls: 'ft-list-empty', text: 'Looking for fonts…' });
		let local: FontInfo[] = [];
		try {
			local = await this.plugin.getLocalFonts();
		} catch (e) {
			console.error('Font Tailor: scan failed', e);
		}
		el.empty();
		const s = this.plugin.sources;
		const save = (next: Partial<SourceSettings>) => void this.plugin.setSources({ ...s, ...next }).then(() => this.render());
		const familiesIn = (dir: string, source: string) => {
			const prefix = dir.replace(/[\\/]+$/, '');
			return local.filter((f) => f.source === source && f.files?.some((x) => x.path.startsWith(prefix + '/') || x.path.startsWith(prefix + '\\'))).length;
		};

		new Setting(el).setName('Google Fonts').setDesc('Always on. A font is downloaded into the plugin folder when a slot uses it, then works offline.');

		new Setting(el).setName('Vault folders').setDesc('Font files in these folders sync with the vault.').setHeading();
		for (const dir of s.vaultFolders) {
			const n = familiesIn(normalizePath(dir), 'vault');
			new Setting(el).setName(dir).setDesc(n ? `${n} famil${n === 1 ? 'y' : 'ies'}` : 'No fonts found').addExtraButton((b) =>
				b.setIcon('x').setTooltip('Stop using this folder').onClick(() => save({ vaultFolders: s.vaultFolders.filter((d) => d !== dir) })));
		}
		let vaultInput = '';
		new Setting(el)
			.setName('Add a vault folder')
			.addText((t) => t.setPlaceholder('Path in the vault, e.g. assets/type').onChange((v) => (vaultInput = v)))
			.addButton((b) => b.setButtonText('Add').onClick(async () => {
				const dir = normalizePath(vaultInput.trim());
				if (!dir || dir === '/') return;
				if (!(await this.app.vault.adapter.exists(dir))) {
					new Notice(`No folder "${dir}" in the vault.`);
					return;
				}
				if (!s.vaultFolders.includes(dir)) save({ vaultFolders: [...s.vaultFolders, dir] });
			}));

		const picker = el.createEl('input', { type: 'file', attr: { multiple: '', accept: '.ttf,.otf,.woff,.woff2', hidden: '' } });
		picker.addEventListener('change', () => void this.import(Array.from(picker.files ?? [])));
		new Setting(el)
			.setName('Import font files')
			.setDesc(`Copies TTF, OTF, WOFF or WOFF2 files into "${IMPORT_FOLDER}/" in the vault, so they sync. You can also drop files on this window.`)
			.addButton((b) => b.setButtonText('Choose files').onClick(() => picker.click()));

		const node = nodeFs();
		if (!node) return;
		new Setting(el).setName('This device only').setDesc('These fonts do not sync. On other devices, slots that use them fall back to Obsidian\'s font and show a warning.').setHeading();
		for (const dir of s.deviceFolders) {
			const exists = node.fs.existsSync(dir);
			const n = familiesIn(dir, 'folder');
			new Setting(el).setName(dir).setDesc(exists ? (n ? `${n} famil${n === 1 ? 'y' : 'ies'}` : 'No fonts found') : 'Folder not found on this device').addExtraButton((b) =>
				b.setIcon('x').setTooltip('Stop using this folder').onClick(() => save({ deviceFolders: s.deviceFolders.filter((d) => d !== dir) })));
		}
		let deviceInput = '';
		new Setting(el)
			.setName('Add a folder on this device')
			.addText((t) => t.setPlaceholder('Full path to a folder').onChange((v) => (deviceInput = v)))
			.addButton((b) => b.setButtonText('Add').onClick(() => {
				const dir = deviceInput.trim();
				if (!dir) return;
				if (!node.fs.existsSync(dir)) {
					new Notice(`Folder not found: ${dir}`);
					return;
				}
				if (!s.deviceFolders.includes(dir)) save({ deviceFolders: [...s.deviceFolders, dir] });
			}));
		const system = local.filter((f) => f.source === 'system').length;
		new Setting(el)
			.setName('Installed fonts')
			.setDesc(s.systemFonts ? `${system} famil${system === 1 ? 'y' : 'ies'} installed on this computer.` : 'Fonts installed on this computer.')
			.addToggle((t) => t.setValue(s.systemFonts).onChange((v) => save({ systemFonts: v })));
	}

	private async import(files: File[]): Promise<void> {
		if (!files.length) return;
		const n = await this.plugin.importFiles(files);
		if (n) new Notice(`Imported ${n} font file${n === 1 ? '' : 's'} into "${IMPORT_FOLDER}/".`);
		await this.render();
	}
}
