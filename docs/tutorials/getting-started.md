# Getting started

> Quadrant: **Tutorial**. Audience: new users. Prerequisites: Obsidian installed, a vault with a folder you can experiment on.

By the end of this tutorial you will have encrypted a folder, locked and unlocked it, and saved a recovery key.

## 1. Install the plugin

1. In Obsidian, open **Settings → Community plugins** and enable community plugins if needed.
2. Search for **Encrypted Folders** and install it, then enable it.

## 2. Encrypt your first folder

1. In the file explorer, right-click any folder.
2. Select **Encrypt folder**.
3. Enter a strong password (minimum 8 characters). A strength indicator helps you judge it.
4. Read the disclosure notice: file **contents** are protected, but filenames, note titles, and directory structure are not.
5. Choose whether to **lock immediately**:
   - On: files are encrypted and hidden right away.
   - Off: the folder is initialized and stays usable until you lock it.
6. A **recovery key** appears. Copy it into a password manager and confirm you saved it before closing. This key is the only way back in if you forget your password.

## 3. Lock the folder

1. Right-click the unlocked folder and select **Lock folder**.
2. Files are replaced on disk with ciphertext named `[name].locked`, and a `README_ENCRYPTED.md` explains the folder is intentionally locked.

Verify it worked: open the folder in your system's file explorer. You should see `.locked` files containing binary data starting with `ENC!`.

## 4. Unlock the folder

1. Right-click the locked folder and select **Unlock folder**.
2. Enter your password. Files are restored to plaintext so Search, Graph view, and Backlinks work normally.
3. When finished, lock the folder again — or let auto-lock do it (see [Configure](../how-to/configure.md)).

## 5. If you forget your password

Use **Unlock with recovery key** and enter the recovery key from step 2. Full details: [Recover access](../how-to/recover-access.md).

## Where next

- [Configure](../how-to/configure.md) — auto-lock timers, password attempts, telemetry opt-out.
- [Threat model](../explanation/threat-model.md) — understand exactly what encryption does and does not protect.
