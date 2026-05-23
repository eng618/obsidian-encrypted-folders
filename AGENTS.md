# Obsidian Encrypted Folders

## Project Overview

Provides vault-level encryption for specific folders in Obsidian. Handles key management, recovery keys, and automatic locking behavior.

## Environment & Tooling

- **Package Manager**: `bun`
- **Bundler**: `Vite` (outputs to `main.js` at root)
- **Testing**: `Vitest` with `jsdom`
- **Linting**: `eslint` (via `bun run lint`)

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
