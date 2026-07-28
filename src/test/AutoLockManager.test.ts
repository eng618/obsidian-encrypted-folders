import { AutoLockManager } from '../services/AutoLockManager';

describe('AutoLockManager', () => {
  let manager: AutoLockManager;

  beforeEach(() => {
    manager = new AutoLockManager();
    manager.setAutoLockSettings({ idleMinutes: 5, lockOnBackground: true });
  });

  test('should record activity and compute remaining idle time', () => {
    const now = Date.now();
    manager.recordActivityForPath('my-folder', now);

    const countdowns = manager.getIdleLockCountdowns(['my-folder'], now + 1000);
    expect(countdowns).toHaveLength(1);
    expect(countdowns[0].folderPath).toBe('my-folder');
    expect(countdowns[0].remainingMs).toBe(5 * 60 * 1000 - 1000);
    expect(countdowns[0].isExpired).toBe(false);
  });

  test('should detect expired folders for auto-lock', () => {
    const now = Date.now();
    manager.recordActivityForPath('expired-folder', now - 6 * 60 * 1000);

    const expired = manager.getExpiredUnlockedFolderPaths(['expired-folder'], now);
    expect(expired).toContain('expired-folder');
  });

  test('should return null countdown when idle auto-lock is disabled', () => {
    manager.setAutoLockSettings({ idleMinutes: 0, lockOnBackground: false });
    manager.recordActivityForPath('folder', Date.now());

    expect(manager.getIdleTimeoutMs()).toBeNull();
    expect(manager.getIdleLockCountdowns(['folder'])).toEqual([]);
  });
});
