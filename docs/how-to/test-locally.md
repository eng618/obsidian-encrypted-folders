# Test locally

> Quadrant: **How-to**. Audience: contributors. Prerequisites: `bun` installed, dependencies installed (`bun install`).

## 1. Build and link into the TestVault

```bash
bun run build
```

The build copies `dist/main.js`, `manifest.json`, and `styles.css` into `TestVault/.obsidian/plugins/obsidian-encrypted-folders/` automatically.

Open Obsidian, choose **Open folder as vault**, select the `TestVault` directory, then enable **Encrypted Folders** under **Settings → Community plugins**.

## 2. Reset the TestVault

To return the vault to clean plaintext:

```bash
git checkout TestVault/
find TestVault -name "obsidian-folder-meta.json" -delete
find TestVault -name "*.locked" -delete
find TestVault -name "README_ENCRYPTED.md" -delete
```

## 3. Smoke tests

| ID  | Test case      | Action                    | Expected result                                       |
| --- | -------------- | ------------------------- | ----------------------------------------------------- |
| S.1 | Plugin load    | Enable plugin in settings | No console errors; idle-lock status bar item appears. |
| S.2 | Context menu   | Right-click any folder    | An **Encrypt folder** option appears in the menu.     |
| S.3 | Settings panel | Open plugin settings      | All configuration options are visible and searchable. |

## 4. Functional tests

### Encryption and locking

| ID  | Test case          | Steps                                               | Expected result                                                                         |
| --- | ------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F.1 | Initial encryption | Right-click folder → Encrypt. Enter password.       | Files are encrypted. `obsidian-folder-meta.json` is created. Recovery key is displayed. |
| F.2 | Lock folder        | Right-click unlocked folder → Lock.                 | Files are encrypted and renamed to `.locked`. `README_ENCRYPTED.md` is created.         |
| F.3 | Unlock folder      | Right-click locked folder → Unlock. Enter password. | Files are restored to plaintext. `README_ENCRYPTED.md` is deleted. Search works again.  |

### Recovery

| ID  | Test case           | Steps                                                 | Expected result                                                   |
| --- | ------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| R.1 | Recovery key unlock | Right-click locked folder → Unlock with recovery key. | Folder unlocks without the master password.                       |
| R.2 | Wrong password      | Attempt unlock with an incorrect password.            | Error notification appears. Files remain encrypted. No data loss. |

## 5. Integration checks

- **Search**: global search finds content when a folder is **unlocked**, not when **locked**.
- **Graph view**: notes from an **unlocked** folder appear in the Graph, and disappear when **locked**.
- **Backlinks**: links to and from files in an **unlocked** folder resolve correctly.

## 6. Edge cases

- **Large folders**: a folder with 100+ files, or files approaching the 64MB per-file limit (larger files are refused with a clear message).
- **Deep nesting**: structures 5+ levels deep; all sub-files must encrypt.
- **Special characters**: folder and file names with emojis or non-Latin characters.
- **Read-only files**: encrypting a folder containing files without write permissions must fail gracefully.

## 7. Automated tests

```bash
bun run test          # unit + integration suite (Vitest)
bun run test:coverage # with coverage report
bun run lint          # ESLint (includes Obsidian plugin rules)
bun run typecheck     # tsc --noEmit
```

Property-based and fuzzing tests live in `src/test/PropertyBasedCrypto.test.ts`: round-trip invariance, bit-corruption rejection, truncation rejection, and unicode path stress.
