import { App } from 'obsidian';
import type { Mock } from 'vitest';

import { PasswordModal } from '../ui/PasswordModal';

describe('PasswordModal Brute-Force Protection', () => {
  let app: App;
  let mockSubmit: Mock<(password: string, lockImmediately?: boolean) => Promise<boolean>>;

  beforeEach(() => {
    app = new App();
    mockSubmit = vi.fn();
  });

  it('should close the modal on a successful submission', async () => {
    mockSubmit.mockResolvedValue(true);
    const modal = new PasswordModal(app, 'Test Modal', mockSubmit);
    const closeSpy = vi.spyOn(modal, 'close');

    modal.onOpen();

    const errorEl = modal.contentEl.querySelector('.password-error')!;
    await (modal as any).submit(errorEl);

    expect(closeSpy).toHaveBeenCalled();
    expect(mockSubmit).toHaveBeenCalled();
  });

  it('should track failed attempts and show remaining count', async () => {
    mockSubmit.mockResolvedValue(false);
    const modal = new PasswordModal(app, 'Test Modal', mockSubmit, false, 3);
    modal.onOpen();
    const errorEl = modal.contentEl.querySelector('.password-error')!;

    // Attempt 1
    await (modal as any).submit(errorEl);
    expect(errorEl.textContent).toContain('2 attempts remaining');

    // Attempt 2
    await (modal as any).submit(errorEl);
    expect(errorEl.textContent).toContain('1 attempts remaining');
  });

  it('should apply exponential backoff after max attempts', async () => {
    vi.useFakeTimers();
    mockSubmit.mockResolvedValue(false);
    const modal = new PasswordModal(app, 'Test Modal', mockSubmit, false, 2);
    modal.onOpen();
    const errorEl = modal.contentEl.querySelector('.password-error')!;

    // Attempt 1: does not hit maxAttempts (1 < 2)
    await (modal as any).submit(errorEl);

    // Attempt 2: hits maxAttempts (2 >= 2), will trigger setTimeout
    const submitPromise = (modal as any).submit(errorEl);

    // Flush microtasks to allow the async onSubmit to resolve
    await Promise.resolve();

    expect(errorEl.textContent).toContain('Too many attempts');

    await vi.runAllTimersAsync();
    await submitPromise;

    vi.useRealTimers();
  }, 10000);

  it('should handle errors from the submit callback gracefully', async () => {
    mockSubmit.mockRejectedValue(new Error('API Error'));
    const modal = new PasswordModal(app, 'Test Modal', mockSubmit);
    modal.onOpen();
    const errorEl = modal.contentEl.querySelector('.password-error')!;

    await (modal as any).submit(errorEl);
    expect(errorEl.textContent).toContain('An error occurred: API Error');
  });

  it('should enforce minimum password length when lockToggle is enabled', async () => {
    mockSubmit.mockResolvedValue(true);
    const modal = new PasswordModal(app, 'Test Modal', mockSubmit, true);
    modal.onOpen();
    const errorEl = modal.contentEl.querySelector('.password-error')!;

    (modal as any).password = 'short';
    await (modal as any).submit(errorEl);

    expect(errorEl.textContent).toContain('Password must be at least 8 characters');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('should render badge and helper text explicitly', () => {
    const modal = new PasswordModal(app, 'Unlock folder', mockSubmit, false, 5, {
      badge: 'Master password',
      helperText: 'Uses your master password.',
    });
    modal.onOpen();
    expect(modal.contentEl.querySelector('.password-kind-badge')?.textContent).toBe('Master password');
    expect(modal.contentEl.querySelector('.password-kind-helper')?.textContent).toBe('Uses your master password.');
  });

  it('should require a title when labelField is required', async () => {
    mockSubmit.mockResolvedValue(true);
    const modal = new PasswordModal(app, 'Encrypt folder', mockSubmit, true, 5, { labelField: 'required' });
    modal.onOpen();
    const errorEl = modal.contentEl.querySelector('.password-error')!;

    (modal as any).password = 'long-enough-password';
    (modal as any).label = '   ';
    await (modal as any).submit(errorEl);

    expect(errorEl.textContent).toContain('title is required');
    expect(mockSubmit).not.toHaveBeenCalled();

    (modal as any).label = 'Banking docs';
    await (modal as any).submit(errorEl);
    expect(mockSubmit).toHaveBeenCalledWith('long-enough-password', false, 'Banking docs', undefined);
  });

  it('should default to master kind and pass it to submit when toggle available', async () => {
    mockSubmit.mockResolvedValue(true);
    const modal = new PasswordModal(app, 'Encrypt folder', mockSubmit, true, 5, {
      kindToggle: { masterAvailable: true, defaultKind: 'master' },
      labelField: 'required',
    });
    modal.onOpen();
    const errorEl = modal.contentEl.querySelector('.password-error')!;

    (modal as any).password = 'master-pass-123';
    await (modal as any).submit(errorEl);
    expect(mockSubmit).toHaveBeenCalledWith('master-pass-123', false, undefined, 'master');
  });

  it('should fall back to custom when no master password exists', async () => {
    mockSubmit.mockResolvedValue(true);
    const modal = new PasswordModal(app, 'Encrypt folder', mockSubmit, true, 5, {
      kindToggle: { masterAvailable: false, defaultKind: 'custom' },
      labelField: 'required',
    });
    modal.onOpen();
    expect(modal.contentEl.textContent).toContain('No master password set');
    const errorEl = modal.contentEl.querySelector('.password-error')!;

    (modal as any).password = 'custom-pass-123';
    (modal as any).label = 'Personal';
    await (modal as any).submit(errorEl);
    expect(mockSubmit).toHaveBeenCalledWith('custom-pass-123', false, 'Personal', 'custom');
  });
});
