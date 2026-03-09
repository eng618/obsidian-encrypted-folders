import { App, Modal, Setting } from 'obsidian';
import { addPasswordToggle } from './UIUtils';

export class PasswordModal extends Modal {
  private password = '';
  private lockImmediately = false;

  constructor(
    app: App,
    private title: string,
    private onSubmit: (password: string, lockImmediately?: boolean) => void | Promise<void>,
    private showLockToggle = false,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName(this.title).setHeading();

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
        .onClick(() => {
          this.submit();
        }),
    );

    contentEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.submit();
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

  private submit() {
    if (this.showLockToggle && this.password.length < 8) {
      return; // Enforce for encryption
    }
    this.close();
    void Promise.resolve(this.onSubmit(this.password, this.lockImmediately)).catch((error: unknown) => {
      console.error('Password modal submission failed', error);
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
