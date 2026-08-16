import type {
  AddressRemark,
  AddressRemarksResponse,
  EvmAddress,
  PutAddressRemarkRequest,
  SharedRemark,
} from "@lpbot/api-contract";

export class AddressRemarksRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super("The address remark request could not be completed");
    this.code = code;
    this.name = "AddressRemarksRequestError";
    this.retryable = retryable;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

const canonicalAddressPattern = /^0x[0-9a-f]{40}$/u;
const controlCharacterPattern = /\p{Cc}/u;

function validLabel(value: unknown, allowEmpty: boolean): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value === value.trim() &&
    [...value].length <= 32 &&
    !controlCharacterPattern.test(value)
  );
}

function parseAddress(value: unknown): EvmAddress | null {
  return typeof value === "string" && canonicalAddressPattern.test(value)
    ? (value as EvmAddress)
    : null;
}

function parseAddressRemark(value: unknown): AddressRemark | null {
  if (!isRecord(value) || !hasExactKeys(value, ["address", "label", "watched"])) return null;
  const address = parseAddress(value.address);
  if (!address || !validLabel(value.label, true) || typeof value.watched !== "boolean") return null;
  return { address, label: value.label, watched: value.watched };
}

function parseSharedRemark(value: unknown): SharedRemark | null {
  if (!isRecord(value) || !hasExactKeys(value, ["address", "label", "votes"])) return null;
  const address = parseAddress(value.address);
  if (
    !address ||
    !validLabel(value.label, false) ||
    !Number.isSafeInteger(value.votes) ||
    (value.votes as number) < 1
  ) {
    return null;
  }
  return { address, label: value.label, votes: value.votes as number };
}

function parseList(value: unknown): AddressRemarksResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["remarks", "shared"]) ||
    !Array.isArray(value.remarks) ||
    !Array.isArray(value.shared)
  ) {
    return null;
  }
  const remarks = value.remarks.map(parseAddressRemark);
  const shared = value.shared.map(parseSharedRemark);
  if (remarks.some((remark) => remark === null) || shared.some((remark) => remark === null)) {
    return null;
  }
  const personalAddresses = new Set(remarks.map((remark) => remark!.address));
  const sharedAddresses = new Set(shared.map((remark) => remark!.address));
  if (personalAddresses.size !== remarks.length || sharedAddresses.size !== shared.length)
    return null;
  return {
    remarks: remarks as AddressRemark[],
    shared: shared as SharedRemark[],
  };
}

export class AddressRemarksClient {
  readonly #fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async get(signal?: AbortSignal): Promise<AddressRemarksResponse> {
    const data = await this.#request("/api/address-remarks", {
      cache: "no-store",
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    const parsed = parseList(data);
    if (!parsed) throw new AddressRemarksRequestError("INVALID_RESPONSE", true, 200);
    return parsed;
  }

  async put(request: PutAddressRemarkRequest): Promise<AddressRemark | null> {
    const data = await this.#request("/api/address-remarks", {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
    if (!isRecord(data) || !hasExactKeys(data, ["remark"])) {
      throw new AddressRemarksRequestError("INVALID_RESPONSE", true, 200);
    }
    if (data.remark === null) return null;
    const remark = parseAddressRemark(data.remark);
    if (!remark) throw new AddressRemarksRequestError("INVALID_RESPONSE", true, 200);
    return remark;
  }

  async delete(address: EvmAddress): Promise<boolean> {
    const data = await this.#request(`/api/address-remarks/${encodeURIComponent(address)}`, {
      cache: "no-store",
      method: "DELETE",
    });
    if (!isRecord(data) || !hasExactKeys(data, ["deleted"]) || typeof data.deleted !== "boolean") {
      throw new AddressRemarksRequestError("INVALID_RESPONSE", true, 200);
    }
    return data.deleted;
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetcher(path, { ...init, credentials: "include" });
    } catch {
      throw new AddressRemarksRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AddressRemarksRequestError("INVALID_RESPONSE", true, response.status);
    }
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : null;
      throw new AddressRemarksRequestError(
        error && typeof error.code === "string" ? error.code : "REQUEST_FAILED",
        error?.retryable === true,
        response.status,
      );
    }
    if (!isRecord(body) || body.success !== true || !("data" in body)) {
      throw new AddressRemarksRequestError("INVALID_RESPONSE", true, response.status);
    }
    return body.data;
  }
}
