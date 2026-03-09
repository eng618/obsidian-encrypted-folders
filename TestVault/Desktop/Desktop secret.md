# Desktop playground

Use this folder to test the desktop-first workflow for the plugin.

Suggested desktop checks:

1. Encrypt this folder from the desktop file explorer.
2. Unlock it on desktop and confirm this file returns to plaintext.
3. Edit this file, save it, and confirm the folder stays unlocked while you are actively working in it.
4. Stop interacting with the folder for 5 minutes and confirm only this folder auto-locks.
5. Unlock it again, then send Obsidian to the background and confirm the folder locks immediately.
6. Re-open Obsidian and confirm the folder can be unlocked again without sync damage.

Notes to verify:

- Background lock should lock every unlocked folder.
- Inactivity lock should be tracked per folder.
- The folder should sync cleanly back to mobile after auto-locking.
