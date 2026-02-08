import { App, Modal, Setting } from 'obsidian';

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

    contentEl.createEl('h2', { text: 'Folder Encrypted Successfully!' });
    contentEl.createEl('p', {
      text: 'Please save this Recovery Key in a SAFE place. If you forget your password, this is the ONLY way to recover your data.',
      cls: 'mod-warning',
    });

    const keyContainer = contentEl.createEl('div', {
      cls: 'recovery-key-container',
      attr: {
        style:
          'padding: 15px; background: var(--background-secondary); border-radius: 4px; border: 1px solid var(--border-color); font-family: monospace; font-size: 1.2em; text-align: center; margin: 20px 0; user-select: all;',
      },
    });
    keyContainer.setText(this.recoveryKey);

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText('Copy to Clipboard').onClick(async () => {
          await navigator.clipboard.writeText(this.recoveryKey);
          btn.setButtonText('Copied!');
          setTimeout(() => btn.setButtonText('Copy to Clipboard'), 2000);
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Done')
          .setCta()
          .onClick(() => this.close()),
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
