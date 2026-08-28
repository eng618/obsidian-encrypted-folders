import { App, Notice, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import EncryptedFoldersPlugin from '../../main';

export class EncryptedFoldersSettingTab extends PluginSettingTab {
  plugin: EncryptedFoldersPlugin;

  constructor(app: App, plugin: EncryptedFoldersPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override getControlValue(key: string): unknown {
    return (this.plugin.settings as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Security actions',
        items: [
          {
            name: 'Lock all folders',
            desc: 'Immediately lock all currently unlocked folders and clear keys from memory.',
            action: () => {
              void this.lockAllFolders();
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Auto-lock behavior',
        items: [
          {
            name: 'Lock on background',
            desc: 'Lock all unlocked folders when Obsidian moves to the background. Enabled by default for sync safety, especially on mobile.',
            control: {
              type: 'toggle',
              key: 'autoLockOnBackground',
            },
          },
          {
            name: 'Lock after inactivity',
            desc: 'Lock each unlocked folder after this many minutes without activity in that folder. The default is 5 minutes. Set to 0 to disable this safeguard.',
            control: {
              type: 'number',
              key: 'autoLockIdleMinutes',
              validate: (value) => {
                if (typeof value === 'number' && value < 0) {
                  return 'Must be 0 or greater';
                }
              },
            },
          },
          {
            name: 'Warn before inactivity lock',
            desc: 'Show a notice this many seconds before the next inactive folder locks. Set to 0 to disable.',
            control: {
              type: 'number',
              key: 'autoLockWarningSeconds',
              validate: (value) => {
                if (typeof value === 'number' && value < 0) {
                  return 'Must be 0 or greater';
                }
              },
            },
          },
          {
            name: 'Max password attempts',
            desc: 'Number of failed password attempts before applying exponential backoff.',
            control: {
              type: 'number',
              key: 'maxPasswordAttempts',
              validate: (value) => {
                if (typeof value === 'number' && value < 1) {
                  return 'Must be at least 1';
                }
              },
            },
          },
          {
            name: 'Sync diagnostics',
            desc: 'Enable debug logs for cross-device sync detection, migration, and lock state transitions.',
            control: {
              type: 'toggle',
              key: 'debugLogging',
            },
          },
          {
            name: 'Rescan encrypted folders',
            desc: 'Force a vault-wide encrypted folder scan. Use this after sync or migration events.',
            action: () => {
              void this.runEncryptedFolderScan();
            },
          },
        ],
      },
    ];
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
