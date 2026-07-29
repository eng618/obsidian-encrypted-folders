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
    keyContainer.textContent = this.recoveryKey;

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText('Copy to clipboard').onClick(() => {
          void this.copyRecoveryKey(btn);
        });
      })
      .addButton((btn) => {
        btn.setButtonText('Download Backup (.txt)').onClick(() => {
          this.downloadRecoveryKey();
        });
      });

    let isConfirmed = false;
    let doneButton: ButtonComponent | null = null;

    new Setting(contentEl)
      .setName('I have saved my recovery key')
      .setDesc('Confirm you have copied or saved this key before closing')
      .addToggle((toggle) => {
        toggle.setValue(isConfirmed).onChange((value) => {
          isConfirmed = value;
          doneButton?.setDisabled(!isConfirmed);
        });
      });

    new Setting(contentEl).addButton((btn) => {
      doneButton = btn as unknown as ButtonComponent;
      btn
        .setButtonText('Done')
        .setCta()
        .setDisabled(true)
        .onClick(() => {
          if (isConfirmed) {
            this.close();
          }
        });
    });
  }

  private downloadRecoveryKey(): void {
    const text = `Obsidian Encrypted Folder Recovery Key\n--------------------------------------\nKey: ${this.recoveryKey}\nDate: ${new Date().toISOString()}\n\nKeep this key in a secure password manager.`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'obsidian-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async copyRecoveryKey(button: ButtonComponent): Promise<void> {
    await navigator.clipboard.writeText(this.recoveryKey);
    button.setButtonText('Copied!');
    window.setTimeout(() => {
      button.setButtonText('Copy to clipboard');
    }, 2000);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
