# Threat model

> Quadrant: **Explanation**. Audience: users deciding what to trust the plugin with, and reviewers. Assumes a standard vault threat model: a local attacker with later disk access, honest sync/cloud transport.

## Protected

- **File contents at rest while locked**: AES-256-GCM ciphertext; tampered bytes fail authentication instead of decrypting to wrong plaintext.
- **Passwords and keys**: never stored; password guesses cost a 600,000-iteration KDF each plus backoff; session keys are non-extractable and purged on lock.
- **Metadata parameters**: HMAC-bound (iterations, salts, wrapped keys, test token) so disk-level tampering is detected before decryption.
- **Accidental corruption**: staging writes, size verification, truncation rejection, and per-file error isolation keep one bad file from destroying a folder.

## Explicitly not protected

- **Filenames, note titles, directory structure**: stored and synced in plaintext by design (stated pre-encryption and in the password dialog).
- **Unlocked plaintext**: while unlocked, files are real plaintext on disk for Search/Graph/Backlinks — a crash or shutdown mid-session can leave them so. Lock when done; auto-lock exists for exactly this.
- **Sync and trash copies**: sync services, file history, and trash may retain plaintext or ciphertext copies outside the plugin's control. Shredding is a best-effort local overwrite, not forensic erasure.
- **Lost credentials**: without password and recovery key, data is unrecoverable. There is no backdoor.
- **Huge files**: files over 64MB are refused rather than risking memory exhaustion; split them into smaller notes.
- **Malicious Obsidian or OS**: a compromised host, malicious plugin with vault access, or keylogger defeats any vault-level encryption.
