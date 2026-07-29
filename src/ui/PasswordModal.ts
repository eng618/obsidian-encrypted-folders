import { App, Modal, Setting } from 'obsidian';
import { addPasswordToggle } from './UIUtils';

export class PasswordModal extends Modal {
  private password = '';
  private lockImmediately = false;
  private attempts = 0;

  constructor(
    app: App,
    private title: string,
    private onSubmit: (password: string, lockImmediately?: boolean) => Promise<boolean>,
    private showLockToggle = false,
    private maxAttempts = 5,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName(this.title).setHeading();

    if (this.showLockToggle) {
      const noticeEl = contentEl.createEl('div', {
        cls: 'metadata-disclosure-notice',
      });
      noticeEl.textContent =
        'ℹ️ Note: Encryption protects your note contents. Note titles, filenames, and directory structures remain unencrypted.';
    }

    const strengthEl = contentEl.createEl('div', {
      text: '',
      cls: 'password-strength password-strength-message',
    });

    const passwordSetting = new Setting(contentEl).setName('Password');
    passwordSetting.addText((text) => {
      text.setPlaceholder('Enter password').onChange((value) => {
        this.password = value;
        this.updateStrength(strengthEl);
      });
      text.inputEl.type = 'password';
      text.inputEl.focus();
      addPasswordToggle(passwordSetting, text);
    });

    const errorEl = contentEl.createEl('div', {
      text: '',
      cls: 'password-error',
    });
    errorEl.style.color = 'var(--text-error)';
    errorEl.style.marginBottom = '10px';
    errorEl.style.fontSize = '0.9em';

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
    if (this.showLockToggle && this.password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      return;
    }

    try {
      const success = await this.onSubmit(this.password, this.lockImmediately);
      if (success) {
        this.close();
      } else {
        this.attempts++;
        if (this.attempts >= this.maxAttempts) {
          const delay = Math.pow(2, this.attempts - this.maxAttempts + 1) * 1000;
          errorEl.textContent = `Too many attempts. Please wait ${delay / 1000}s.`;
          await new Promise((resolve) => setTimeout(resolve, delay));
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
