import { randomUUID } from "node:crypto";

import type {
  AddressBookCategory,
  AddressBookEntry,
  AddressClassificationView,
  CustodyWallet,
  EvmAddress,
  PatchAddressBookEntryRequest,
} from "@lpbot/api-contract";

import { canonicalWalletAddress } from "./wallet-assets.js";

export type AddressBookErrorCode =
  | "ADDRESS_BOOK_DUPLICATE"
  | "ADDRESS_BOOK_ENTRY_NOT_FOUND"
  | "ADDRESS_BOOK_INVALID"
  | "ADDRESS_BOOK_REVISION_CONFLICT"
  | "ADDRESS_IS_OWN_WALLET";

export class AddressBookError extends Error {
  readonly code: AddressBookErrorCode;

  constructor(code: AddressBookErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "AddressBookError";
    this.code = code;
  }
}

export type AddressBookAuditAction =
  "address-book.create" | "address-book.delete" | "address-book.patch";

export interface AddressBookAuditInput {
  action: AddressBookAuditAction;
  actorUserId: string;
  address: EvmAddress | null;
  chainId: number | null;
  createdAt: Date;
  entryId: string | null;
  outcome: "allowed" | "denied";
  requestId: string;
  resultCode: string;
  sessionId: string;
}

export type AddressBookAllowedAudit = Omit<AddressBookAuditInput, "outcome" | "resultCode">;

export interface AddressBookCreateInput {
  address: EvmAddress;
  audit: AddressBookAllowedAudit;
  category: AddressBookCategory;
  chainId: number;
  createdAt: Date;
  label: string;
  note: string;
  userId: string;
}

export interface AddressBookPatchInput extends PatchAddressBookEntryRequest {
  audit: AddressBookAllowedAudit;
  entryId: string;
  updatedAt: Date;
  userId: string;
}

export interface AddressBookDeleteInput {
  audit: AddressBookAllowedAudit;
  deletedAt: Date;
  entryId: string;
  userId: string;
}

export interface AddressBookStore {
  create(input: AddressBookCreateInput): Promise<AddressBookEntry>;
  delete(input: AddressBookDeleteInput): Promise<boolean>;
  get(input: { entryId: string; userId: string }): Promise<AddressBookEntry | null>;
  list(input: { chainId: number; userId: string }): Promise<AddressBookEntry[]>;
  patch(input: AddressBookPatchInput): Promise<AddressBookEntry>;
  recordDenied(input: AddressBookAuditInput): Promise<void>;
}

export interface ParsedAddressBookCreate {
  address: EvmAddress;
  category: AddressBookCategory;
  chainId: number;
  label: string;
  note: string;
  password: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const categorySet = new Set<AddressBookCategory>(["person", "exchange", "protocol", "other"]);
const controlCharacterPattern = /\p{Cc}/u;

function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AddressBookError("ADDRESS_BOOK_INVALID");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, minimum: number, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    [...value].length < minimum ||
    [...value].length > maximum ||
    controlCharacterPattern.test(value)
  ) {
    throw new AddressBookError("ADDRESS_BOOK_INVALID");
  }
  return value;
}

function category(value: unknown): AddressBookCategory {
  if (typeof value !== "string" || !categorySet.has(value as AddressBookCategory)) {
    throw new AddressBookError("ADDRESS_BOOK_INVALID");
  }
  return value as AddressBookCategory;
}

export function parseAddressBookEntryId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new AddressBookError("ADDRESS_BOOK_ENTRY_NOT_FOUND");
  }
  return value.toLowerCase();
}

export function parseAddressBookCreateIngress(value: Uint8Array): ParsedAddressBookCreate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8"),
    );
  } catch (error) {
    throw new AddressBookError("ADDRESS_BOOK_INVALID", { cause: error });
  }
  const input = plainRecord(parsed);
  const allowed = new Set(["address", "category", "chainId", "label", "note", "password"]);
  if (
    Object.keys(input).some((key) => !allowed.has(key)) ||
    !Object.hasOwn(input, "address") ||
    !Object.hasOwn(input, "chainId") ||
    !Object.hasOwn(input, "label") ||
    !Object.hasOwn(input, "password") ||
    !Number.isSafeInteger(input.chainId) ||
    Number(input.chainId) < 1 ||
    typeof input.password !== "string" ||
    [...input.password].length < 1 ||
    [...input.password].length > 256
  ) {
    throw new AddressBookError("ADDRESS_BOOK_INVALID");
  }
  const password = input.password;
  input.password = "";
  return {
    address: canonicalWalletAddress(input.address, "INVALID_TOKEN"),
    category: input.category === undefined ? "other" : category(input.category),
    chainId: Number(input.chainId),
    label: text(input.label, 1, 80),
    note: input.note === undefined ? "" : text(input.note, 0, 280),
    password,
  };
}

