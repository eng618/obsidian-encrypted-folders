# Verify security manually

> Quadrant: **How-to**. Audience: contributors and security reviewers. Prerequisites: TestVault linked (see [Test locally](./test-locally.md)).

These procedures confirm on-disk guarantees with an external file explorer or hex editor. For the threat model behind them, see [Threat model](../explanation/threat-model.md).

## Ciphertext on disk

1. Lock a folder containing notes.
2. Open the vault in your system's file explorer (not Obsidian).
3. Verify files end in `.locked`, open one, and confirm it is binary data starting with `ENC!`.

## Metadata contains no secrets

1. Open the locked folder's `obsidian-folder-meta.json`.
2. Verify it contains only base64 strings, iteration counts, and state fields — no passwords, keys, or plaintext.

## Non-extractable session keys

1. Unlock an encrypted folder.
2. In Obsidian developer tools, inspect the plugin's `folderService` state.
3. Verify there is no accessor exposing raw key handles, and that any reachable `CryptoKey` has `extractable: false` (`exportKey('raw', key)` must throw).

## Metadata tamper rejection

1. Lock an encrypted folder.
2. Edit `obsidian-folder-meta.json` (e.g. change `iterations` from 600000 to 1000).
3. Attempt unlock with the correct password.
4. Verify unlock is refused — tampered parameters never reach decryption.

## Atomic staging writes

1. Lock a folder containing notes and watch for transient `.locked.tmp` staging files.
2. If staging is interrupted or corrupted, verify the original plaintext note remains fully intact and no incomplete `.locked` file is produced. The staging file is also removed when the final promotion fails.

## Partial decryption resilience

1. Lock a folder with multiple notes.
2. Corrupt the binary ciphertext of one `.locked` file on disk.
3. Unlock with your password.
4. Verify valid notes are restored, the corrupted file remains `.locked`, and the folder metadata records the partial failure.

## Session security

1. Unlock several folders.
2. Disable the plugin or close Obsidian.
3. Using an external app, verify all folders were re-locked: files have `.locked` extensions and start with `ENC!`.
