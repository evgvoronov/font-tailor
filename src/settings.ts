import { PluginSettingTab } from 'obsidian';

// Obsidian lists this tab under the manifest name, "Font Tailor".
export class FontTailorSettingTab extends PluginSettingTab {
	display(): void {
		this.containerEl.empty();
	}
}
