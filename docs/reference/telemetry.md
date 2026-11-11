# Telemetry

> Quadrant: **Reference**. Audience: users and contributors. Opt out anytime in **Settings → Encrypted Folders → Anonymous usage telemetry**.

## What and where

Events are sent to a self-hosted OpenPanel instance: `POST https://openpanel.gventureshq.com/api/track`. This host accepts a track call when both the project client id and client secret are present. A secretless post is rejected by the gateway and never stored.

Those credentials are injected at build time from `OPENPANEL_CLIENT_ID` and `OPENPANEL_CLIENT_SECRET`. They are not committed. A build with either value missing sends nothing. The release workflow passes the same names from GitHub Actions secrets, so the published `main.js` contains the project secret. That secret identifies the analytics project. It is not a user credential.

Networking uses Obsidian's `requestUrl`, is fire-and-forget, retries once on HTTP 502, 503, or 504, and caps the queue at 20 events. It can never break encryption flows. Each event also sends `__os`, `__device`, and a coarse `__identify` so OpenPanel opens a client session and a profile. The plugin sets `User-Agent` to `encrypted-folders/<version> (<os>; obsidian)`.

Look for events under **Events** and **Profiles**, or on a custom dashboard. The default Overview chart counts website pageviews and stays empty for these custom events.

## Identity

A random per-vault UUID (`telemetryId`), generated on first load. No account, email, or identifying information. The track payload's `__identify` carries only plugin version, OS, and platform for that same id.

## Event catalog

| Event                               | Properties                                                         |
| ----------------------------------- | ------------------------------------------------------------------ |
| `plugin_loaded` / `plugin_unloaded` | `plugin_version`, `platform` (`desktop`/`mobile`)                  |
| `folder_encrypted`                  | `lock_immediately` (bool), `file_count_bucket`                     |
| `folder_unlocked`                   | `via` (`password`/`recovery`), `success` (bool)                    |
| `folder_locked`                     | `via` (`manual`/`background`/`idle`/`unload`), `file_count_bucket` |
| `auto_lock_triggered`               | `via` (`background`/`idle`), `folder_count_bucket`                 |
| `encryption_removed`                | (globals only)                                                     |
| `error`                             | `area` (currently `metadata` for corrupt-metadata refusal)         |

Counts are bucketed (`1-10`, `11-100`, `100+`). The service allowlists event names and rejects anything else.

## Never collected

Vault paths, folder names, filenames, file contents, passwords, recovery keys, encryption keys, or anything identifying. A test (`TelemetryService.test.ts`) scans payloads for these classes.

## Disclosures

- A first-run notice in Obsidian and the README privacy section both state that anonymous telemetry is collected and how to opt out.
- The Obsidian plugin scorecard lists a Network Requests disclosure for event ingestion, which is expected and informational.
