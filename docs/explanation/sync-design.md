# Sync design

> Quadrant: **Explanation**. Audience: contributors and sync troubleshooters. For the user workflow, see [Sync across devices](../how-to/sync-across-devices.md).

## The problem

Two devices share a vault through a sync layer with delay. Lock/unlock rewrites many files plus metadata; if device B reads mid-transition it can see half-plaintext/half-ciphertext plus a stale state marker.

## Mechanisms

- **Journaled states**: metadata carries `locking`, `locked`, `unlocking`, `unlocked`, `error` with `lastTransitionAt`. A device arriving mid-transition reconciles to a stable state instead of trusting file presence alone.
- **Expected-count gate**: locking records how many `.locked` files should exist; unlocking refuses while fewer are present, failing safe during slow payload sync.
- **Rescan strategy**: the encrypted-folder set derives from the vault index (one `getFiles()` pass); the expensive adapter tree-walk runs only on structural events, manual rescan, empty results, or 60-second staleness. Content edits never trigger scans; structural debouncing sits at 1 second.
- **Memoized parent lookups**: encrypted-parent walks are cached by path and invalidated on any structural event, keeping per-keystroke activity tracking O(1).
- **Reconciliation on events**: create/modify/rename trigger state reconciliation for the affected folder; startup performs a full sync with retries.

## Trade-offs accepted

- Plaintext intentionally syncs while a folder is unlocked — locking is the sync-safety boundary, and background auto-lock defaults to on.
- Partial decryption resolves best-effort (valid files restored, failures recorded on the unlocked state) rather than all-or-nothing, so one corrupt file cannot wedge a folder; retry makes progress.
- Delete propagation is left cautious (keep-both) in recommended sync settings because auto-deleting ciphertext is worse than duplicates.
