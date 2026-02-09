import { App, Modal, Setting } from 'obsidian';

export class PasswordModal extends Modal {
  private password = '';
  private lockImmediately = false;

  constructor(
    app: App,
    private title: string,
    private onSubmit: (password: string, lockImmediately?: boolean) => void,
    private showLockToggle = false,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.title });

    const strengthEl = contentEl.createEl('div', { text: '', cls: 'password-strength' });
    strengthEl.style.marginBottom = '10px';
    strengthEl.style.fontSize = '0.8em';

    new Setting(contentEl).setName('Password').addText((text) => {
      text.setPlaceholder('Enter password').onChange((value) => {
        this.password = value;
        this.updateStrength(strengthEl);
      });
      text.inputEl.type = 'password';
      text.inputEl.focus();
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
      el.textContent = 'Weak: Too short (min 8 characters)';
      el.style.color = 'var(--text-error)';
    } else if (len < 12) {
      el.textContent = 'Medium: Consider making it longer';
      el.style.color = 'var(--text-warning)';
    } else {
      el.textContent = 'Strong password';
      el.style.color = 'var(--text-success)';
    }
  }

  private submit() {
    if (this.showLockToggle && this.password.length < 8) {
      return; // Enforce for encryption
    }
    this.close();
    this.onSubmit(this.password, this.lockImmediately);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
