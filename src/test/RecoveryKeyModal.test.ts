import { App } from 'obsidian';
import { RecoveryKeyModal } from '../ui/RecoveryKeyModal';

describe('RecoveryKeyModal', () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  test('should render recovery key and copy/download controls', () => {
    const modal = new RecoveryKeyModal(app, 'KEY-1234-5678');
    modal.onOpen();

    const keyContainer = modal.contentEl.querySelector('.recovery-key-container');
    expect(keyContainer?.textContent).toBe('KEY-1234-5678');

    const buttons = Array.from(modal.contentEl.querySelectorAll('button'));
    const buttonTexts = buttons.map((b) => b.textContent);

    expect(buttonTexts).toContain('Copy to clipboard');
    expect(buttonTexts).toContain('Download Backup (.txt)');
  });
});
