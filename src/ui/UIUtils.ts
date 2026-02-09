import { Setting, TextComponent } from 'obsidian';

/**
 * Adds a password visibility toggle button to a Setting component.
 *
 * @param setting The Setting component to add the button to.
 * @param textComponent The TextComponent (input) to toggle.
 */
export function addPasswordToggle(setting: Setting, textComponent: TextComponent) {
  setting.addExtraButton((btn) => {
    btn
      .setIcon('eye')
      .setTooltip('Show password')
      .onClick(() => {
        const inputEl = textComponent.inputEl;
        if (inputEl.type === 'password') {
          inputEl.type = 'text';
          btn.setIcon('eye-off').setTooltip('Hide password');
        } else {
          inputEl.type = 'password';
          btn.setIcon('eye').setTooltip('Show password');
        }
      });
  });
}
