# Architecture

> Quadrant: **Reference**. Audience: contributors. Entry point: `main.ts` (~120 lines, lifecycle wiring only).

## Services (`src/services/`)

| Module                             | Owns                                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FolderService`                    | Encryption orchestration: create/unlock/lock/reprocess/remove, metadata transitions, auto-lock coordination, telemetry events. Accepts injected managers via `FolderServiceDeps`. Never exposes raw key handles. |
| `EncryptionService`                | Web Crypto primitives: PBKDF2 split-derivation, AES-GCM, HMAC, master-key generate/export/import, per-modal `KeyDerivationCache`.                                                                                |
| `MetadataManager`                  | Metadata schema v2: strict parse/validate, MAC compute/verify (constant-time), state transitions with capped errors.                                                                                             |
| `FileService`                      | Vault I/O seam: binary read/write, rename promotion, single-pass overwrite, shred-then-trash, file lookup and adapter listing.                                                                                   |
| `BatchProcessor`                   | Folder traversal, bounded-parallel execution (3 files / 64MB), progress reporting, abort handling. Takes protected filenames, not closures.                                                                      |
| `AutoLockManager`                  | Pure time math: per-folder activity timestamps, expiry, countdowns.                                                                                                                                              |
| `TelemetryService`                 | Anonymous OpenPanel ingest: allowlisted events, queue cap, timeout, secretless client-Id auth.                                                                                                                   |
| `LockedFolderReprocessCoordinator` | Debounced re-encryption prompts for plaintext landing in locked folders.                                                                                                                                         |

## UI (`src/ui/`) and events (`src/events/`)

| Module               | Owns                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `FolderMenuHandler`  | Context-menu factory for encrypt/unlock/recovery/remove, with per-modal derivation caches.             |
| `IdleLockController` | Status bar countdown, inactivity warnings, background/idle lock execution.                             |
| `ProcessingRunner`   | Blocking progress modal + abort wiring shared by long operations.                                      |
| `ExplorerIndicators` | Folder icon classes, coalesced via `scheduleExplorerIndicators`.                                       |
| `EventSubscriptions` | All vault/workspace/DOM subscriptions in one place.                                                    |
| Modals               | `PasswordModal` (backoff), `RecoveryKeyModal`, `RemovalModal` (typed confirmation), `ProcessingModal`. |

## Models and utils

- `src/models/Settings.ts` — settings shape, defaults, sanitization, telemetry-ID generation.
- `src/models/FolderState.ts` — metadata and lifecycle types.
- `src/utils/abort.ts` — single abort-error helpers.

## Key lifecycle

Master keys live only in `FolderService.unlockedFolders` as non-extractable handles: inserted on create/unlock, deleted on lock, remove, path update/removal, and lock-all. No accessor returns key material; callers use `isUnlocked()`.
