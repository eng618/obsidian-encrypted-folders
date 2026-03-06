# Obsidian Encrypted Folders - Local Test Plan

This document outlines the procedures for testing the Encrypted Folders plugin locally within Obsidian.

## 🏗️ 1. Local Environment Setup

To test the plugin, you must link your development build to an Obsidian vault.

### Prerequisites

- [Obsidian](https://obsidian.md/) installed.
- **TestVault**: A pre-configured test vault is included in this repository.

### Initial Setup (Project-specific)

1. **Build the Plugin**:

   ```bash
   npm run build
   ```

2. **Setup Symlinks**:
   Run the following to link the plugin into the project's own `TestVault`:

   ```bash
   mkdir -p TestVault/.obsidian/plugins/obsidian-encrypted-folders
   ln -sf $(pwd)/dist/main.js TestVault/.obsidian/plugins/obsidian-encrypted-folders/main.js
   ln -sf $(pwd)/manifest.json TestVault/.obsidian/plugins/obsidian-encrypted-folders/manifest.json
   ln -sf $(pwd)/dist/styles.css TestVault/.obsidian/plugins/obsidian-encrypted-folders/styles.css
   ```

3. **Enable Plugin**:
   - Open Obsidian and select **"Open folder as vault"**.
   - Choose the `TestVault` directory in this project root.
   - Go to **Settings** > **Community Plugins** > find **Encrypted Folders** and toggle **ON**.

### 🔄 Resetting the Test Vault

If you want to clear all encryptions and return `TestVault` to its clean state (plaintext):

1. **Revert Git Changes**:

   ```bash
   git checkout TestVault/
   ```

2. **Remove Metadata**:
   Encrypted folders use `obsidian-folder-meta.json`. To delete them and clean up `.locked` files:

   ```bash
   find TestVault -name "obsidian-folder-meta.json" -delete
   find TestVault -name "*.locked" -delete
   find TestVault -name "README_ENCRYPTED.md" -delete
   ```

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

| ID  | Test Case          | Steps                                                | Expected Result                                                                                                             |
| --- | ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| F.1 | Initial Encryption | Right-click folder -> Encrypt. Enter password.       | Files are encrypted. `obsidian-folder-meta.json` is created. Recovery key is displayed.                                     |
| F.2 | Lock Folder        | Right-click unlocked folder -> Lock.                 | Files are encrypted and renamed to `.locked`. `README_ENCRYPTED.md` is created. Original filenames are hidden.              |
| F.3 | Unlock Folder      | Right-click locked folder -> Unlock. Enter password. | Files are restored to original names and plaintext. `README_ENCRYPTED.md` is deleted. Obsidian can index/search them again. |

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
3. **Verification**: Check the vault on disk using an external app (Notepad/VS Code). Verify that all folders have been re-locked, files have `.locked` extensions, and start with `ENC!`.

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

---

## 🔄 7. Two-device SyncTrain checklist

Use this section to validate cross-device behavior with SyncTrain (or equivalent sync tooling).

### Preconditions

- Device A and Device B point to the same synced vault.
- Plugin version is identical on both devices.
- In plugin settings, enable **Sync diagnostics** on both devices.
- Start with one test folder, for example `Sync Cases/Secret`, containing 2-3 markdown files.

### Matrix

| ID  | Scenario                    | Steps                                                                                 | Expected Result                                                                                                                              |
| --- | --------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| X.1 | Lock on A, receive on B     | On A, unlock folder if needed, edit a note, then **Lock Folder**. Wait for sync on B. | On B, folder remains recognized as encrypted, files end with `.locked`, `README_ENCRYPTED.md` exists, menu shows unlock actions.             |
| X.2 | Unlock on A, B already open | Keep Obsidian open on B. On A, **Unlock Folder**. Wait for sync.                      | On B, folder transitions cleanly; no duplicate plaintext/locked pairs for the same note. If left unlocked, plaintext visibility is expected. |
| X.3 | Mid-transition arrival      | Start lock/unlock on A and force B sync while operation is still propagating.         | On B, metadata state reconciles to a stable state (`locked` or `unlocked`) without becoming unusable.                                        |
| X.4 | Delayed metadata arrival    | On B, open vault before sync fully completes after A changes folder state.            | Within rescan/retry window, encrypted folder appears correctly in context menu without restarting Obsidian.                                  |
| X.5 | Wrong credential safety     | On B, attempt unlock with wrong password or recovery key.                             | Unlock fails safely, files remain encrypted, metadata persists, subsequent correct unlock works.                                             |
| X.6 | Restart recovery            | During active sync changes, close/reopen Obsidian on B.                               | Plugin rescans and reconciles encrypted folders on startup; no permanent stuck transition state.                                             |

### Legacy migration check

1. Prepare a folder containing only `.obsidian-folder-meta` (no `obsidian-folder-meta.json`).
2. Right-click folder and run **Migrate Folder Encryption Metadata**.
3. Attempt unlock.

Expected:

- Migration succeeds.
- Old metadata file is removed.
- `obsidian-folder-meta.json` is present.
- Unlock works using normal password/recovery flow.

### Pass/Fail criteria

Pass when all are true:

- No folder becomes permanently inaccessible after sync.
- No sustained mixed state for the same note (both plaintext and `.locked` copies lingering after settle).
- Folder menu actions match actual state on both devices after sync settles.
- Restarting Obsidian on either device recovers to a consistent encrypted-folder state.

### Debug evidence to capture on failures

- Console logs containing `[EncryptedFolders]` from both devices.
- The affected folder's `obsidian-folder-meta.json` contents before and after failure.
- File listing of that folder (`*.locked`, plaintext files, `README_ENCRYPTED.md`) on both devices.
