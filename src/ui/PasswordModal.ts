import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import type { FolderPasswordKind } from '../models/PasswordManagement';
import { addPasswordToggle } from './UIUtils';

export type PasswordSubmitHandler = (
  password: string,
  lockImmediately?: boolean,
  label?: string,
  kind?: FolderPasswordKind,
) => Promise<boolean>;

export interface PasswordModalOptions {
  /** Explicit badge, e.g. "Master password" or 'Custom password — "Banking docs"'. */
  badge?: string;
  /** Helper line under the badge explaining which secret is expected. */
  helperText?: string;
  /** Shows the custom-password title input. */
  labelField?: 'hidden' | 'required';
  initialLabel?: string;
  /** Hides the password input (title-only flows like relabeling). */
  hidePasswordField?: boolean;
  /**
   * Master/custom toggle for the encrypt flow. When the user picks master,
   * the title input hides and the password field is relabeled accordingly.
   */
  kindToggle?: {
    masterAvailable: boolean;
    defaultKind: FolderPasswordKind;
  };
}

export class PasswordModal extends Modal {
  private password = '';
  private label = '';
  private lockImmediately = false;
  private attempts = 0;
  private selectedKind: FolderPasswordKind;
  private passwordSetting: Setting | null = null;
  private labelContainer: HTMLElement | null = null;
  private strengthEl: HTMLElement | null = null;
  private masterInfoEl: HTMLElement | null = null;

  constructor(
    app: App,
    private title: string,
    private onSubmit: PasswordSubmitHandler,
    private showLockToggle = false,
    private maxAttempts = 5,
    private modalOptions: PasswordModalOptions = {},
  ) {
    super(app);
    this.selectedKind = modalOptions.kindToggle?.defaultKind ?? 'custom';
    this.label = modalOptions.initialLabel ?? '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName(this.title).setHeading();

    if (this.modalOptions.badge) {
      const badgeEl = contentEl.createDiv({ cls: 'password-kind-badge' });
      badgeEl.textContent = this.modalOptions.badge;
    }
    if (this.modalOptions.helperText) {
      const helperEl = contentEl.createEl('p', { cls: 'password-kind-helper mod-muted' });
      helperEl.textContent = this.modalOptions.helperText;
    }

    if (this.modalOptions.kindToggle) {
      this.renderKindToggle(contentEl);
    }

    if (this.showLockToggle) {
      const noticeEl = contentEl.createDiv({
        cls: 'metadata-disclosure-notice',
      });
      noticeEl.textContent =
        'Encryption protects your note contents. Note titles, filenames, and directory structures remain unencrypted.';
    }

    this.strengthEl = contentEl.createDiv({
      text: '',
      cls: 'password-strength password-strength-message',
    });

    this.masterInfoEl = contentEl.createEl('p', { cls: 'password-master-info mod-muted' });
    this.masterInfoEl.textContent =
      'This folder will use your master password. Enter it below to confirm — no new password to remember.';

    if (!this.modalOptions.hidePasswordField) {
      this.passwordSetting = new Setting(contentEl).setName('Password');
      this.passwordSetting.addText((text) => {
        text.setPlaceholder('Enter password').onChange((value) => {
          this.password = value;
          if (this.strengthEl) {
            this.updateStrength(this.strengthEl);
          }
        });
        text.inputEl.type = 'password';
        text.inputEl.focus();
        if (this.passwordSetting) {
          addPasswordToggle(this.passwordSetting, text);
        }
      });
    }

    if (this.modalOptions.labelField === 'required') {
      this.labelContainer = contentEl.createDiv({ cls: 'password-label-container' });
      const labelSetting = new Setting(this.labelContainer)
        .setName('Title')
        .setDesc('A short name so you can tell custom passwords apart. Never put the password itself here.');
      labelSetting.addText((text) => {
        text.setPlaceholder('E.g. Banking docs').onChange((value) => {
          this.label = value;
        });
      });
    }

    const errorEl = contentEl.createDiv({
      text: '',
      cls: 'password-error',
    });

    this.updateKindVisibility();

    if (this.showLockToggle) {
      new Setting(contentEl)
        .setName('Lock immediately')
        .setDesc('Encrypt and hide files now')
        .addToggle((toggle) => {
          toggle.setValue(this.lockImmediately).onChange((value) => {
            this.lockImmediately = value;
          });
        });
    }

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Submit')
        .setCta()
        .onClick(async () => {
          await this.submit(errorEl);
        }),
    );

    contentEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        void this.submit(errorEl);
      }
    });
  }

  private renderKindToggle(contentEl: HTMLElement) {
    const toggle = this.modalOptions.kindToggle;
    if (!toggle) {
      return;
    }
    if (!toggle.masterAvailable) {
      const notice = contentEl.createEl('p', { cls: 'password-master-missing mod-muted' });
      notice.textContent = 'No master password set. This folder will use a custom password with its own title.';
      this.selectedKind = 'custom';
      return;
    }
    new Setting(contentEl)
      .setName('Use master password')
      .setDesc('Default password for folders. Turn off to use a custom password with its own title.')
      .addToggle((settingToggle) => {
        settingToggle.setValue(this.selectedKind === 'master').onChange((value) => {
          this.selectedKind = value ? 'master' : 'custom';
          this.updateKindVisibility();
        });
      });
  }

  private updateKindVisibility() {
    const isMasterChoice = this.modalOptions.kindToggle?.masterAvailable === true && this.selectedKind === 'master';
    if (this.masterInfoEl) {
      this.masterInfoEl.style.display = this.modalOptions.kindToggle && isMasterChoice ? '' : 'none';
    }
    if (this.labelContainer) {
      this.labelContainer.style.display = isMasterChoice || this.modalOptions.labelField !== 'required' ? 'none' : '';
    }
    if (this.passwordSetting) {
      this.passwordSetting.setName(isMasterChoice ? 'Master password' : 'Password');
    }
  }

  private updateStrength(el: HTMLElement) {
    if (!this.password) {
      el.textContent = '';
      return;
    }
    const len = this.password.length;
    if (len < 8) {
      el.textContent = 'Weak: too short (min 8 characters)';
      el.classList.remove('password-strength-medium', 'password-strength-strong');
      el.classList.add('password-strength-weak');
    } else if (len < 12) {
      el.textContent = 'Medium: consider making it longer';
      el.classList.remove('password-strength-weak', 'password-strength-strong');
      el.classList.add('password-strength-medium');
    } else {
      el.textContent = 'Strong password';
      el.classList.remove('password-strength-weak', 'password-strength-medium');
      el.classList.add('password-strength-strong');
    }
  }

  private async submit(errorEl: HTMLElement) {
    const isMasterChoice = this.modalOptions.kindToggle?.masterAvailable === true && this.selectedKind === 'master';
    const minLength = this.modalOptions.hidePasswordField
      ? 0
      : this.showLockToggle || this.modalOptions.labelField === 'required'
        ? 8
        : 0;
    if (this.password.length < minLength) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      return;
    }

    let label: string | undefined;
    if (this.modalOptions.labelField === 'required' && !isMasterChoice) {
      label = this.label.trim();
      if (!label) {
        errorEl.textContent = 'A title is required so you can tell custom passwords apart.';
        return;
      }
      if (label.length > 80) {
        errorEl.textContent = 'Title must be at most 80 characters.';
        return;
      }
    }

    try {
      const success = await this.onSubmit(
        this.password,
        this.lockImmediately,
        label,
        this.modalOptions.kindToggle ? this.selectedKind : undefined,
      );
      if (success) {
        this.close();
      } else {
        this.attempts++;
        if (this.attempts >= this.maxAttempts) {
          const delay = Math.pow(2, this.attempts - this.maxAttempts + 1) * 1000;
          errorEl.textContent = `Too many attempts. Please wait ${delay / 1000}s.`;
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        } else {
          errorEl.textContent = `Incorrect password. ${this.maxAttempts - this.attempts} attempts remaining.`;
        }
      }
    } catch (error: unknown) {
      errorEl.textContent = `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
