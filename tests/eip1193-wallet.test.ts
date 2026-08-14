import {
  Eip1193WalletAdapter,
  WalletProviderError,
  type Eip1193Provider,
} from "../apps/web/src/eip1193-wallet.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

describe("P01-04 EIP-1193 login wallet adapter", () => {
  it("requests access only on connect and rechecks context around personal_sign", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = `0x${"ab".repeat(65)}`;
    const request = vi.fn<Eip1193Provider["request"]>(async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        return [account.address];
      }
      if (method === "eth_chainId") return "0x38";
      if (method === "personal_sign") return signature;
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const adapter = new Eip1193WalletAdapter({ request });

    expect(request).not.toHaveBeenCalled();
    await expect(adapter.connect()).resolves.toEqual({ address: account.address, chainId: 56 });
    await expect(
      adapter.signMessage({
        address: account.address,
        chainId: 56,
        message: "local SIWE fixture",
      }),
    ).resolves.toBe(signature);

    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      "eth_requestAccounts",
      "eth_chainId",
      "eth_accounts",
      "eth_chainId",
      "personal_sign",
      "eth_accounts",
      "eth_chainId",
    ]);
    const requestedMethods = new Set(request.mock.calls.map(([input]) => input.method));
    for (const forbidden of [
      "eth_sendTransaction",
      "eth_signTransaction",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
    ]) {
      expect(requestedMethods.has(forbidden)).toBe(false);
    }
  });

  it("maps provider absence, rejection, interruption and context changes to stable errors", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await expect(new Eip1193WalletAdapter(null).connect()).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });

    const rejected = new Eip1193WalletAdapter({
      request: vi.fn().mockRejectedValue(Object.assign(new Error("rejected"), { code: 4001 })),
    });
    await expect(rejected.connect()).rejects.toMatchObject({ code: "USER_REJECTED" });

    const interrupted = new Eip1193WalletAdapter({
      request: vi.fn().mockRejectedValue(new DOMException("interrupted", "AbortError")),
    });
    await expect(interrupted.connect()).rejects.toMatchObject({ code: "REQUEST_INTERRUPTED" });

    let accountChecks = 0;
    const changed = new Eip1193WalletAdapter({
      request: vi.fn(async ({ method }) => {
        if (method === "eth_accounts") {
          accountChecks += 1;
          return accountChecks === 1
            ? [account.address]
            : ["0x0000000000000000000000000000000000000001"];
        }
        if (method === "eth_chainId") return "0x38";
        if (method === "personal_sign") return `0x${"ab".repeat(65)}`;
        return [account.address];
      }),
    });
    await expect(
      changed.signMessage({ address: account.address, chainId: 56, message: "fixture" }),
    ).rejects.toEqual(expect.any(WalletProviderError));
    await expect(
      changed.signMessage({ address: account.address, chainId: 56, message: "fixture" }),
    ).rejects.toMatchObject({ code: "WALLET_CONTEXT_CHANGED" });
  });
});
