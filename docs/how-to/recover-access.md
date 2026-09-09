# Recover access

> Quadrant: **How-to**. Audience: any user locked out of a folder. Prerequisites: none — but these flows only work if you prepared while the folder was accessible.

## Unlock with your recovery key

1. Right-click the locked folder.
2. Select **Unlock with recovery key**.
3. Enter the 32-character recovery key shown when the folder was first encrypted.
4. The folder unlocks exactly as with the password flow.

If you lost both password and recovery key, the data is unrecoverable by design. There is no backdoor.

## Wrong password

An incorrect password shows an error notification and leaves files encrypted. After repeated failures the plugin applies exponential backoff before further attempts. Nothing is modified on disk by a failed attempt.

## Permanently remove encryption

1. Right-click the folder and select **Permanently decrypt folder**.
2. If the folder is locked, enter your password first so files can be restored.
3. Type the folder name to confirm.
4. Files return to plaintext and the metadata files (`obsidian-folder-meta.json`, `README_ENCRYPTED.md`) are deleted.

## Protect yourself in advance

- Store the recovery key in a password manager the moment it is shown — confirmation is required before the dialog closes.
- Keep an offline backup of the recovery key separate from the vault (if the vault is lost, a key stored only inside it is lost too).
- Verify recovery works: encrypt a scratch folder, lock it, and unlock it with the recovery key before trusting it with real data.
