import type { KmsClient, KmsKeyDescriptor, WrappedDek } from "./kms.js";
import { SignerError } from "./signer-error.js";

type KmsFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decode(value: unknown, expectedBytes: number | null): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new SignerError("SIGNER_UNAVAILABLE", true);
  }
  const bytes = Buffer.from(value, "base64");
  if ((expectedBytes !== null && bytes.length !== expectedBytes) || bytes.toString("base64") !== value) {
    bytes.fill(0);
    throw new SignerError("SIGNER_UNAVAILABLE", true);
  }
  return bytes;
}

export class HttpKmsClient implements KmsClient {
  readonly #fetcher: KmsFetch;
  readonly #identity: string;
  readonly #identityToken: string;
  readonly #key: KmsKeyDescriptor;
  readonly #url: string;

  constructor(input: {
    fetcher?: KmsFetch;
    identity: string;
    identityToken: string;
    keyId: string;
    keyVersion: string;
    url: string;
  }) {
    this.#fetcher = input.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#identity = input.identity;
    this.#identityToken = input.identityToken;
    this.#key = { kekId: input.keyId, kekVersion: input.keyVersion };
    this.#url = input.url;
  }

  async activeKey(): Promise<KmsKeyDescriptor> {
    const body = await this.#request(
      `/v1/keys/${encodeURIComponent(this.#key.kekId)}/versions/${encodeURIComponent(this.#key.kekVersion)}`,
      { method: "GET" },
    );
    if (
      body.available !== true ||
      body.keyId !== this.#key.kekId ||
      body.keyVersion !== this.#key.kekVersion ||
      !Array.isArray(body.operations) ||
      !body.operations.includes("wrap") ||
      !body.operations.includes("unwrap")
    ) {
      throw new SignerError("KEK_VERSION_UNAVAILABLE");
    }
    return { ...this.#key };
  }

  async wrapDek(input: { dek: Uint8Array; key: KmsKeyDescriptor }): Promise<WrappedDek> {
    if (
      input.dek.length !== 32 ||
      input.key.kekId !== this.#key.kekId ||
      input.key.kekVersion !== this.#key.kekVersion
    ) {
      throw new SignerError("KEK_VERSION_UNAVAILABLE");
    }
    const body = await this.#request("/v1/wrap", {
      body: JSON.stringify({
        keyId: input.key.kekId,
        keyVersion: input.key.kekVersion,
        plaintext: Buffer.from(input.dek).toString("base64"),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (body.keyId !== input.key.kekId || body.keyVersion !== input.key.kekVersion) {
      throw new SignerError("KEK_VERSION_UNAVAILABLE");
    }
    return { ...input.key, wrappedDek: decode(body.ciphertext, null) };
  }

  async unwrapDek(input: WrappedDek): Promise<Buffer> {
    if (input.kekId !== this.#key.kekId || input.kekVersion !== this.#key.kekVersion) {
      throw new SignerError("KEK_VERSION_UNAVAILABLE");
    }
    const body = await this.#request("/v1/unwrap", {
      body: JSON.stringify({
        ciphertext: input.wrappedDek.toString("base64"),
        keyId: input.kekId,
        keyVersion: input.kekVersion,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (body.keyId !== input.kekId || body.keyVersion !== input.kekVersion) {
      throw new SignerError("KEK_VERSION_UNAVAILABLE");
    }
    return decode(body.plaintext, 32);
  }

  async #request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#url}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#identityToken}`,
          "X-LPBOT-Signer-Identity": this.#identity,
          ...init.headers,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    if (!response.ok) {
      throw new SignerError(response.status === 404 ? "KEK_VERSION_UNAVAILABLE" : "SIGNER_UNAVAILABLE", true);
    }
    try {
      const body = record(await response.json());
      if (!body) throw new Error("invalid KMS response");
      return body;
    } catch (error) {
      if (error instanceof SignerError) throw error;
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
  }
}
