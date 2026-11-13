# Obsidian Encrypted Folders

## Project Overview

Provides vault-level encryption for specific folders in Obsidian. Handles key management, recovery keys, and automatic locking behavior.

## Environment & Tooling

- **Package Manager**: `bun`
- **Bundler**: `Vite` (outputs CommonJS to `dist/main.js`)
- **Testing**: `Vitest` with `jsdom`
- **Linting**: `oxlint` (via `bun run lint`)

### Essential Commands

- Install: `bun install`
- Build: `bun run build`
- Dev: `bun run dev`
- Test: `bun run test`
- Lint: `bun run lint`

## Architecture & Logic

- **Entry Point**: `main.ts` (Plugin lifecycle and Command registration).
- **Core Services**:
  - `EncryptionService.ts`: Low-level crypto operations.
  - `FileService.ts`: File system interactions and binary data handling.
  - `FolderService.ts`: Orchestrates encryption state, locking/unlocking, and vault scans.
- **UI Components**: Located in `src/ui/`. Modals (`PasswordModal`, `RecoveryKeyModal`) are primary interfaces for security flows.
- **State Management**: `FolderState.ts` defines the structure of encrypted folder metadata.

## Development Conventions

- **Strict TypeScript**: Ensure `"strict": true` is honored.
- **Minimal `main.ts`**: Keep lifecycle logic here; move business logic to services.
- **Modal Logic**: Modals that perform security-critical actions (like unlocking) should return `Promise<boolean>` to allow the caller to handle results (e.g., showing notices or managing retry attempts).
- **Security**:
  - Use exponential backoff for password entry to prevent brute-forcing.
  - Never commit secrets or raw keys to the repository.
- **Vault Safety**: Only interact with files inside the vault. Use `this.app.vault` and `this.app.fileManager`.

## Testing Quirks

- **Mocks**: Obsidian API is mocked in `src/test/mocks/obsidian.ts`.
- **DOM**: Uses `jsdom`. Custom polyfills for `HTMLElement.prototype.empty` and `createEl` are provided in mocks to emulate Obsidian's API.
- **Fake Timers**: Use `vi.useFakeTimers()` for testing backoff logic; remember to call `vi.runAllTimersAsync()` or `vi.advanceTimersByTime()` to resolve async timeouts.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **obsidian-encrypted-folders** (1413 symbols, 5275 relationships, 112 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource                                                    | Use for                                  |
| ----------------------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/obsidian-encrypted-folders/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/obsidian-encrypted-folders/clusters`       | All functional areas                     |
| `gitnexus://repo/obsidian-encrypted-folders/processes`      | All execution flows                      |
| `gitnexus://repo/obsidian-encrypted-folders/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                               |
| -------------------------------------------- | -------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
