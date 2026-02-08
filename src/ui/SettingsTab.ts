import { App, PluginSettingTab, Setting } from 'obsidian';
import EncryptedFoldersPlugin from '../../main';

export class EncryptedFoldersSettingTab extends PluginSettingTab {
  plugin: EncryptedFoldersPlugin;

  constructor(app: App, plugin: EncryptedFoldersPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Encrypted Folders Settings' });

    new Setting(containerEl)
      .setName('Backup Encrypted Keys')
      .setDesc('Feature coming soon')
      .addToggle((toggle) => toggle.setValue(false).setDisabled(true));
  }
}
