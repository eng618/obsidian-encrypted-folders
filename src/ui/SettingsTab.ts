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
          .onClick(() => {
            void this.lockAllFolders();
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
      .setName('Auto-lock behavior')
      .setDesc(
        'Background locking applies to every unlocked folder. Inactivity locking is tracked per unlocked folder and is refreshed when you open, edit, or otherwise work inside that folder.',
      );

    new Setting(containerEl)
      .setName('Lock on background')
      .setDesc(
        'Lock all unlocked folders when Obsidian moves to the background. Enabled by default for sync safety, especially on mobile.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoLockOnBackground).onChange(async (value) => {
          this.plugin.settings.autoLockOnBackground = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Lock after inactivity')
      .setDesc(
        'Lock each unlocked folder after this many minutes without activity in that folder. The default is 5 minutes. Set to 0 to disable this safeguard.',
      )
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings.autoLockIdleMinutes)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.autoLockIdleMinutes = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Warn before inactivity lock')
      .setDesc('Show a notice this many seconds before the next inactive folder locks. Set to 0 to disable.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings.autoLockWarningSeconds)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.autoLockWarningSeconds = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Max password attempts')
      .setDesc('Number of failed password attempts before applying exponential backoff.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings.maxPasswordAttempts)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.maxPasswordAttempts = Number.isFinite(parsed) ? Math.max(1, parsed) : 5;
          await this.plugin.saveSettings();
        });
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
        btn.setButtonText('Run scan').onClick(() => {
          void this.runEncryptedFolderScan();
        }),
      );
  }

  private async lockAllFolders(): Promise<void> {
    await this.plugin.lockAllFoldersWithProgress();
    new Notice('All folders locked.');
  }

  private async runEncryptedFolderScan(): Promise<void> {
    await this.plugin.folderService.syncFolders();
    new Notice('Encrypted folder scan complete.');
  }
}
