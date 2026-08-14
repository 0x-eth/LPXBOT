import type { ChainAccessMode } from "@lpbot/domain";

export type ChainPolicyStoreErrorCode =
  | "CHAIN_UNKNOWN"
  | "CHAIN_NOT_READY"
  | "DEFAULT_CHAIN_REQUIRED"
  | "CONFIG_CONFLICT"
  | "CONFIG_INVALID";

export class ChainPolicyStoreError extends Error {
  readonly code: ChainPolicyStoreErrorCode;

  constructor(code: ChainPolicyStoreErrorCode) {
    super(code);
    this.name = "ChainPolicyStoreError";
    this.code = code;
  }
}

export interface ChainAccessPolicyView {
  access: ChainAccessMode;
  chainId: number;
  configurationComplete: boolean;
  displayName: string;
  isDefault: boolean;
  missingConfiguration: readonly string[];
  previousAccess: ChainAccessMode | null;
  reason: string | null;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ChainAccessPolicyChange {
  access: ChainAccessMode;
  chainId: number;
  expectedRevision: number;
}

export interface ChainAccessPolicyUpdateInput {
  actorUserId: string;
  changes: readonly ChainAccessPolicyChange[];
  reason: string;
  requestId: string;
  sessionId: string;
  updatedAt: Date;
}

export interface ChainAccessPolicyUpdateResult {
  policies: ChainAccessPolicyView[];
  status: "updated" | "unchanged";
}

export interface ChainManagementAuditInput {
  actorUserId: string | null;
  createdAt: Date;
  outcome: "allowed" | "denied";
  reason: string | null;
  requestId: string;
  resultCode: string;
  sessionId: string | null;
}

export interface ChainAccessPolicyStore {
  list(): Promise<ChainAccessPolicyView[]>;
  recordManagementAudit(input: ChainManagementAuditInput): Promise<void>;
  update(input: ChainAccessPolicyUpdateInput): Promise<ChainAccessPolicyUpdateResult>;
}
