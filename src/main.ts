import { Plugin } from 'obsidian';
import { FontTailorSettingTab } from './settings';

export default class FontTailorPlugin extends Plugin {
	async onload() {
		this.addSettingTab(new FontTailorSettingTab(this.app, this));
	}

	onunload() {}
}
