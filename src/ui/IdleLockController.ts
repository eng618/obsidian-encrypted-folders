import { App, Notice } from 'obsidian';
import type { FolderService, IdleLockCountdown } from '../services/FolderService';

export class IdleLockController {
  private readonly autoLockCheckIntervalMs = 1000;
  private statusBarEl: HTMLElement | null = null;
  private warningKeys: Set<string> = new Set();
  private intervalId: number | null = null;

  constructor(
    private app: App,
    private folderService: FolderService,
    private getWarningSeconds: () => number,
  ) {}

  attachStatusBar(el: HTMLElement): void {
    this.statusBarEl = el;
    this.updateCountdownStatus();
  }

  startInterval(registerInterval: (id: number) => void): void {
    const id = window.setInterval(() => {
      void this.handleIdleAutoLock();
    }, this.autoLockCheckIntervalMs);
    this.intervalId = id;
    registerInterval(id);
  }

  getIntervalId(): number | null {
    return this.intervalId;
  }

  async handleVisibilityChange(isHidden: boolean): Promise<void> {
    if (!isHidden) {
      this.recordActiveFolderActivity();
      return;
    }

    const locked = await this.folderService.runBackgroundAutoLock();
    if (locked) {
      new Notice('Unlocked folders were locked because Obsidian entered the background.');
    }
  }

  async handleIdleAutoLock(): Promise<void> {
    this.updateCountdownStatus();
    this.maybeShowWarning();

    const locked = await this.folderService.runIdleAutoLock();
    if (locked) {
      this.updateCountdownStatus();
      new Notice('Inactive unlocked folders were locked automatically.');
    }
  }

  recordActiveFolderActivity(): void {
    this.folderService.recordActivityForItem(this.app.workspace.getActiveFile());
  }

  updateCountdownStatus(): void {
    if (!this.statusBarEl) {
      return;
    }

    const countdown = this.folderService.getNextIdleLockCountdown();
    if (!countdown) {
      this.statusBarEl.textContent = '';
      this.statusBarEl.hide();
      this.warningKeys.clear();
      return;
    }

    this.statusBarEl.show();
    const folderName = countdown.folderPath.split('/').pop() || countdown.folderPath;
    this.statusBarEl.textContent = `Encrypted Folders: locks "${folderName}" in ${formatCountdown(countdown.remainingMs)}`;
  }

  private maybeShowWarning(): void {
    const warningSeconds = this.getWarningSeconds();
    if (warningSeconds <= 0) {
      return;
    }

    const countdown = this.folderService.getNextIdleLockCountdown();
    if (!countdown || countdown.isExpired) {
      return;
    }

    if (countdown.remainingMs > warningSeconds * 1000) {
      return;
    }

    const warningKey = getWarningKey(countdown);
    if (this.warningKeys.has(warningKey)) {
      return;
    }

    this.warningKeys.add(warningKey);
    new Notice(
      `Folder "${countdown.folderPath}" will lock in ${formatCountdown(countdown.remainingMs)} due to inactivity.`,
    );
  }
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getWarningKey(countdown: IdleLockCountdown): string {
  return `${countdown.folderPath}:${countdown.locksAt}`;
}
