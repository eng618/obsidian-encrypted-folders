# Obsidian Encrypted Folders
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Feng618%2Fobsidian-encrypted-folders.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Feng618%2Fobsidian-encrypted-folders?ref=badge_shield)


A secure, recursive folder encryption plugin for Obsidian. Protect entire directories within your vault with industrial-grade encryption while maintaining full compatibility with Obsidian features like Search and Graph while unlocked.

## ✨ Features

- **Recursive Encryption**: Encrypt entire folder trees (including nested subfolders) with a single click.
- **Session Decryption**: Temporarily restores plaintext to disk for seamless use with Obsidian Search, Graph view, and Backlinks while unlocked.
- **Improved Data Integrity**: Encrypted files use a `.locked` extension, preventing Obsidian's indexer or third-party plugins from corrupting binary data by attempting "UTF-8 repairs."
- **Informational Readme**: Automatically generates a `README_ENCRYPTED.md` in locked folders with clear instructions on how to unlock your data.
- **Master Key Architecture**: Uses an encrypted Master Key (unwrapped by your password or a recovery key) for flexible access.
- **Recovery Keys**: Generate a 32-character recovery key during setup to ensure you never lose access to your data.
- **Secure File Shredding**: Automatically overwrites plaintext files with secure random data before re-encrypting to prevent forensic disk recovery.
- **Auto-Lock Security**: All folders are automatically re-encrypted and locked when the plugin is disabled or Obsidian is closed.
- **Exit Strategy**: Permanently remove encryption from a folder if you no longer need it, restoring files to normal plaintext Obsidian management.
- **Integrity First**: Prevents nested encryption within already encrypted folders to ensure a simple, reliable vault structure.

## 🛡️ Security Specifications

- **Algorithm**: AES-256-GCM (Authenticated Encryption with Associated Data).
- **Key Derivation**: PBKDF2-SHA256 with **600,000 iterations**.
- **Implementation**: Native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) for maximum speed and security.
- **Zero-Knowledge**: Your master password and derived keys are never stored on disk.

## 🚀 How to Use

### Encrypting a Folder

1. Right-click any folder in the Obsidian File Explorer.
2. Select **Encrypt Folder**.
3. Set a strong password.
4. **IMPORTANT**: Copy the generated **Recovery Key** and store it in a safe place (like a password manager).

### Unlocking a Folder

1. Right-click an encrypted folder.
2. Select **Unlock Folder** and enter your password.
3. Your files will be restored to plaintext on disk. They will be re-encrypted automatically when you "Lock" the folder or close Obsidian.

### Locking a Folder

1. Right-click an unlocked folder.
2. Select **Lock Folder**.
3. The plugin will securely overwrite the content on disk with ciphertext, rename files to `[name].locked`, and create a `README_ENCRYPTED.md` with instructions.
4. The key is purged from memory for maximum security.

### Removing Encryption Permanently

1. Right-click an encrypted folder.
2. Select **Permanently Decrypt Folder**.
3. If the folder is locked, enter your password to restore files.
4. Confirm the permanent removal.
5. The plugin will restore all files to plaintext and delete the encryption metadata files (`obsidian-folder-meta.json` and `README_ENCRYPTED.md`).

## 🛠️ Development

### Prerequisites

- NodeJS (v22+)
- NPM or Yarn

### Install Dependencies

```bash
npm install
```

### Build & Dev

```bash
npm run dev   # Watch mode
npm run build # Production build
npm run lint  # Linting and type checking
```

## 📚 Documentation

- [Technical Walkthrough](./docs/WALKTHROUGH.md) - Deep dive into how it works.
- [Development Plan](./docs/DEVELOPMENT_PLAN.md) - Roadmap and project status.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License. See `LICENSE` for details.


[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Feng618%2Fobsidian-encrypted-folders.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Feng618%2Fobsidian-encrypted-folders?ref=badge_large)

## 🤝 Author

**Eric N. Garcia** - [eng618@garciaericn.com](mailto:eng618@garciaericn.com)