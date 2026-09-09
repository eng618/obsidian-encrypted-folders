# Telemetry

> Quadrant: **Reference**. Audience: users and contributors. Opt out anytime in **Settings → Encrypted Folders → Anonymous usage telemetry**.

## What and where

Events are sent to a self-hosted OpenPanel instance via its public (secretless) ingest: `POST {apiUrl}/track` with the project `clientId` header. No client secret is embedded in the plugin. Networking uses Obsidian's `requestUrl`, is fire-and-forget with a 5-second timeout and a 20-event queue cap, and can never break encryption flows.

## Identity

A random per-vault UUID (`telemetryId`), generated on first load. No account, email, or identifying information. No `identify()` calls with personal data.

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
