import { App, ButtonComponent, Modal, Setting } from 'obsidian';

export class RecoveryKeyModal extends Modal {
  constructor(
    app: App,
    private recoveryKey: string,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName('Folder encrypted successfully').setHeading();
    contentEl.createEl('p', {
      text: 'Please save this recovery key in a safe place. If you forget your password, this is the only way to recover your data.',
      cls: 'mod-warning',
    });

    const keyContainer = contentEl.createEl('div', {
      cls: 'recovery-key-container',
    });
    keyContainer.setText(this.recoveryKey);

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText('Copy to clipboard').onClick(() => {
          void this.copyRecoveryKey(btn);
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Done')
          .setCta()
          .onClick(() => this.close()),
      );
  }

  private async copyRecoveryKey(button: ButtonComponent): Promise<void> {
    await navigator.clipboard.writeText(this.recoveryKey);
    button.setButtonText('Copied!');
    window.setTimeout(() => button.setButtonText('Copy to clipboard'), 2000);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
