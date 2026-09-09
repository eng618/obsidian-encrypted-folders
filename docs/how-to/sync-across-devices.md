# Sync across devices

> Quadrant: **How-to**. Audience: users syncing a vault between devices (SyncTrain, Obsidian Sync, or equivalent). Prerequisites: same plugin version on all devices, **Sync diagnostics** enabled in settings.

## Recommended sync settings

- **Cadence**: auto-sync every 10–30 seconds, sync on app open and on resume, visible manual sync button. Short intervals reduce metadata/payload skew; resume sync matters most on iOS.
- **File handling**: preserve extensions, atomic replacement, temporary file cleanup, case-sensitive conflict handling. Encrypted payloads depend on stable `*.locked` naming and complete writes.
- **Conflicts**: keep both copies, never auto-delete; disable last-writer-wins overwrite; delay delete propagation. For encrypted folders, accidental overwrite or delete is worse than temporary duplicates.
- **Bandwidth**: low-to-medium parallelism (2–4), medium batches, exponential-backoff retries. Aggressive parallelism widens partial-propagation windows, especially on mobile.

## Safe operating workflow

1. Edit notes while the folder is unlocked on device A.
2. Lock the folder on device A.
3. Wait for sync to finish on device A.
4. Trigger or wait for sync on device B.
5. On device B, verify `*.locked` files exist before unlocking.
6. Unlock only after payload files are present — the plugin refuses unlock with a syncing message if encrypted files are still arriving.

## Validation matrix

| ID  | Scenario                    | Steps                                                       | Expected result                                                                                          |
| --- | --------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| X.1 | Lock on A, receive on B     | On A, edit a note, then lock. Wait for sync on B.           | On B the folder is recognized as encrypted: `.locked` files, `README_ENCRYPTED.md`, unlock menu actions. |
| X.2 | Unlock on A, B already open | Keep Obsidian open on B. On A, unlock. Wait for sync.       | On B the folder transitions cleanly; no duplicate plaintext/`.locked` pairs for the same note.           |
| X.3 | Mid-transition arrival      | Start lock/unlock on A and force B to sync mid-operation.   | On B, metadata reconciles to a stable state (`locked` or `unlocked`) without becoming unusable.          |
| X.4 | Delayed metadata arrival    | On B, open the vault before sync fully completes.           | Within the rescan window the folder appears correctly without restarting Obsidian.                       |
| X.5 | Wrong credential safety     | On B, unlock with a wrong password or recovery key.         | Unlock fails safely, files stay encrypted, subsequent correct unlock works.                              |
| X.6 | Restart recovery            | During active sync changes, close and reopen Obsidian on B. | Startup rescan reconciles to a consistent state; no permanently stuck transition.                        |

Pass when: no folder becomes permanently inaccessible; no sustained mixed state for the same note; menu actions match actual state after settle; restarts recover consistently.

## iOS-specific recommendations

- Keep Obsidian foregrounded during the first large lock sync.
- Disable low power mode during large transfers.
- Ensure the Files provider is fully online before unlocking.
- After a network interruption, run one manual sync before unlock attempts.

## If something looks wrong

Collect before retrying: `[EncryptedFolders]` console logs from both devices, the folder's `obsidian-folder-meta.json` before and after, and a file listing (`*.locked`, plaintext, `README_ENCRYPTED.md`). Then run a manual sync on both devices, **Rescan encrypted folders** from settings, and retry unlock. If unlock still reports syncing, wait for payload completion and retry.

For why the plugin behaves this way, see [Sync design](../explanation/sync-design.md).
