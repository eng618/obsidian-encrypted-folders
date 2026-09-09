import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../models/Settings';
import { getIndicatorClass } from '../ui/ExplorerIndicators';
import { formatCountdown, getWarningKey } from '../ui/IdleLockController';
import { createAbortError, isAbortError, toError } from '../utils/abort';

describe('Settings model', () => {
  test('sanitizeSettings fills defaults for empty input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test('sanitizeSettings clamps out-of-range values', () => {
    const result = sanitizeSettings({
      autoLockIdleMinutes: -3,
      autoLockWarningSeconds: Number.NaN,
      maxPasswordAttempts: 0,
    });
    expect(result.autoLockIdleMinutes).toBe(0);
    expect(result.autoLockWarningSeconds).toBe(DEFAULT_SETTINGS.autoLockWarningSeconds);
    expect(result.maxPasswordAttempts).toBe(1);
  });
});

describe('abort utils', () => {
  test('createAbortError produces identifiable AbortError', () => {
    const error = createAbortError();
    expect(error.name).toBe('AbortError');
    expect(isAbortError(error)).toBe(true);
    expect(isAbortError(new Error('other'))).toBe(false);
  });

  test('toError normalizes unknown values', () => {
    const original = new Error('boom');
    expect(toError(original, 'fallback')).toBe(original);
    expect(toError('oops', 'fallback').message).toBe('oops');
    expect(toError(42, 'fallback').message).toBe('fallback');
  });
});

describe('IdleLockController helpers', () => {
  test('formatCountdown renders m:ss', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(-100)).toBe('0:00');
  });

  test('getWarningKey is stable per folder and lock time', () => {
    expect(getWarningKey({ folderPath: 'a', locksAt: 1 } as never)).toBe('a:1');
  });
});

describe('ExplorerIndicators', () => {
  test('getIndicatorClass maps state to CSS class', () => {
    expect(getIndicatorClass(false, false)).toBeNull();
    expect(getIndicatorClass(false, true)).toBeNull();
    expect(getIndicatorClass(true, true)).toBe('ef-folder-unlocked');
    expect(getIndicatorClass(true, false)).toBe('ef-folder-locked');
  });
});
