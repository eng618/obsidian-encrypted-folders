export type FolderPasswordKind = 'master' | 'custom';

export const MAX_PASSWORD_LABEL_LENGTH = 80;
export const MASTER_VERIFIER_PHRASE = 'OBSIDIAN_MASTER_VERIFICATION';
export const MASTER_KDF_ITERATIONS = 600000;

export interface MasterPasswordRecord {
  salt: string;
  verifier: string;
  verifierIV: string;
  iterations: number;
  recoverySalt: string;
  recoveryVerifier: string;
  recoveryVerifierIV: string;
  /** Master recovery key plaintext, AES-GCM encrypted with the master-derived key. */
  recoveryKeyEnvelope: string;
  recoveryKeyEnvelopeIV: string;
  createdAt: number;
  updatedAt: number;
}

export function sanitizePasswordLabel(label: string | undefined): string | undefined {
  if (label === undefined) {
    return undefined;
  }
  const trimmed = label.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(0, MAX_PASSWORD_LABEL_LENGTH);
}

export function validateCustomPasswordLabel(label: string | undefined): string {
  const clean = sanitizePasswordLabel(label);
  if (!clean) {
    throw new Error('A title is required for custom passwords (e.g. "Banking docs").');
  }
  // eslint-disable-next-line no-control-regex -- reject C0/C1 control characters in titles
  if (/[\u0000-\u001f\u007f]/.test(clean)) {
    throw new Error('Password title contains invalid characters.');
  }
  return clean;
}

export function describePasswordKind(kind: FolderPasswordKind | undefined, label?: string): string {
  if (kind === 'master') {
    return 'Master password';
  }
  const clean = sanitizePasswordLabel(label);
  return clean ? `Custom password — "${clean}"` : 'Custom password';
}

export function isMasterPasswordRecord(value: unknown): value is MasterPasswordRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const field of [
    'salt',
    'verifier',
    'verifierIV',
    'recoverySalt',
    'recoveryVerifier',
    'recoveryVerifierIV',
    'recoveryKeyEnvelope',
    'recoveryKeyEnvelopeIV',
  ] as const) {
    const entry: unknown = record[field];
    if (typeof entry !== 'string' || entry.length === 0) {
      return false;
    }
  }
  return (
    typeof record.iterations === 'number' &&
    Number.isFinite(record.iterations) &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
  );
}
