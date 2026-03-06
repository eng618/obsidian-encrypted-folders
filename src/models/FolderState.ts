export interface EncryptedFileInfo {
  originalPath: string;
  encryptedPath: string;
  timestamp: number;
}

export type FolderLifecycleState = 'locked' | 'unlocked' | 'locking' | 'unlocking' | 'error';

export interface FolderMetadata {
  version: number;
  schemaVersion: number;
  id: string; // Unique identifier for the encrypted folder
  encryptionMethod: 'AES-256-GCM';
  kdfMethod: 'PBKDF2-SHA256';
  salt: string; // Base64 encoded salt for password KDF
  iterations: number; // KDF iterations
  lockFile: string; // Name of the lock file usually inside the folder
  testToken: string; // Encrypted known value to verify password
  wrappedMasterKey: string; // Master key encrypted with password-derived key
  masterKeyIV: string; // IV for master key wrapping
  recoverySalt?: string; // Salt for recovery key KDF
  wrappedMasterKeyRecovery?: string; // Master key encrypted with recovery-derived key
  recoveryIV?: string; // IV for recovery key wrapping
  expectedLockedFiles?: number; // Number of .locked payload files expected when folder is locked
  state?: FolderLifecycleState;
  lastTransitionAt?: number;
  lastError?: string;
}

export interface FolderState {
  path: string;
  isLocked: boolean;
  lifecycleState: FolderLifecycleState;
  metadata?: FolderMetadata;
  files: EncryptedFileInfo[];
}
