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
    new Setting(containerEl)
      .setName('Security actions')
      .setDesc('Immediately lock all currently unlocked folders.')
      .addButton((btn) =>
        btn
          .setButtonText('Lock all folders')
          .setWarning()
          .setTooltip('This will re-encrypt all content and clear keys from memory.')
          .onClick(async () => {
            await this.plugin.folderService.lockAllFolders();
            new Notice('All folders locked.');
          }),
      );

    new Setting(containerEl)
      .setName('Active session')
      .setDesc('Any folders unlocked in this session will be listed here.')
      .then((s) => {
        const unlocked = this.plugin.folderService.getUnlockedFolderPaths();
        if (unlocked.length === 0) {
          s.setDesc('No folders are currently unlocked.');
        } else {
          s.setDesc(`Unlocked: ${unlocked.join(', ')}`);
        }
      });

    new Setting(containerEl)
      .setName('Sync diagnostics')
      .setDesc('Enable debug logs for cross-device sync detection, migration, and lock state transitions.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
          this.plugin.settings.debugLogging = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Rescan encrypted folders')
      .setDesc('Force a vault-wide encrypted folder scan. Use this after sync or migration events.')
      .addButton((btn) =>
        btn.setButtonText('Run scan').onClick(async () => {
          await this.plugin.folderService.syncFolders();
          new Notice('Encrypted folder scan complete.');
        }),
      );
  }
}
