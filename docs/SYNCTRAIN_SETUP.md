# SyncTrain setup guide for Encrypted Folders

This guide describes a practical SyncTrain configuration for reliable lock/unlock behavior across desktop and mobile devices.

## Scope

- Works with the Encrypted Folders plugin in this repository.
- Focuses on Linux desktop + iOS mobile, but applies to any two-device setup.
- Assumes both devices sync the same vault folder.

## 1. Baseline requirements

1. Use the same plugin version on all devices.
2. Enable **Sync diagnostics** in Encrypted Folders settings on all devices.
3. Verify each encrypted folder contains:
   - `obsidian-folder-meta.json`
   - One or more `*.locked` files when locked
   - `README_ENCRYPTED.md` when locked
4. If a folder still uses `.obsidian-folder-meta`, migrate it first with:
   - **Migrate Folder Encryption Metadata** in the folder context menu.

## 2. Recommended SyncTrain settings

Use these as your default profile, then tune only if needed.

### Sync cadence

- `Auto sync interval`: 10-30 seconds
- `Sync on app open`: enabled
- `Sync on app resume`: enabled
- `Manual sync button`: enabled and visible

Why: shorter intervals reduce metadata/payload skew; resume sync is especially important on iOS.

### File handling

- `Preserve file extensions`: enabled
- `Atomic file replacement`: enabled (if available)
- `Temporary file cleanup`: enabled
- `Case-sensitive conflict handling`: enabled

Why: encrypted payloads depend on stable `*.locked` naming and complete writes.

### Conflict behavior

- `Conflict resolution`: keep both copies (never auto-delete)
- `Last-writer wins overwrite`: disabled
- `Delete propagation`: delayed or cautious mode (if available)

Why: for encrypted folders, accidental overwrite/delete is worse than temporary duplicates.

### Bandwidth and batching

- `Parallel uploads/downloads`: low to medium (2-4)
- `Batch size`: medium
- `Retry with exponential backoff`: enabled

Why: aggressive parallelism can increase partial propagation windows, especially on mobile.

## 3. Safe operating workflow

1. Edit notes while folder is unlocked on Device A.
2. Lock folder on Device A.
3. Wait for SyncTrain to finish on Device A.
4. Trigger or wait for sync on Device B.
5. On Device B, verify `*.locked` files exist before unlock.
6. Unlock only after payload files are present.

Note: Encrypted Folders now checks expected locked file count and fails unlock safely if encrypted payload files are still syncing.

## 4. iOS-specific recommendations

- Keep Obsidian foregrounded during first large lock sync.
- Disable low power mode during large transfers.
- Ensure iCloud/Files provider is fully online before unlocking.
- After network interruption, run one manual sync before unlock attempts.

## 5. Validation checklist

Run this after initial setup:

1. Lock on desktop, sync, then open mobile.
2. Confirm folder shows as encrypted and includes `*.locked` files.
3. Attempt unlock with correct password.
4. Re-lock on mobile, sync back to desktop.
5. Confirm no mixed state remains after settle:
   - No stale plaintext + `.locked` duplicate for same note.

## 6. If something looks wrong

Collect the following before retrying:

- `[EncryptedFolders]` logs from both devices
- `obsidian-folder-meta.json` before/after
- File listing of folder contents (`*.locked`, plaintext files, `README_ENCRYPTED.md`)

Then run:

1. Manual SyncTrain sync on both devices.
2. **Rescan encrypted folders** from plugin settings.
3. Retry unlock.

If unlock still fails with a syncing-related message, wait for payload file sync completion and retry.
