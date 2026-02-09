import { App, Modal, Setting } from 'obsidian';

export class ConfirmationModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private message: string,
    private onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', { text: this.message });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Confirm')
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => {
          this.close();
        }),
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
