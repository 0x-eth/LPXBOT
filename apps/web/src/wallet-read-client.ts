import type {
  AddressBookCategory,
  AddressBookEntry,
  AddressBookPage,
  CreateAddressBookEntryRequest,
  EvmAddress,
  PatchAddressBookEntryRequest,
  WalletAssetBalance,
  WalletBalanceSnapshot,
  WalletReceiveContent,
  WalletTokenDefinition,
  WalletTokenPage,
} from "@lpbot/api-contract";
import { addressBookSecretMediaType } from "@lpbot/api-contract";

type WalletReadFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const integerPattern = /^(?:0|[1-9][0-9]*)$/u;
const categories = new Set<AddressBookCategory>(["person", "exchange", "protocol", "other"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function token(value: unknown, status: number): WalletTokenDefinition {
  if (
    !record(value) ||
    !exact(value, ["chainId", "decimals", "default", "name", "symbol", "tokenAddress"]) ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1 ||
    !Number.isInteger(value.decimals) ||
    Number(value.decimals) < 0 ||
    Number(value.decimals) > 255 ||
    typeof value.default !== "boolean" ||
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 128 ||
    typeof value.symbol !== "string" ||
    value.symbol.length < 1 ||
    value.symbol.length > 32 ||
    typeof value.tokenAddress !== "string" ||
    !addressPattern.test(value.tokenAddress)
  ) {
    throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as WalletTokenDefinition;
}

function balance(value: unknown, status: number): WalletAssetBalance {
  if (
    !record(value) ||
    !exact(value, [
      "assetType",
      "balanceBaseUnit",
      "balanceDecimal",
      "decimals",
      "default",
      "name",
      "priceStatus",
      "symbol",
      "tokenAddress",
      "usdPriceDecimal",
      "usdValueDecimal",
    ]) ||
    (value.assetType !== "native" && value.assetType !== "erc20") ||
    typeof value.balanceBaseUnit !== "string" ||
    !integerPattern.test(value.balanceBaseUnit) ||
    typeof value.balanceDecimal !== "string" ||
    !decimalPattern.test(value.balanceDecimal) ||
    !Number.isInteger(value.decimals) ||
    Number(value.decimals) < 0 ||
    Number(value.decimals) > 255 ||
    typeof value.default !== "boolean" ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string" ||
    (value.priceStatus !== "current" &&
      value.priceStatus !== "missing" &&
      value.priceStatus !== "stale") ||
    (value.tokenAddress !== null &&
      (typeof value.tokenAddress !== "string" || !addressPattern.test(value.tokenAddress))) ||
    (value.usdPriceDecimal !== null &&
      (typeof value.usdPriceDecimal !== "string" || !decimalPattern.test(value.usdPriceDecimal))) ||
    (value.usdValueDecimal !== null &&
      (typeof value.usdValueDecimal !== "string" || !decimalPattern.test(value.usdValueDecimal))) ||
    (value.priceStatus !== "current" && value.usdValueDecimal !== null) ||
    (value.assetType === "native" && value.tokenAddress !== null) ||
    (value.assetType === "erc20" && value.tokenAddress === null)
  ) {
    throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as WalletAssetBalance;
}

function addressBookEntry(value: unknown, status: number): AddressBookEntry {
  if (
    !record(value) ||
    !exact(value, [
      "address",
      "category",
      "chainId",
      "createdAt",
      "entryId",
      "label",
      "note",
      "revision",
      "updatedAt",
    ]) ||
    typeof value.entryId !== "string" ||
    !uuidPattern.test(value.entryId) ||
    typeof value.address !== "string" ||
    !addressPattern.test(value.address) ||
    typeof value.category !== "string" ||
    !categories.has(value.category as AddressBookCategory) ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1 ||
    typeof value.label !== "string" ||
    value.label.length < 1 ||
    value.label.length > 80 ||
    typeof value.note !== "string" ||
    value.note.length > 280 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt)
  ) {
    throw new WalletReadRequestError("ADDRESS_BOOK_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as AddressBookEntry;
}

export class WalletReadRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "WalletReadRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function parseWalletTokenPage(value: unknown, status = 0): WalletTokenPage {
  if (
    !record(value) ||
    !exact(value, ["chainId", "items", "walletId"]) ||
    !Number.isSafeInteger(value.chainId) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    !Array.isArray(value.items)
  ) {
    throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, status);
  }
  const items = value.items.map((item) => token(item, status));
  if (new Set(items.map(({ tokenAddress }) => tokenAddress.toLowerCase())).size !== items.length) {
    throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, status);
  }
  return { chainId: Number(value.chainId), items, walletId: value.walletId };
}

export function parseWalletBalanceSnapshot(value: unknown, status = 0): WalletBalanceSnapshot {
  if (
    !record(value) ||
    !exact(value, [
      "address",
      "blockNumberDecimal",
      "chainId",
      "items",
      "readAt",
      "totalUsdValueDecimal",
      "walletId",
    ]) ||
    typeof value.address !== "string" ||
    !addressPattern.test(value.address) ||
    typeof value.blockNumberDecimal !== "string" ||
    !integerPattern.test(value.blockNumberDecimal) ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1 ||
    !Array.isArray(value.items) ||
    !timestamp(value.readAt) ||
    (value.totalUsdValueDecimal !== null &&
      (typeof value.totalUsdValueDecimal !== "string" ||
        !decimalPattern.test(value.totalUsdValueDecimal))) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, status);
  }
  return {
    address: value.address as EvmAddress,
    blockNumberDecimal: value.blockNumberDecimal,
    chainId: Number(value.chainId),
    items: value.items.map((item) => balance(item, status)),
    readAt: value.readAt,
    totalUsdValueDecimal: value.totalUsdValueDecimal as string | null,
    walletId: value.walletId,
  };
}

export function parseWalletReceiveContent(value: unknown, status = 0): WalletReceiveContent {
  if (
    !record(value) ||
    !exact(value, [
      "address",
      "amountBaseUnit",
      "amountDecimal",
      "chainId",
      "eip681",
      "tokenAddress",
      "walletId",
    ]) ||
    typeof value.address !== "string" ||
    !addressPattern.test(value.address) ||
    (value.amountBaseUnit !== null &&
      (typeof value.amountBaseUnit !== "string" || !integerPattern.test(value.amountBaseUnit))) ||
    (value.amountDecimal !== null &&
      (typeof value.amountDecimal !== "string" || !decimalPattern.test(value.amountDecimal))) ||
    (value.amountBaseUnit === null) !== (value.amountDecimal === null) ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1 ||
    typeof value.eip681 !== "string" ||
    !value.eip681.startsWith("ethereum:") ||
    value.eip681.length > 1_024 ||
    /\p{Cc}/u.test(value.eip681) ||
    (value.tokenAddress !== null &&
      (typeof value.tokenAddress !== "string" || !addressPattern.test(value.tokenAddress))) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as WalletReceiveContent;
}

export function parseAddressBookPage(value: unknown, status = 0): AddressBookPage {
  if (
    !record(value) ||
    !exact(value, ["chainId", "classification", "entries", "ownWallets"]) ||
    !Number.isSafeInteger(value.chainId) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.ownWallets)
  ) {
    throw new WalletReadRequestError("ADDRESS_BOOK_RESPONSE_INVALID", true, status);
  }
  const entries = value.entries.map((item) => addressBookEntry(item, status));
  const ownWallets = value.ownWallets.map((item) => {
    if (
      !record(item) ||
      !exact(item, ["address", "name", "walletId"]) ||
      typeof item.address !== "string" ||
      !addressPattern.test(item.address) ||
      typeof item.name !== "string" ||
      typeof item.walletId !== "string" ||
      !uuidPattern.test(item.walletId)
    ) {
      throw new WalletReadRequestError("ADDRESS_BOOK_RESPONSE_INVALID", true, status);
    }
    return { address: item.address as EvmAddress, name: item.name, walletId: item.walletId };
  });
  let classification: AddressBookPage["classification"] = null;
  if (value.classification !== null) {
    const item = value.classification;
    if (
      !record(item) ||
      !exact(item, ["address", "entryId", "kind", "walletId"]) ||
      typeof item.address !== "string" ||
      !addressPattern.test(item.address) ||
      (item.kind !== "own-wallet" &&
        item.kind !== "known-external" &&
        item.kind !== "new-external") ||
      (item.entryId !== null && (typeof item.entryId !== "string" || !uuidPattern.test(item.entryId))) ||
      (item.walletId !== null &&
        (typeof item.walletId !== "string" || !uuidPattern.test(item.walletId)))
    ) {
      throw new WalletReadRequestError("ADDRESS_BOOK_RESPONSE_INVALID", true, status);
    }
    classification = item as unknown as AddressBookPage["classification"];
  }
  return { chainId: Number(value.chainId), classification, entries, ownWallets };
}

export class WalletReadClient {
  readonly #fetcher: WalletReadFetch;

  constructor(fetcher: WalletReadFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async balances(walletId: string, chainId: number, signal?: AbortSignal) {
    const response = await this.#request(
      `/api/wallets/${this.#uuid(walletId)}/balances?chainId=${chainId}`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return parseWalletBalanceSnapshot(response.data, response.status);
  }

  async tokens(walletId: string, chainId: number, signal?: AbortSignal) {
    const response = await this.#request(
      `/api/wallets/${this.#uuid(walletId)}/tokens?chainId=${chainId}`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return parseWalletTokenPage(response.data, response.status);
  }

  async importToken(walletId: string, chainId: number, tokenAddress: string) {
    const response = await this.#request(`/api/wallets/${this.#uuid(walletId)}/tokens`, {
      body: JSON.stringify({ chainId, tokenAddress }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return token(response.data, response.status);
  }

  async deleteToken(walletId: string, chainId: number, tokenAddress: string) {
    const response = await this.#request(
      `/api/wallets/${this.#uuid(walletId)}/tokens/${encodeURIComponent(tokenAddress)}?chainId=${chainId}`,
      { method: "DELETE" },
    );
    if (!record(response.data) || !exact(response.data, ["deleted"]) || typeof response.data.deleted !== "boolean") {
      throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, response.status);
    }
    return response.data.deleted;
  }

  async receive(
    walletId: string,
    chainId: number,
    options: { amountDecimal?: string; tokenAddress?: string } = {},
  ) {
    const query = new URLSearchParams({ chainId: String(chainId) });
    if (options.amountDecimal) query.set("amountDecimal", options.amountDecimal);
    if (options.tokenAddress) query.set("tokenAddress", options.tokenAddress);
    const response = await this.#request(
      `/api/wallets/${this.#uuid(walletId)}/receive?${query.toString()}`,
      { method: "GET" },
    );
    return parseWalletReceiveContent(response.data, response.status);
  }

  async addressBook(chainId: number, address?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ chainId: String(chainId) });
    if (address) query.set("address", address);
    const response = await this.#request(`/api/address-book?${query.toString()}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseAddressBookPage(response.data, response.status);
  }

  async createAddressBookEntry(input: CreateAddressBookEntryRequest) {
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    try {
      const response = await this.#request("/api/address-book", {
        body: bytes as unknown as BodyInit,
        headers: { "Content-Type": addressBookSecretMediaType },
        method: "POST",
      });
      return addressBookEntry(response.data, response.status);
    } finally {
      bytes.fill(0);
    }
  }

  async patchAddressBookEntry(entryId: string, input: PatchAddressBookEntryRequest) {
    const response = await this.#request(`/api/address-book/${this.#uuid(entryId)}`, {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return addressBookEntry(response.data, response.status);
  }

  async deleteAddressBookEntry(entryId: string) {
    const response = await this.#request(`/api/address-book/${this.#uuid(entryId)}`, {
      method: "DELETE",
    });
    if (!record(response.data) || !exact(response.data, ["deleted"]) || response.data.deleted !== true) {
      throw new WalletReadRequestError("ADDRESS_BOOK_RESPONSE_INVALID", true, response.status);
    }
  }

  #uuid(value: string): string {
    if (!uuidPattern.test(value)) throw new WalletReadRequestError("INVALID_ID", false, 0);
    return value.toLowerCase();
  }

  async #request(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    let response: Response;
    try {
      response = await this.#fetcher(path, {
        ...init,
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json", "Cache-Control": "no-store", ...init.headers },
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new WalletReadRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, response.status);
    }
    if (!response.ok) {
      const envelope = record(body) ? (body as ErrorEnvelope) : null;
      const code =
        typeof envelope?.error?.code === "string" ? envelope.error.code : "WALLET_READ_REQUEST_FAILED";
      throw new WalletReadRequestError(code, envelope?.error?.retryable === true, response.status);
    }
    if (!record(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      throw new WalletReadRequestError("WALLET_READ_RESPONSE_INVALID", true, response.status);
    }
    return { data: body.data, status: response.status };
  }
}
