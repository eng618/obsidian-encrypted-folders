# Mobile playground

Use this folder to test the mobile-first workflow for the plugin.

Suggested mobile checks:

1. Sync this folder to mobile and confirm the latest locked or unlocked state arrives correctly.
2. Unlock the folder on mobile and confirm this note becomes readable.
3. Edit this file on mobile, save it, and verify the folder remains unlocked while you are still working in it.
4. Leave the folder alone for 5 minutes and confirm the folder auto-locks on its own.
5. Put the app in the background and confirm the folder locks before the next sync cycle.
6. Sync back to desktop and confirm desktop sees a clean locked state.

Notes to verify:

- Mobile backgrounding should trigger the safest lock path possible.
- Per-folder inactivity should only affect folders that were actually left idle.
- Desktop should not report sync errors after mobile auto-lock completes.
