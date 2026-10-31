import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
import type EncryptedFoldersPlugin from '../../main';
import { describePasswordKind } from '../models/PasswordManagement';
import type { FolderPasswordSummary } from '../services/FolderService';
import { PasswordModal } from './PasswordModal';
import { RecoveryKeyModal } from './RecoveryKeyModal';

type SettingsKey =
  | 'autoLockOnBackground'
  | 'autoLockIdleMinutes'
  | 'autoLockWarningSeconds'
  | 'debugLogging'
  | 'maxPasswordAttempts'
  | 'telemetryEnabled';

export class EncryptedFoldersSettingTab extends PluginSettingTab {
  plugin: EncryptedFoldersPlugin;

  constructor(app: App, plugin: EncryptedFoldersPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Master password',
        desc: 'Optional default password for folders. Folders encrypted with it show a Master password badge; others use titled custom passwords.',
      },
      {
        name: 'Master password status',
        render: (setting: Setting) => {
          const record = this.plugin.settings.masterPassword;
          if (record) {
            const updated = new Date(record.updatedAt).toLocaleDateString();
            setting.setDesc(`Set — last changed ${updated}. One recovery key covers every master folder.`);
          } else {
            setting.setDesc('Not set. Each folder currently needs its own custom password.');
          }
        },
      },
      {
        name: 'Set up master password',
        desc: 'Choose a master password. You will receive one recovery key covering every master folder.',
        visible: () => !this.plugin.settings.masterPassword,
        action: () => {
          this.openMasterSetup();
        },
      },
      {
        name: 'Change master password',
        desc: 'Re-wraps every master folder at once. Folders may stay locked; file contents are untouched.',
        visible: () => !!this.plugin.settings.masterPassword,
        action: () => {
          this.openMasterChange();
        },
      },
      {
        name: 'Remove master password',
        desc: 'Only available once no folder uses it. Convert master folders to custom passwords first.',
        visible: () => !!this.plugin.settings.masterPassword,
        action: () => {
          this.openMasterRemove();
        },
      },
      {
        name: 'Folders and passwords',
        desc: 'Which password protects each folder. Right-click (or long-press) a folder for switch, change, and rename actions.',
        render: (setting: Setting) => {
          const summaries = this.cachedFolderSummaries;
          if (summaries.length === 0) {
            setting.setDesc('No encrypted folders yet.');
            return;
          }
          const lines = summaries.map((s) =>
            s.kind === 'master'
              ? `🔑 ${s.path} — Master password`
              : `🔒 ${s.path} — ${describePasswordKind(s.kind, s.label)}`,
          );
          setting.setDesc(lines.join('\n'));
        },
      },
      {
        name: 'Refresh folder list',
        desc: 'Re-read folder metadata for the list above.',
        action: () => {
          void this.refreshFolderSummaries();
        },
      },
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
      {
        name: 'Anonymous usage telemetry',
        desc: 'Send anonymous usage events (encrypt, unlock, lock) to help improve the plugin. No vault paths, filenames, passwords, or file contents are ever collected. See the README privacy section for details.',
        control: {
          type: 'toggle',
          key: 'telemetryEnabled',
          defaultValue: true,
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
      case 'telemetryEnabled':
        this.plugin.settings.telemetryEnabled = value === true;
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
    await this.plugin.folderService.syncFolders(3, 300, true);
    new Notice('Encrypted folder scan complete.');
  }

  private cachedFolderSummaries: FolderPasswordSummary[] = [];

  private async refreshFolderSummaries(): Promise<void> {
    try {
      this.cachedFolderSummaries = await this.plugin.folderService.listFolderPasswordKinds();
    } catch {
      this.cachedFolderSummaries = [];
    }
    new Notice('Folder list refreshed.');
  }

  private openMasterSetup(): void {
    new PasswordModal(
      this.app,
      'Set up master password',
      async (password) => {
        try {
          const recoveryKey = await this.plugin.folderService.setupMasterPassword(password);
          new RecoveryKeyModal(this.app, recoveryKey).open();
          new Notice('Master password set. New folders will use it by default.');
          return true;
        } catch (e) {
          throw e instanceof Error ? e : new Error(String(e));
        }
      },
      false,
      this.plugin.settings.maxPasswordAttempts,
      {
        badge: 'Master password',
        helperText:
          'This becomes the default password for folders. You will receive one recovery key for all master folders.',
      },
    ).open();
  }

  private openMasterChange(): void {
    new PasswordModal(
      this.app,
      'Verify current master password',
      async (oldPassword) => {
        const valid = await this.plugin.folderService.verifyMasterPassword(oldPassword);
        if (!valid) {
          return false;
        }
        new PasswordModal(
          this.app,
          'New master password',
          async (newPassword) => {
            try {
              const { rotated, total, previousWrapsRemaining } = await this.plugin.folderService.changeMasterPassword(
                oldPassword,
                newPassword,
              );
              const changed =
                total === 0
                  ? 'Master password changed.'
                  : `Master password changed. ${rotated} of ${total} folders re-wrapped.`;
              new Notice(
                previousWrapsRemaining > 0
                  ? `${changed} Backup wraps remain and will be cleared on the next folder sync.`
                  : changed,
              );
              return true;
            } catch (e) {
              throw e instanceof Error ? e : new Error(String(e));
            }
          },
          false,
          this.plugin.settings.maxPasswordAttempts,
          { badge: 'Master password' },
        ).open();
        return true;
      },
      false,
      this.plugin.settings.maxPasswordAttempts,
      { badge: 'Master password' },
    ).open();
  }

  private openMasterRemove(): void {
    new PasswordModal(
      this.app,
      'Verify to remove master password',
      async (password) => {
        try {
          await this.plugin.folderService.removeMasterPassword(password);
          new Notice('Master password removed.');
          return true;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (/Incorrect master password|Authentication failed/i.test(message)) {
            return false;
          }
          new Notice(message);
          return true;
        }
      },
      false,
      this.plugin.settings.maxPasswordAttempts,
      { badge: 'Master password' },
    ).open();
  }
}
