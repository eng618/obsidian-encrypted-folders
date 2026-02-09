# Obsidian Encrypted Folders - Local Test Plan

This document outlines the procedures for testing the Encrypted Folders plugin locally within Obsidian.

## 🏗️ 1. Local Environment Setup

To test the plugin, you must link your development build to an Obsidian vault.

### Prerequisites

- [Obsidian](https://obsidian.md/) installed.
- A dedicated "Test Vault" created in Obsidian.

### Steps

1. **Identify Plugin Path**:
   Locate your test vault on your file system. The plugin directory is:
   `<VaultPath>/.obsidian/plugins/obsidian-encrypted-folders`
   _(Create the folder if it doesn't exist)_.

2. **Build the Plugin**:
   In your development directory, run:

   ```bash
   npm run build
   ```

3. **Symlink or Copy Files**:
   Link the build output to your vault. From your dev directory:

   ```bash
   ln -s $(pwd)/main.js <VaultPath>/.obsidian/plugins/obsidian-encrypted-folders/main.js
   ln -s $(pwd)/manifest.json <VaultPath>/.obsidian/plugins/obsidian-encrypted-folders/manifest.json
   ln -s $(pwd)/styles.css <VaultPath>/.obsidian/plugins/obsidian-encrypted-folders/styles.css
   ```

   _Note: On Windows, use `mklink` or manually copy the files._

4. **Enable Plugin**:
   - Open Obsidian -> Settings -> Community Plugins.
   - Turn off "Restricted Mode" if necessary.
   - Find **Encrypted Folders** and toggle it **ON**.

---

## 🔍 2. Sanity & Smoke Tests

Ensure the plugin core surface area is functional.

| ID  | Test Case      | Action                    | Expected Result                                                     |
| --- | -------------- | ------------------------- | ------------------------------------------------------------------- |
| S.1 | Plugin Load    | Enable plugin in settings | No console errors. Ribbon/Status bar icons appear (if implemented). |
| S.2 | Context Menu   | Right-click any folder    | "Encrypt Folder" option appears in the menu.                        |
| S.3 | Settings Panel | Open Plugin Settings      | All configuration options are visible and reachable.                |

---

## 🛠️ 3. Functional Test Cases

### Encryption & Locking

| ID  | Test Case          | Steps                                                | Expected Result                                                                               |
| --- | ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| F.1 | Initial Encryption | Right-click folder -> Encrypt. Enter password.       | Files are encrypted. `.obsidian-folder-meta` is created. Recovery key is displayed.           |
| F.2 | Lock Folder        | Right-click unlocked folder -> Lock.                 | Files convert to binary/ciphertext on disk. Folder remains in vault but files are unreadable. |
| F.3 | Unlock Folder      | Right-click locked folder -> Unlock. Enter password. | Files are restored to plaintext. Obsidian can index/search them again.                        |

### Recovery Mechanisms

| ID  | Test Case           | Steps                                                    | Expected Result                                                   |
| --- | ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| R.1 | Recovery Key Unlock | Right-click locked folder -> "Unlock with Recovery Key". | Folder unlocks successfully without using the master password.    |
| R.2 | Wrong Password      | Attempt unlock with incorrect password.                  | Error notification appears. Files remain encrypted. No data loss. |

---

## 🛡️ 4. Security & Integrity Verification

### Secure Shredding Check

1. Unlock a folder containing sensitive data.
2. Edit a file.
3. Lock the folder.
4. **Verification**: Use a disk hex editor or search for unique strings from the plaintext version in the raw disk sectors (advanced). Alternatively, verify that the file size matches the ciphertext structure, not the original plaintext.

### Session Security

1. Unlock several folders.
2. Disable the plugin or Close Obsidian.
3. **Verification**: Check the vault on disk using an external app (Notepad/VS Code). Verify that all folders have been re-locked and files start with `ENC!`.

---

## 📈 5. Integration Tests

- **Search**: Verify that global search works when a folder is **unlocked** and fails to find content when it is **locked**.
- **Graph View**: Verify that notes from an **unlocked** folder appear in the Graph, and disappear when **locked**.
- **Backlinks**: Verify that links to/from files in an **unlocked** folder are resolved correctly.

---

## 🚨 6. Edge Case Scenarios

- **Large Folders**: Test with a folder containing >100 files or files >50MB. Verify progress notices and performance.
- **Deep Nesting**: Test a folder structure 5+ levels deep. Ensure all sub-files are encrypted.
- **Special Characters**: Use folders/files with emojis or non-LATIN characters in names.
- **ReadOnly Files**: Attempt to encrypt a folder containing files without write permissions. Verify graceful error handling.
