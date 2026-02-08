# Encrypted Folders - Technical Walkthrough

This document provides a detailed overview of the plugin's features, security architecture, and how to verify its functionality.

## 🔑 Security Architecture

The plugin uses a **Master Key wrapping** strategy to ensure high security and flexibility.

1.  **Master Key**: A unique AES-256-GCM key is generated for every encrypted folder.
2.  **Password Wrapping**: The Master Key is encrypted with a key derived from your password using PBKDF2-SHA256 (600,000 iterations).
3.  **Recovery Wrapping**: The Master Key is also encrypted with a 32-character recovery key.
4.  **Data Encryption**: Your files are encrypted using the Master Key. This allows you to change your password in the future (planned feature) without re-encrypting every file.

## ✨ Key Features

### 1. Recursive Encryption

When you encrypt a folder, the plugin recursively visits every subfolder and file.

- It skips the `.obsidian-folder-meta` file which contains the encrypted keys.
- It uses a "Magic" header (`ENC!`) to distinguish encrypted files from plaintext.

### 2. Recovery Keys

During the first encryption of a folder, you are presented with a **Recovery Key**.

- This key acts as a "backdoor" that only you possess.
- If you forget your password, right-click the folder and choose **Unlock with Recovery Key**.

### 3. Secure File Shredding

To prevent forensic recovery of deleted or modified plaintext:

- When a file is modified (e.g., during re-locking), the plugin first overwrites the file's disk space with random data before writing the new content.
- This is implemented in `FileService.secureWrite`.

### 4. Auto-Lock on Exit

The plugin automatically locks all open folders when:

- You disable the plugin.
- You close the Obsidian application.
- This ensures no plaintext is left on disk when you are not actively using your vault.

## 🧪 Testing and Verification

You can verify the security and integrity of the plugin using the included test suite.

### Running Unit Tests

```bash
npm test
```

This runs tests for:

- Key derivation and encryption performance.
- Master key export/import logic.
- Error handling (verifying that incorrect passwords fail to decrypt).

### Manual Verification

1.  **Check for Plaintext**: Open your vault folder in a standard file explorer (like Finder or Windows Explorer) while the folder is **locked**. Try to open a `.md` file in Notepad; it should look like binary gibberish and start with `ENC!`.
2.  **Check Meta-Data**: Inspect the `.obsidian-folder-meta` file. It should contain base64 strings but **no secrets** in plaintext.
3.  **Audit the Build**: Run `npm run lint` and `npm run build` to ensure the code is clean and follows standards.

## ⚠️ Important Considerations

- **Obsidian Sync**: If you use Obsidian Sync, be aware that if you unlock a folder, the sync might start uploading plaintext to your other devices. It is recommended to **lock folders before syncing** or exclude them from sync.
- **Crashes**: In the event of a hard system crash (blue screen, power loss) while a folder is unlocked, the files may remain in plaintext. Always lock sensitive folders when you are done.
