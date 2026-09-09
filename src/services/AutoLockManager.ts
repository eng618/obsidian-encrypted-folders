import { normalizePath } from 'obsidian';

export interface AutoLockSettings {
  idleMinutes: number;
  lockOnBackground: boolean;
}

export interface IdleLockCountdown {
  folderPath: string;
  lastActivityAt: number;
  locksAt: number;
  remainingMs: number;
  isExpired: boolean;
}

export class AutoLockManager {
  private unlockedFolderActivityAt: Map<string, number> = new Map();
  private autoLockSettings: AutoLockSettings = {
    idleMinutes: 5,
    lockOnBackground: true,
  };

  setAutoLockSettings(settings: AutoLockSettings): void {
    this.autoLockSettings = {
      idleMinutes: Number.isFinite(settings.idleMinutes) ? Math.max(0, Math.floor(settings.idleMinutes)) : 0,
      lockOnBackground: Boolean(settings.lockOnBackground),
    };
  }

  getAutoLockSettings(): AutoLockSettings {
    return { ...this.autoLockSettings };
  }

  recordActivityForPath(path: string, timestamp = Date.now()): void {
    const folderKey = normalizePath(path);
    this.unlockedFolderActivityAt.set(folderKey, timestamp);
  }

  removePath(path: string): void {
    const folderKey = normalizePath(path);
    this.unlockedFolderActivityAt.delete(folderKey);
  }

  updatePath(oldPath: string, newPath: string): void {
    const oldKey = normalizePath(oldPath);
    const newKey = normalizePath(newPath);
    const activityAt = this.unlockedFolderActivityAt.get(oldKey);
    if (activityAt !== undefined) {
      this.unlockedFolderActivityAt.set(newKey, activityAt);
      this.unlockedFolderActivityAt.delete(oldKey);
    }
  }

  getIdleTimeoutMs(): number | null {
    if (this.autoLockSettings.idleMinutes <= 0) {
      return null;
    }
    return this.autoLockSettings.idleMinutes * 60 * 1000;
  }

  getIdleLockCountdowns(unlockedFolderPaths: string[], timestamp = Date.now()): IdleLockCountdown[] {
    const idleTimeoutMs = this.getIdleTimeoutMs();
    if (idleTimeoutMs === null) {
      return [];
    }

    return unlockedFolderPaths
      .map((folderPath) => {
        const lastActivityAt = this.unlockedFolderActivityAt.get(normalizePath(folderPath));
        if (lastActivityAt === undefined) {
          return null;
        }

        const locksAt = lastActivityAt + idleTimeoutMs;
        return {
          folderPath,
          lastActivityAt,
          locksAt,
          remainingMs: Math.max(0, locksAt - timestamp),
          isExpired: timestamp >= locksAt,
        };
      })
      .filter((countdown): countdown is IdleLockCountdown => countdown !== null)
      .sort((a, b) => a.locksAt - b.locksAt);
  }

  getNextIdleLockCountdown(unlockedFolderPaths: string[], timestamp = Date.now()): IdleLockCountdown | null {
    return this.getIdleLockCountdowns(unlockedFolderPaths, timestamp)[0] ?? null;
  }

  getExpiredUnlockedFolderPaths(unlockedFolderPaths: string[], timestamp = Date.now()): string[] {
    const idleTimeoutMs = this.getIdleTimeoutMs();
    if (idleTimeoutMs === null) {
      return [];
    }

    return unlockedFolderPaths.filter((folderPath) => {
      const lastActivityAt = this.unlockedFolderActivityAt.get(normalizePath(folderPath));
      if (lastActivityAt === undefined) {
        return false;
      }
      return timestamp - lastActivityAt >= idleTimeoutMs;
    });
  }
}
