# Configure

> Quadrant: **How-to**. Audience: users. Prerequisites: plugin installed. All settings live in **Settings → Encrypted Folders** and are searchable.

## Security actions

- **Lock all folders** — immediately re-encrypts every unlocked folder and clears keys from memory.
- **Active session** — lists folders currently unlocked in this session (informational).
- **Rescan encrypted folders** — forces a vault-wide scan. Use after sync or migration events.

## Auto-lock behavior

- **Lock on background** (default on) — locks everything when Obsidian moves to the background. Recommended on mobile and for sync safety.
- **Lock after inactivity** (default 5 minutes) — locks each folder after that many minutes without activity in it. Opening, editing, or working with files inside refreshes the timer. Set to `0` to disable.
- **Warn before inactivity lock** (default 60 seconds) — shows a notice this long before the next inactive folder locks, and the status bar counts down. Set to `0` to disable.

## Passwords

- **Max password attempts** (default 5) — failed attempts beyond this trigger exponential backoff before retrying.

## Diagnostics

- **Sync diagnostics** — enables `[EncryptedFolders]` debug logs for sync detection, migration, and lock transitions. Turn on when reporting sync issues, off otherwise.

## Telemetry

- **Anonymous usage telemetry** (default on) — sends anonymous usage events to help improve the plugin. No vault paths, filenames, passwords, keys, or contents are ever collected. See [Telemetry](../reference/telemetry.md). Turn it off here to opt out; the README privacy section documents the same.

For exact defaults and value types, see [Settings reference](../reference/settings.md).
