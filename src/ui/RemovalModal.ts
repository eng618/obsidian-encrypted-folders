import { App, Modal, Notice, Setting } from 'obsidian';
import { addPasswordToggle } from './UIUtils';

export class RemovalModal extends Modal {
  private password = '';
  private confirmationText = '';

  constructor(
    app: App,
    private isLocked: boolean,
    private folderName: string,
    private onConfirm: (password?: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName('Remove encryption').setHeading();

    contentEl.createEl('p', {
      text: 'This will permanently remove encryption from this folder and restore it to a normal folder. This action cannot be undone.',
      cls: 'mod-warning',
    });

    if (this.isLocked) {
      contentEl.createEl('p', {
        text: 'The folder is currently locked. Enter your password to decrypt files and remove encryption.',
      });

      const passwordSetting = new Setting(contentEl).setName('Password');
      passwordSetting.addText((text) => {
        text.setPlaceholder('Enter password').onChange((value) => {
          this.password = value;
        });
        text.inputEl.type = 'password';
        text.inputEl.focus();
        addPasswordToggle(passwordSetting, text);
      });
    }

    contentEl.createEl('p', {
      text: `To confirm, please type the folder name: ${this.folderName}`,
      cls: 'mod-muted',
    });

    const confirmSetting = new Setting(contentEl).setName('Confirmation');
    confirmSetting.addText((text) => {
      text.setPlaceholder(this.folderName).onChange((value) => {
        this.confirmationText = value;
      });
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Remove encryption')
          .setDestructive()
          .onClick(() => {
            void this.confirmRemoval();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => {
          this.close();
        }),
      );

    if (this.isLocked) {
      contentEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          void this.confirmRemoval();
        }
      });
    }
  }

  private async confirmRemoval(): Promise<void> {
    if (this.confirmationText !== this.folderName) {
      new Notice('Confirmation text does not match folder name.');
      return;
    }

    if (this.isLocked && !this.password) {
      new Notice('Password is required.');
      return;
    }

    await this.onConfirm(this.password);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
