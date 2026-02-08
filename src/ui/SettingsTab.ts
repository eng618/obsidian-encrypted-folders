import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
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
      .setName('Security Actions')
      .setDesc('Immediately lock all currently unlocked folders.')
      .addButton((btn) =>
        btn
          .setButtonText('Lock All Folders')
          .setWarning()
          .setTooltip('This will re-encrypt all content and clear keys from memory.')
          .onClick(async () => {
            await this.plugin.folderService.lockAllFolders();
            new Notice('All folders locked.');
          }),
      );

    new Setting(containerEl)
      .setName('Active Session')
      .setDesc('Any folders unlocked in this session will be listed here.')
      .then((s) => {
        const unlocked = Array.from((this.plugin.folderService as any).unlockedFolders.keys());
        if (unlocked.length === 0) {
          s.setDesc('No folders are currently unlocked.');
        } else {
          s.setDesc(`Unlocked: ${unlocked.join(', ')}`);
        }
      });

    new Setting(containerEl)
      .setName('Backup Encrypted Keys')
      .setDesc('Cloud backup and multi-device sync is coming soon.')
      .addToggle((toggle) => toggle.setValue(false).setDisabled(true));
  }
}
