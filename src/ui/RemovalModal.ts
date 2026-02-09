import { App, Modal, Notice, Setting } from 'obsidian';

export class RemovalModal extends Modal {
  private password = '';

  constructor(
    app: App,
    private isLocked: boolean,
    private onConfirm: (password?: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Remove Encryption' });

    contentEl.createEl('p', {
      text: 'This will permanently remove encryption from this folder and restore it to a normal folder. This action cannot be undone.',
      cls: 'mod-warning',
    });

    if (this.isLocked) {
      contentEl.createEl('p', {
        text: 'The folder is currently locked. Enter your password to decrypt files and remove encryption.',
      });

      new Setting(contentEl).setName('Password').addText((text) => {
        text.setPlaceholder('Enter password').onChange((value) => {
          this.password = value;
        });
        text.inputEl.type = 'password';
        text.inputEl.focus();
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Remove Encryption')
          .setWarning()
          .onClick(async () => {
            if (this.isLocked && !this.password) {
              new Notice('Password is required.');
              return;
            }
            await this.onConfirm(this.password);
            this.close();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => {
          this.close();
        }),
      );

    if (this.isLocked) {
      contentEl.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          if (!this.password) {
            new Notice('Password is required.');
            return;
          }
          await this.onConfirm(this.password);
          this.close();
        }
      });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
