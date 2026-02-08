import { App, Modal, Setting } from 'obsidian';

export class PasswordModal extends Modal {
  private password = '';

  constructor(
    app: App,
    private title: string,
    private onSubmit: (password: string) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.title });

    new Setting(contentEl).setName('Password').addText((text) => {
      text.setPlaceholder('Enter password').onChange((value) => (this.password = value));
      text.inputEl.type = 'password';
      text.inputEl.focus();
    });

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

  private submit() {
    this.close();
    this.onSubmit(this.password);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
