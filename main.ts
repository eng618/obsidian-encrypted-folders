import { Notice, Platform, Plugin } from 'obsidian';
import { registerEventSubscriptions } from './src/events/EventSubscriptions';
import type { EncryptedFoldersSettings } from './src/models/Settings';
import { DEFAULT_SETTINGS, ensureTelemetryId, sanitizeSettings } from './src/models/Settings';
import { EncryptionService } from './src/services/EncryptionService';
import { FileService } from './src/services/FileService';
import type { FolderProcessingOptions } from './src/services/FolderService';
import { FolderService } from './src/services/FolderService';
import { LockedFolderReprocessCoordinator } from './src/services/LockedFolderReprocessCoordinator';
import { TelemetryService } from './src/services/TelemetryService';
import { updateExplorerIndicators } from './src/ui/ExplorerIndicators';
import { IdleLockController } from './src/ui/IdleLockController';
import { runWithProcessingModal } from './src/ui/ProcessingRunner';
import { EncryptedFoldersSettingTab } from './src/ui/SettingsTab';

export type { EncryptedFoldersSettings };

export default class EncryptedFoldersPlugin extends Plugin {
  settings: EncryptedFoldersSettings = DEFAULT_SETTINGS;
  encryptionService: EncryptionService;
  fileService: FileService;
  folderService: FolderService;
  reprocessCoordinator: LockedFolderReprocessCoordinator;
  idleLockController: IdleLockController;
  telemetryService: TelemetryService;

  async onload() {
    await this.loadSettings();

    if (!this.settings.telemetryId) {
      ensureTelemetryId(this.settings);
      await this.saveData(this.settings);
    }

    this.telemetryService = new TelemetryService(
      () => this.settings.telemetryEnabled,
      () => ensureTelemetryId(this.settings),
      () => ({
        plugin_version: this.manifest.version,
        platform: Platform.isMobile ? 'mobile' : 'desktop',
      }),
    );

    this.encryptionService = new EncryptionService();
    this.fileService = new FileService(this.app.vault, (file) => this.app.fileManager.trashFile(file));
    this.folderService = new FolderService(this.encryptionService, this.fileService, this.app, {
      telemetry: this.telemetryService,
    });
    this.folderService.setDebugLogging(this.settings.debugLogging);
    this.folderService.setAutoLockSettings({
      idleMinutes: this.settings.autoLockIdleMinutes,
      lockOnBackground: this.settings.autoLockOnBackground,
    });
    await this.folderService.syncFolders();

    this.reprocessCoordinator = new LockedFolderReprocessCoordinator(
      this.app,
      this.folderService,
      () => this.settings.maxPasswordAttempts,
    );

    this.idleLockController = new IdleLockController(this.app, this.folderService, () =>
      this.getIdleLockWarningSeconds(),
    );
    this.idleLockController.attachStatusBar(this.addStatusBarItem());

    registerEventSubscriptions({
      plugin: this,
      recordActiveFolderActivity: () => this.idleLockController.recordActiveFolderActivity(),
      handleVisibilityChange: (isHidden) => this.handleVisibilityChange(isHidden),
      handleIdleAutoLock: () => this.handleIdleAutoLock(),
    });

    this.idleLockController.startInterval((id) => this.registerInterval(id));

    this.addSettingTab(new EncryptedFoldersSettingTab(this.app, this));

    this.telemetryService.trackEvent('plugin_loaded', {});
    await this.maybeShowTelemetryNotice();
  }

  async handleVisibilityChange(isHidden: boolean): Promise<void> {
    await this.idleLockController.handleVisibilityChange(isHidden);
  }

  async handleIdleAutoLock(): Promise<void> {
    await this.idleLockController.handleIdleAutoLock();
  }

  async runLockFolder(folder: Parameters<FolderService['lockFolder']>[0]): Promise<void> {
    await runWithProcessingModal(this.app, 'Locking folder', (options) =>
      this.folderService.lockFolder(folder, options),
    );
    new Notice('Folder locked.');
  }

  async lockFolderWithProgress(
    folder: Parameters<FolderService['lockFolder']>[0],
    options?: FolderProcessingOptions,
  ): Promise<void> {
    if (options) {
      await this.folderService.lockFolder(folder, options);
      return;
    }
    await this.runLockFolder(folder);
  }

  async lockAllFoldersWithProgress(): Promise<void> {
    await runWithProcessingModal(this.app, 'Locking all folders', (options) =>
      this.folderService.lockAllFolders(options),
    );
  }

  refreshExplorerIndicators(): void {
    updateExplorerIndicators(this.app, this.folderService);
  }

  private getIdleLockWarningSeconds(): number {
    const value = this.settings.autoLockWarningSeconds;
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  private async maybeShowTelemetryNotice(): Promise<void> {
    if (this.settings.telemetryNoticeSeen) {
      return;
    }
    this.settings.telemetryNoticeSeen = true;
    await this.saveData(this.settings);
    new Notice(
      'Anonymous usage statistics are collected to improve this plugin. No vault paths, filenames, or contents are ever collected. You can opt out in the plugin settings.',
      12000,
    );
  }

  onunload() {
    this.telemetryService?.trackEvent('plugin_unloaded', {});
    this.reprocessCoordinator?.dispose();
    void this.folderService.lockAllFolders(undefined, 'unload');
  }

  async loadSettings() {
    const loaded = (await this.loadData()) as Partial<EncryptedFoldersSettings> | null;
    this.settings = sanitizeSettings(loaded);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.folderService.setDebugLogging(this.settings.debugLogging);
    this.folderService.setAutoLockSettings({
      idleMinutes: this.settings.autoLockIdleMinutes,
      lockOnBackground: this.settings.autoLockOnBackground,
    });
  }
}
