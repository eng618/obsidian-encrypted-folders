# Settings reference

> Quadrant: **Reference**. Audience: users and contributors. All settings live in **Settings → Encrypted Folders** and support settings search.

| Key                      | Type              | Default     | Effect                                                                 |
| ------------------------ | ----------------- | ----------- | ---------------------------------------------------------------------- |
| `autoLockOnBackground`   | toggle            | `true`      | Locks all unlocked folders when Obsidian moves to the background.      |
| `autoLockIdleMinutes`    | number ≥ 0        | `5`         | Per-folder inactivity timeout in minutes. `0` disables.                |
| `autoLockWarningSeconds` | number ≥ 0        | `60`        | Advance notice before the next inactive folder locks. `0` disables.    |
| `maxPasswordAttempts`    | number ≥ 1        | `5`         | Failed attempts before exponential backoff applies.                    |
| `debugLogging`           | toggle            | `false`     | Emits `[EncryptedFolders]` console logs for sync and lock transitions. |
| `telemetryEnabled`       | toggle            | `true`      | Sends anonymous usage events; see [Telemetry](./telemetry.md).         |
| `telemetryId`            | string (managed)  | random UUID | Anonymous per-vault identifier, generated on first load.               |
| `telemetryNoticeSeen`    | boolean (managed) | `false`     | Tracks whether the first-run telemetry notice was shown.               |

Numeric inputs are clamped (`max` in `SettingsTab`, `sanitizeSettings` on load). For task-oriented guidance, see [Configure](../how-to/configure.md).