export function parseAddressBookPatch(value: unknown): PatchAddressBookEntryRequest {
  const input = plainRecord(value);
  if (
    Object.keys(input).sort().join(",") !== "changes,expectedRevision" ||
    !Number.isSafeInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 1
  ) {
    throw new AddressBookError("ADDRESS_BOOK_INVALID");
  }
  const changes = plainRecord(input.changes);
  const keys = Object.keys(changes);
  if (
    keys.length < 1 ||
    keys.some((key) => key !== "category" && key !== "label" && key !== "note")
  ) {
    throw new AddressBookError("ADDRESS_BOOK_INVALID");
  }
  return {
    changes: {
      ...(Object.hasOwn(changes, "category") ? { category: category(changes.category) } : {}),
      ...(Object.hasOwn(changes, "label") ? { label: text(changes.label, 1, 80) } : {}),
      ...(Object.hasOwn(changes, "note") ? { note: text(changes.note, 0, 280) } : {}),
    },
    expectedRevision: Number(input.expectedRevision),
  };
}

export function classifyAddress(input: {
  address: EvmAddress;
  entries: readonly AddressBookEntry[];
  wallets: readonly CustodyWallet[];
}): AddressClassificationView {
  const address = canonicalWalletAddress(input.address);
  const wallet = input.wallets.find(
    (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
  );
  if (wallet) return { address, entryId: null, kind: "own-wallet", walletId: wallet.walletId };
  const entry = input.entries.find((candidate) => candidate.address === address);
  if (entry) {
    return { address, entryId: entry.entryId, kind: "known-external", walletId: null };
  }
  return { address, entryId: null, kind: "new-external", walletId: null };
}

export class MemoryAddressBookStore implements AddressBookStore {
  readonly audits: AddressBookAuditInput[] = [];
  readonly #entries = new Map<string, AddressBookEntry & { userId: string }>();
  readonly #uuid: () => string;

  constructor(uuid: () => string = randomUUID) {
    this.#uuid = uuid;
  }

  async create(input: AddressBookCreateInput): Promise<AddressBookEntry> {
    const duplicate = [...this.#entries.values()].find(
      (entry) =>
        entry.userId === input.userId &&
        entry.chainId === input.chainId &&
        entry.address === input.address,
    );
    if (duplicate) throw new AddressBookError("ADDRESS_BOOK_DUPLICATE");
    const value: AddressBookEntry & { userId: string } = {
      address: input.address,
      category: input.category,
      chainId: input.chainId,
      createdAt: input.createdAt.toISOString(),
      entryId: this.#uuid(),
      label: input.label,
      note: input.note,
      revision: 1,
      updatedAt: input.createdAt.toISOString(),
      userId: input.userId,
    };
    this.#entries.set(value.entryId, value);
    this.audits.push({
      ...input.audit,
      entryId: value.entryId,
      outcome: "allowed",
      resultCode: "CREATED",
    });
    return this.#public(value);
  }

  async delete(input: AddressBookDeleteInput): Promise<boolean> {
    const current = this.#entries.get(input.entryId);
    const deleted = current?.userId === input.userId && this.#entries.delete(input.entryId);
    this.audits.push({
      ...input.audit,
      outcome: "allowed",
      resultCode: deleted ? "DELETED" : "ALREADY_ABSENT",
    });
    return Boolean(deleted);
  }

  async get(input: { entryId: string; userId: string }): Promise<AddressBookEntry | null> {
    const value = this.#entries.get(input.entryId);
    return value?.userId === input.userId ? this.#public(value) : null;
  }

  async list(input: { chainId: number; userId: string }): Promise<AddressBookEntry[]> {
    return [...this.#entries.values()]
      .filter((entry) => entry.userId === input.userId && entry.chainId === input.chainId)
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) || left.entryId.localeCompare(right.entryId),
      )
      .map((entry) => this.#public(entry));
  }

  async patch(input: AddressBookPatchInput): Promise<AddressBookEntry> {
    const current = this.#entries.get(input.entryId);
    if (!current || current.userId !== input.userId) {
      throw new AddressBookError("ADDRESS_BOOK_ENTRY_NOT_FOUND");
    }
    if (current.revision !== input.expectedRevision) {
      throw new AddressBookError("ADDRESS_BOOK_REVISION_CONFLICT");
    }
    const next = {
      ...current,
      ...input.changes,
      revision: current.revision + 1,
      updatedAt: input.updatedAt.toISOString(),
    };
    this.#entries.set(input.entryId, next);
    this.audits.push({ ...input.audit, outcome: "allowed", resultCode: "UPDATED" });
    return this.#public(next);
  }

  async recordDenied(input: AddressBookAuditInput): Promise<void> {
    this.audits.push(structuredClone(input));
  }

  #public(value: AddressBookEntry & { userId: string }): AddressBookEntry {
    return structuredClone({
      address: value.address,
      category: value.category,
      chainId: value.chainId,
      createdAt: value.createdAt,
      entryId: value.entryId,
      label: value.label,
      note: value.note,
      revision: value.revision,
      updatedAt: value.updatedAt,
    });
  }
}
