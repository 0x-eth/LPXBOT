import { getAddress } from "viem";

export interface Eip1193RequestArguments {
  method: string;
  params?: readonly unknown[] | object;
}

export interface Eip1193Provider {
  request(arguments_: Eip1193RequestArguments): Promise<unknown>;
}

export type WalletProviderErrorCode =
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_UNAVAILABLE"
  | "REQUEST_INTERRUPTED"
  | "SIGNATURE_INVALID"
  | "USER_REJECTED"
  | "WALLET_CONTEXT_CHANGED";

export class WalletProviderError extends Error {
  readonly code: WalletProviderErrorCode;

  constructor(code: WalletProviderErrorCode) {
    super(code);
    this.code = code;
    this.name = "WalletProviderError";
  }
}

export interface ConnectedLoginWallet {
  address: `0x${string}`;
  chainId: number;
}

export interface SignLoginWalletMessageInput extends ConnectedLoginWallet {
  message: string;
}

export interface LoginWalletProviderAdapter {
  connect(): Promise<ConnectedLoginWallet>;
  signMessage(input: SignLoginWalletMessageInput): Promise<`0x${string}`>;
}

function providerError(error: unknown): WalletProviderError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 4001
  ) {
    return new WalletProviderError("USER_REJECTED");
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new WalletProviderError("REQUEST_INTERRUPTED");
  }
  if (error instanceof WalletProviderError) return error;
  return new WalletProviderError("PROVIDER_INVALID_RESPONSE");
}

export class Eip1193WalletAdapter implements LoginWalletProviderAdapter {
  readonly #provider: Eip1193Provider | null;

  constructor(provider: Eip1193Provider | null) {
    this.#provider = provider;
  }

  async connect(): Promise<ConnectedLoginWallet> {
    const provider = this.#requiredProvider();
    try {
      const address = await this.#requestAddress(provider, "eth_requestAccounts");
      const chainId = await this.#requestChainId(provider);
      return { address, chainId };
    } catch (error) {
      throw providerError(error);
    }
  }

  async signMessage(input: SignLoginWalletMessageInput): Promise<`0x${string}`> {
    const provider = this.#requiredProvider();
    try {
      await this.#assertContext(provider, input);
      const signature = await provider.request({
        method: "personal_sign",
        params: [input.message, input.address],
      });
      if (
        typeof signature !== "string" ||
        !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/u.test(signature)
      ) {
        throw new WalletProviderError("SIGNATURE_INVALID");
      }
      await this.#assertContext(provider, input);
      return signature as `0x${string}`;
    } catch (error) {
      throw providerError(error);
    }
  }

  async #assertContext(provider: Eip1193Provider, expected: ConnectedLoginWallet): Promise<void> {
    const address = await this.#requestAddress(provider, "eth_accounts");
    const chainId = await this.#requestChainId(provider);
    if (address.toLowerCase() !== expected.address.toLowerCase() || chainId !== expected.chainId) {
      throw new WalletProviderError("WALLET_CONTEXT_CHANGED");
    }
  }

  async #requestAddress(
    provider: Eip1193Provider,
    method: "eth_accounts" | "eth_requestAccounts",
  ): Promise<`0x${string}`> {
    const accounts = await provider.request({ method });
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
      throw new WalletProviderError("PROVIDER_INVALID_RESPONSE");
    }
    try {
      return getAddress(accounts[0]);
    } catch {
      throw new WalletProviderError("PROVIDER_INVALID_RESPONSE");
    }
  }

  async #requestChainId(provider: Eip1193Provider): Promise<number> {
    const value = await provider.request({ method: "eth_chainId" });
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/u.test(value)) {
      throw new WalletProviderError("PROVIDER_INVALID_RESPONSE");
    }
    const chainId = Number(BigInt(value));
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new WalletProviderError("PROVIDER_INVALID_RESPONSE");
    }
    return chainId;
  }

  #requiredProvider(): Eip1193Provider {
    if (!this.#provider) throw new WalletProviderError("PROVIDER_UNAVAILABLE");
    return this.#provider;
  }
}

export function browserEip1193Provider(): Eip1193Provider | null {
  const ethereum = (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum;
  if (
    typeof ethereum !== "object" ||
    ethereum === null ||
    !("request" in ethereum) ||
    typeof (ethereum as { request?: unknown }).request !== "function"
  ) {
    return null;
  }
  return ethereum as Eip1193Provider;
}

export const browserLoginWalletAdapter = new Eip1193WalletAdapter(browserEip1193Provider());
