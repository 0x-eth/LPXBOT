import type { OkxKmsClient, OkxKmsKeyDescriptor } from "./types.js";
import { OkxConnectorError } from "./errors.js";

interface KmsResponse {
  ciphertext?: unknown;
  plaintext?: unknown;
}

export class HttpOkxKmsClient implements OkxKmsClient {
  readonly #fetch: typeof fetch;
  readonly #identityToken: string;
  readonly #key: OkxKmsKeyDescriptor;
  readonly #url: string;

  constructor(input: {
    fetch?: typeof fetch;
    identityToken: string;
    keyId: string;
    keyVersion: string;
    url: string;
  }) {
    this.#fetch = input.fetch ?? fetch;
    this.#identityToken = input.identityToken;
    this.#key = { kekId: input.keyId, kekVersion: input.keyVersion };
    this.#url = input.url.replace(/\/+$/u, "");
  }

  async activeKey(): Promise<OkxKmsKeyDescriptor> {
    return { ...this.#key };
  }

  async wrapDek(input: { dek: Uint8Array; key: OkxKmsKeyDescriptor }): Promise<Buffer> {
    this.#assertKey(input.key);
    const response = await this.#call("encrypt", {
      plaintext: Buffer.from(input.dek).toString("base64"),
    });
    if (typeof response.ciphertext !== "string")
      throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    return Buffer.from(response.ciphertext, "base64");
  }

  async unwrapDek(input: OkxKmsKeyDescriptor & { wrappedDek: Uint8Array }): Promise<Buffer> {
    this.#assertKey(input);
    const response = await this.#call("decrypt", {
      ciphertext: Buffer.from(input.wrappedDek).toString("base64"),
    });
    if (typeof response.plaintext !== "string")
      throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    return Buffer.from(response.plaintext, "base64");
  }

  async #call(
    operation: "decrypt" | "encrypt",
    body: Record<string, string>,
  ): Promise<KmsResponse> {
    try {
      const response = await this.#fetch(
        `${this.#url}/v1/keys/${encodeURIComponent(this.#key.kekId)}/versions/${encodeURIComponent(this.#key.kekVersion)}:${operation}`,
        {
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${this.#identityToken}`,
            "Cache-Control": "no-store",
            "Content-Type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) throw new Error("KMS rejected request");
      return (await response.json()) as KmsResponse;
    } catch {
      throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    }
  }

  #assertKey(key: OkxKmsKeyDescriptor): void {
    if (key.kekId !== this.#key.kekId || key.kekVersion !== this.#key.kekVersion) {
      throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    }
  }
}
