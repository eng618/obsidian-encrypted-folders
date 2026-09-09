import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
import type EncryptedFoldersPlugin from '../../main';

type SettingsKey =
  'autoLockOnBackground' | 'autoLockIdleMinutes' | 'autoLockWarningSeconds' | 'debugLogging' | 'maxPasswordAttempts';

export class EncryptedFoldersSettingTab extends PluginSettingTab {
  plugin: EncryptedFoldersPlugin;

  constructor(app: App, plugin: EncryptedFoldersPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Security actions',
        desc: 'Immediately lock all currently unlocked folders.',
        action: () => {
          void this.lockAllFolders();
        },
      },
      {
        name: 'Active session',
        desc: 'Any folders unlocked in this session will be listed here.',
        render: (setting: Setting) => {
          const unlocked = this.plugin.folderService.getUnlockedFolderPaths();
          if (unlocked.length === 0) {
            setting.setDesc('No folders are currently unlocked.');
          } else {
            setting.setDesc(`Unlocked: ${unlocked.join(', ')}`);
          }
        },
      },
      {
        name: 'Auto-lock behavior',
        desc: 'Background locking applies to every unlocked folder. Inactivity locking is tracked per unlocked folder and is refreshed when you open, edit, or otherwise work inside that folder.',
      },
      {
        name: 'Lock on background',
        desc: 'Lock all unlocked folders when Obsidian moves to the background. Enabled by default for sync safety, especially on mobile.',
        control: {
          type: 'toggle',
          key: 'autoLockOnBackground',
          defaultValue: true,
        },
      },
      {
        name: 'Lock after inactivity',
        desc: 'Lock each unlocked folder after this many minutes without activity in that folder. The default is 5 minutes. Set to 0 to disable this safeguard.',
        control: {
          type: 'number',
          key: 'autoLockIdleMinutes',
          defaultValue: 5,
          min: 0,
          step: 1,
        },
      },
      {
        name: 'Warn before inactivity lock',
        desc: 'Show a notice this many seconds before the next inactive folder locks. Set to 0 to disable.',
        control: {
          type: 'number',
          key: 'autoLockWarningSeconds',
          defaultValue: 60,
          min: 0,
          step: 1,
        },
      },
      {
        name: 'Max password attempts',
        desc: 'Number of failed password attempts before applying exponential backoff.',
        control: {
          type: 'number',
          key: 'maxPasswordAttempts',
          defaultValue: 5,
          min: 1,
          step: 1,
        },
      },
      {
        name: 'Sync diagnostics',
        desc: 'Enable debug logs for cross-device sync detection, migration, and lock state transitions.',
        control: {
          type: 'toggle',
          key: 'debugLogging',
          defaultValue: false,
        },
      },
      {
        name: 'Rescan encrypted folders',
        desc: 'Force a vault-wide encrypted folder scan. Use this after sync or migration events.',
        action: () => {
          void this.runEncryptedFolderScan();
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as SettingsKey];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settingsKey = key as SettingsKey;
    switch (settingsKey) {
      case 'autoLockOnBackground':
        this.plugin.settings.autoLockOnBackground = value === true;
        break;
      case 'autoLockIdleMinutes':
        this.plugin.settings.autoLockIdleMinutes = this.clampInt(value, 0, 0);
        break;
      case 'autoLockWarningSeconds':
        this.plugin.settings.autoLockWarningSeconds = this.clampInt(value, 0, 60);
        break;
      case 'debugLogging':
        this.plugin.settings.debugLogging = value === true;
        break;
      case 'maxPasswordAttempts':
        this.plugin.settings.maxPasswordAttempts = this.clampInt(value, 1, 5);
        break;
    }
    await this.plugin.saveSettings();
  }

  private clampInt(value: unknown, min: number, fallback: number): number {
    const parsed = typeof value === 'number' ? Math.floor(value) : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, parsed);
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
