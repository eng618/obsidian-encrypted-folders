export interface EncryptedFoldersSettings {
  autoLockOnBackground: boolean;
  autoLockIdleMinutes: number;
  autoLockWarningSeconds: number;
  debugLogging: boolean;
  maxPasswordAttempts: number;
}

export const DEFAULT_SETTINGS: EncryptedFoldersSettings = {
  autoLockOnBackground: true,
  autoLockIdleMinutes: 5,
  autoLockWarningSeconds: 60,
  debugLogging: false,
  maxPasswordAttempts: 5,
};

export function sanitizeSettings(
  loaded: Partial<EncryptedFoldersSettings> | null | undefined,
): EncryptedFoldersSettings {
  const settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
  settings.autoLockWarningSeconds = Number.isFinite(settings.autoLockWarningSeconds)
    ? Math.max(0, Math.floor(settings.autoLockWarningSeconds))
    : DEFAULT_SETTINGS.autoLockWarningSeconds;
  settings.autoLockIdleMinutes = Number.isFinite(settings.autoLockIdleMinutes)
    ? Math.max(0, Math.floor(settings.autoLockIdleMinutes))
    : DEFAULT_SETTINGS.autoLockIdleMinutes;
  settings.maxPasswordAttempts = Number.isFinite(settings.maxPasswordAttempts)
    ? Math.max(1, Math.floor(settings.maxPasswordAttempts))
    : DEFAULT_SETTINGS.maxPasswordAttempts;
  return settings;
}
