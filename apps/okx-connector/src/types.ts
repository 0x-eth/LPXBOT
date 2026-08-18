import type { OkxKeyStatus, OkxKeyStatusName } from "@lpbot/api-contract";

export const okxCredentialDomain = "lpbot.okx.read-only-credential" as const;
export const okxCredentialEnvironment = "production" as const;
export const okxCredentialMaximumAgeMilliseconds = 90 * 24 * 60 * 60 * 1_000;

export interface OkxCredentialBytes {
  apiKey: Buffer;
  passphrase: Buffer;
  secretKey: Buffer;
}

export interface OkxCredentialAadIdentity {
  credentialId: string;
  environment: string;
  userId: string;
  version: number;
}

export interface OkxCredentialEnvelope extends OkxCredentialAadIdentity {
  aadVersion: 1;
  algorithm: "AES-256-GCM";
  ciphertext: Buffer;
  createdAt: Date;
  kekId: string;
  kekVersion: string;
  nonce: Buffer;
  tag: Buffer;
  wrappedDek: Buffer;
}

export interface OkxCredentialVersionRecord {
  active: boolean;
  destroyedAt: Date | null;
  envelope: OkxCredentialEnvelope;
  status: OkxKeyStatusName;
}

export interface OkxCredentialHead {
  capabilityEpoch: number;
  configured: boolean;
  credentialId: string;
  rotationDueAt: Date | null;
  status: OkxKeyStatusName;
  updatedAt: Date;
  userId: string;
  version: number;
}

export type OkxCredentialAuditAction =
  | "save"
  | "replace"
  | "delete"
  | "test"
  | "status-change"
  | "egress-denied";

export interface OkxCredentialAuditEvent {
  action: OkxCredentialAuditAction;
  actor: string;
  changed: boolean;
  createdAt: Date;
  requestId: string;
  status: OkxKeyStatusName;
  userId: string;
  version: number;
}

export interface OkxCredentialMutationContext {
  actor: string;
  now: Date;
  requestId: string;
  userId: string;
}

export interface OkxCredentialRepository {
  activateStaged(input: {
    context: OkxCredentialMutationContext;
    expectedActiveVersion: number;
    rotationDueAt: Date;
    version: number;
  }): Promise<OkxCredentialHead>;
  appendAudit(event: OkxCredentialAuditEvent): Promise<void>;
  beginDelete(input: {
    context: OkxCredentialMutationContext;
    expectedVersion: number;
  }): Promise<OkxCredentialHead>;
  completeDelete(input: {
    context: OkxCredentialMutationContext;
    expectedVersion: number;
  }): Promise<OkxCredentialHead>;
  createStaged(input: {
    context: OkxCredentialMutationContext;
    envelope: OkxCredentialEnvelope;
    expectedActiveVersion: number;
  }): Promise<OkxCredentialHead>;
  destroyStaged(input: {
    context: OkxCredentialMutationContext;
    version: number;
  }): Promise<void>;
  getActiveEnvelope(userId: string, expectedVersion: number): Promise<OkxCredentialEnvelope | null>;
  getHead(userId: string): Promise<OkxCredentialHead | null>;
  listRecoverable(now: Date, stagedBefore: Date): Promise<OkxCredentialHead[]>;
  setStatus(input: {
    context: OkxCredentialMutationContext;
    expectedCapabilityEpoch?: number;
    expectedVersion: number;
    status: OkxKeyStatusName;
  }): Promise<OkxCredentialHead>;
}

export interface OkxProviderValidation {
  authentication: "invalid" | "unknown" | "valid";
  ipAllowlisted: boolean | null;
  permissions: {
    read: boolean | null;
    trade: boolean | null;
    withdraw: boolean | null;
  };
}

export interface OkxReadOnlyTransport {
  validate(credentials: OkxCredentialBytes): Promise<OkxProviderValidation>;
}

export interface OkxKmsKeyDescriptor {
  kekId: string;
  kekVersion: string;
}

export interface OkxKmsClient {
  activeKey(): Promise<OkxKmsKeyDescriptor>;
  unwrapDek(input: OkxKmsKeyDescriptor & { wrappedDek: Uint8Array }): Promise<Buffer>;
  wrapDek(input: { dek: Uint8Array; key: OkxKmsKeyDescriptor }): Promise<Buffer>;
}

export interface OkxConnectorApplication {
  delete(input: OkxCredentialMutationContext & { expectedVersion: number }): Promise<OkxKeyStatus>;
  replace(input: OkxCredentialMutationContext & { expectedVersion: number; ingress: Buffer }): Promise<OkxKeyStatus>;
  save(input: OkxCredentialMutationContext & { ingress: Buffer }): Promise<OkxKeyStatus>;
  status(userId: string): Promise<OkxKeyStatus>;
  test(input: OkxCredentialMutationContext & { expectedVersion: number }): Promise<OkxKeyStatus>;
}

export function clearCredentialBytes(credentials: OkxCredentialBytes): void {
  credentials.apiKey.fill(0);
  credentials.secretKey.fill(0);
  credentials.passphrase.fill(0);
}
