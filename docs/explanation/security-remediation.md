# Security remediation

> Quadrant: **Explanation**. Audience: contributors continuing the review. This is the working record of the security and performance review. Behavior that has shipped is specified in the [Security spec](../reference/security-spec.md); this page tracks what changed and what is still open.

Reviewed the plugin against [Threat model](./threat-model.md) and [Security spec](../reference/security-spec.md). The cipher choices (AES-256-GCM, PBKDF2-SHA256 at 600,000 iterations, non-extractable session keys, split KDF) hold. The open items below are integrity, availability, and cost.

## Done

- **Removal keeps the wrapped key.** `removeEncryption` deletes `obsidian-folder-meta.json` only when the folder has no `.locked` files. A partial unlock used to return success, and removal then deleted the only copy of the folder key.
- **Master-password rotation is rollback-safe.** The new wrapping key is derived once. Each master folder keeps its previous password wrap until `data.json` saves the new verifier under that salt. A failed folder write or a failed settings save restores the in-memory snapshot and leaves the master record unchanged. After a committed save, previous wraps are removed; if that cleanup write fails, the next `syncFolders` removes them once the folder salt matches the saved record. Until cleanup, unlock accepts the previous wrap, so the old password still opens the folder across a crash in the middle of rotation.

## Open

### Security

- **Metadata MAC is narrower than the threat model.** The HMAC covers `id:version:salt:iterations:wrappedMasterKey:testToken` only. `masterKeyIV`, recovery wraps, `passwordKind`, `passwordLabel`, and `expectedLockedFiles` are unauthenticated. A missing `mac` is still treated as legacy-valid. `docs/how-to/verify-security.md` describes tamper rejection more broadly than the MAC input.
- **File ciphertext is not bound to the file.** Same folder key, no additional data. Swapping two intact `.locked` files (or restoring an older sync copy) decrypts as the other note.
- **`encryptFile` skips bodies that already start with `ENC!`.** Lock can finish and leave that plaintext in place.
- **Decrypt deletes the `.locked` file after an unchecked plaintext write.** Encrypt's size check does not read the staged bytes back before shredding.
- **`onunload` does not wait for lock.** `main.ts` fires `lockAllFolders` and returns. The README and `docs/how-to/verify-security.md` say disabling the plugin re-locks every folder. Obsidian's unload hook is synchronous, so that guarantee is not enforced.
- **Master-recovery auto-detect skips the test token and `masterRecoveryMac`.** On failure it can leave metadata in `unlocking`.
- **Password backoff resets when the modal closes.** The KDF is the real limit. Submit also has no in-flight guard, so a repeated Enter can overlap two unlocks.
- **A sync-incomplete unlock is reported as a wrong password** and is written as metadata state `error`. `docs/how-to/recover-access.md` says a failed attempt modifies nothing on disk. That sentence is ahead of the code: unlock writes `unlocking` before the password is checked. Fix the write order before changing the how-to.
- **Recovery-key alphabet uses `byte % 56`.** Bias is small; the key stays well above 128 bits. Use rejection sampling.
- **Master-password record does not enforce the iteration floor and has no MAC.** Derivation ignores the stored count today. Enforce the floor before any caller starts trusting `record.iterations`.
- **Telemetry is on by default.** Payloads are allowlisted, and a stable id plus unlock/lock times go to the configured OpenPanel host.

### Performance

- **Encrypting with the master password derives the same key three times** (`verifyMasterPassword`, then `unwrapMasterRecoveryKey`, which verifies again).
- **A failed master unlock pays a second KDF** for the recovery salt on every attempt.
- **Every note edit in an encrypted folder re-reads metadata** via `reconcileFolderState` on `modify`.
- **The 64MB concurrency budget counts file size, not the 3–4× peak** (plaintext, ciphertext, staging buffer, shred buffer).
- **A full adapter walk still runs at least every 60 seconds.**

## Doc drift to fix with the matching code change

- `docs/how-to/recover-access.md` "Wrong password" claims a failed attempt does not touch disk.
- `docs/how-to/verify-security.md` session check assumes unload finishes locking.
- README "Auto-Lock Security" and "Metadata Integrity" describe those two guarantees more broadly than the implementation.
