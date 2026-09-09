# Design decisions

> Quadrant: **Explanation**. Audience: contributors and reviewers. For exact parameters, see [Security spec](../reference/security-spec.md).

## Master-key wrapping

Each folder gets its own AES-256-GCM master key, wrapped separately under the password-derived and recovery-derived keys. Files encrypt directly with the master key, so a future password change only re-wraps one small blob instead of re-encrypting every file. The recovery key is a second wrap, not a backdoor in the cipher.

## Single-PBKDF2 split derivation

Password verification needs two keys (AES unwrap + HMAC check). Deriving each with its own 600,000-iteration PBKDF2 doubled unlock latency, so one PBKDF2 produces 512 bits split into the two domain-separated keys. Per-modal retry caches skip re-derivation for repeated identical secrets and are cleared on modal close to bound key-material lifetime.

## Staging plus rename promotion

Encrypting writes ciphertext to `[name].locked.tmp`, verifies it, then promotes by vault rename rather than a second full write. This keeps crash atomicity (the original is untouched until promotion, staging is cleaned on all paths including failure) while cutting per-file I/O from 2 reads + 3 writes to 1 read + 2 writes. Verification is a size check rather than a full read-back for the same reason.

## Fail-closed metadata

Metadata is untrusted disk input: it is strictly validated (shape, enums, iteration floor, schema ceiling) and unknown future schemas are rejected rather than migrated blindly. Missing MACs fall back to legacy verification only because the wrapped-key and test-token decrypts still genuinely authenticate the password — and a successful unlock migrates the MAC forward. MAC comparison is constant-time.

## Constant-time comparisons

Both MAC verification and derivation-cache salt matching use bitwise-accumulated equality to avoid leaking prefix information through early exit.

## Coarse, opt-out telemetry

Usage events use bucketed counts and enums, never paths or contents; names are allowlisted and networking is best-effort. Opt-out (rather than opt-in) was chosen for adoption signal, balanced by a first-run notice, a searchable settings toggle, and README disclosure.

## Honest shredding

The "secure shred" is a single best-effort overwrite: the vault API replaces whole-file content (no offset writes), rapid multi-pass writes have corrupted files in some Obsidian builds, and sync copies plus trash history are outside any overwrite's reach. Docs and code say exactly this instead of promising forensic resistance.
