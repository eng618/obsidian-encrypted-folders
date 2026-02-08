export interface EncryptedFileInfo {
  originalPath: string;
  encryptedPath: string;
  timestamp: number;
}

export interface FolderMetadata {
  version: number;
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
}

export interface FolderState {
  path: string;
  isLocked: boolean;
  metadata?: FolderMetadata;
  files: EncryptedFileInfo[];
}
