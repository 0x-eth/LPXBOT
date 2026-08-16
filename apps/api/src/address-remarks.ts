import type {
  AddressRemark,
  AddressRemarksResponse,
  EvmAddress,
  PutAddressRemarkRequest,
} from "@lpbot/api-contract";

export const addressRemarkChainId = 56 as const;

export type AddressRemarkAuditAction = "address-remark.delete" | "address-remark.put";
export type AddressRemarkAuditOutcome = "allowed" | "denied";

export interface AddressRemarkAuditInput {
  action: AddressRemarkAuditAction;
  actorUserId: string;
  address: EvmAddress | null;
  chainId: typeof addressRemarkChainId;
  createdAt: Date;
  outcome: AddressRemarkAuditOutcome;
  requestId: string;
  resultCode: string;
  sessionId: string;
}

export type AddressRemarkAllowedAudit = Omit<AddressRemarkAuditInput, "outcome" | "resultCode">;

export interface AddressRemarkPutInput extends PutAddressRemarkRequest {
  audit: AddressRemarkAllowedAudit;
  chainId: typeof addressRemarkChainId;
  updatedAt: Date;
  userId: string;
}

export interface AddressRemarkDeleteInput {
  address: EvmAddress;
  audit: AddressRemarkAllowedAudit;
  chainId: typeof addressRemarkChainId;
  deletedAt: Date;
  userId: string;
}

export interface AddressRemarkStore {
  delete(input: AddressRemarkDeleteInput): Promise<boolean>;
  list(input: {
    chainId: typeof addressRemarkChainId;
    userId: string;
  }): Promise<AddressRemarksResponse>;
  put(input: AddressRemarkPutInput): Promise<AddressRemark | null>;
  recordDenied(input: AddressRemarkAuditInput): Promise<void>;
}

export class AddressRemarkValidationError extends Error {
  readonly code = "ADDRESS_REMARK_INVALID";

  constructor() {
    super("Address remark request is invalid");
    this.name = "AddressRemarkValidationError";
  }
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const controlCharacterPattern = /\p{Cc}/u;

export function canonicalAddressRemarkAddress(value: unknown): EvmAddress {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new AddressRemarkValidationError();
  }
  return value.toLowerCase() as EvmAddress;
}

export function parseAddressRemarkPutRequest(value: unknown): PutAddressRemarkRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AddressRemarkValidationError();
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "address,label,watched") {
    throw new AddressRemarkValidationError();
  }
  if (
    typeof record.label !== "string" ||
    typeof record.watched !== "boolean" ||
    controlCharacterPattern.test(record.label)
  ) {
    throw new AddressRemarkValidationError();
  }
  const label = record.label.trim();
  if ([...label].length > 32) throw new AddressRemarkValidationError();
  return {
    address: canonicalAddressRemarkAddress(record.address),
    label,
    watched: record.watched,
  };
}
