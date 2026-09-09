# Security spec

> Quadrant: **Reference**. Audience: security reviewers and contributors. This page states exact parameters — for rationale, see [Design decisions](../explanation/design-decisions.md).

## Algorithms

| Item               | Value                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Data encryption    | AES-256-GCM (authenticated, 128-bit tag)                                                                      |
| Key derivation     | PBKDF2-SHA256, **600,000 iterations**                                                                         |
| KDF output split   | 512-bit `deriveBits`, first 256 bits → AES-GCM wrapping key, last 256 bits → HMAC key (one PBKDF2 per secret) |
| Metadata integrity | HMAC-SHA256 over `id:version:salt:iterations:wrappedMasterKey:testToken`, constant-time compared              |
| Implementation     | Native Web Crypto API; no vendored crypto                                                                     |

## Key hierarchy

1. Per-folder **master key** (AES-256-GCM, generated per folder, non-extractable in memory).
2. Master key wrapped once under the password-derived key and once under the recovery-key-derived key.
3. Files encrypted directly with the master key; password changes would only re-wrap (rotation UI not yet provided).
4. Password verification: HMAC check, then wrapped-key decrypt, then known-token (`OBSIDIAN_ENCRYPTED_VERIFICATION`) decrypt.

## On-disk formats

- **Ciphertext files**: `[name].locked` containing `ENC!` (4 bytes) + IV (12 bytes) + AES-GCM ciphertext. Files shorter than 16 bytes are rejected as truncated.
- **Staging**: encrypted bytes are written to `[name].locked.tmp`, size-verified, then promoted by vault rename; the staging file is deleted on all paths including failure.
- **Metadata**: `obsidian-folder-meta.json`, schema version 2. Required fields: `id`, `version`, `salt`, `iterations` (≥ 600000), `wrappedMasterKey`, `masterKeyIV`, `testToken`, `lockFile`. Optional: recovery fields, `expectedLockedFiles`, `mac`/`recoveryMac`, lifecycle `state` (`locked`, `unlocked`, `locking`, `unlocking`, `error`), `lastTransitionAt`, `lastError` (capped at 500 chars). Unknown future `schemaVersion` values are rejected.
- **Marker**: `README_ENCRYPTED.md` is generated in locked folders with unlock instructions.

## Limits

- Per-file processing cap: 64MB (larger files are refused with a message; peak transient memory is ~3–4× file size).
- Batch processing: max 3 concurrent files, 64MB concurrent-bytes budget.
- Password entry: exponential backoff after the configured max attempts (default 5).
