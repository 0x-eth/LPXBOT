import { addressBookSecretMediaType } from "../packages/api-contract/src/index.js";
import {
  WalletReadClient,
  WalletReadRequestError,
  parseAddressBookPage,
  parseWalletBalanceSnapshot,
  parseWalletReceiveContent,
  parseWalletTokenPage,
} from "../apps/web/src/wallet-read-client.js";
import { describe, expect, it, vi } from "vitest";

const walletId = "55000000-0000-4000-8000-000000000011";
const entryId = "55000000-0000-4000-8000-000000000021";
const address = "0x1111111111111111111111111111111111111111";
const tokenAddress = "0x2222222222222222222222222222222222222222";
const token = {
  chainId: 56,
  decimals: 6,
  default: false,
  name: "Fixture Dollar",
  symbol: "FIX",
  tokenAddress,
};
const nativeBalance = {
  assetType: "native",
  balanceBaseUnit: "1000000000000000001",
  balanceDecimal: "1.000000000000000001",
  decimals: 18,
  default: true,
  name: "BNB",
  priceStatus: "current",
  symbol: "BNB",
  tokenAddress: null,
  usdPriceDecimal: "300.12",
  usdValueDecimal: "300.12000000000000030012",
};
const balanceSnapshot = {
  address,
  blockNumberDecimal: "48000001",
  chainId: 56,
  items: [nativeBalance],
  readAt: "2026-08-18T10:00:00.000Z",
  totalUsdValueDecimal: nativeBalance.usdValueDecimal,
  walletId,
};
const receive = {
  address,
  amountBaseUnit: "1234567",
  amountDecimal: "1.234567",
  chainId: 56,
  eip681: `ethereum:${tokenAddress}@56/transfer?address=${address}&uint256=1234567`,
  tokenAddress,
  walletId,
};
const entry = {
  address: tokenAddress,
  category: "exchange",
  chainId: 56,
  createdAt: "2026-08-18T10:00:00.000Z",
  entryId,
  label: "Fixture exchange",
  note: "Local only",
  revision: 1,
  updatedAt: "2026-08-18T10:00:00.000Z",
};

function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: "wallet-read-fixture", success: true }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("P04-05 strict wallet read browser client", () => {
  it("parses exact string balances and rejects floating or internally inconsistent values", () => {
    expect(parseWalletBalanceSnapshot(balanceSnapshot)).toEqual(balanceSnapshot);
    for (const malformed of [
      { ...balanceSnapshot, blockNumberDecimal: 48_000_001 },
      { ...balanceSnapshot, items: [{ ...nativeBalance, balanceBaseUnit: 1_000_000 }] },
      {
        ...balanceSnapshot,
        items: [{ ...nativeBalance, priceStatus: "stale", usdValueDecimal: "300.12" }],
      },
      {
        ...balanceSnapshot,
        items: [{ ...nativeBalance, assetType: "native", tokenAddress }],
      },
      { ...balanceSnapshot, totalUsdValueDecimal: 300.12 },
    ]) {
      expect(() => parseWalletBalanceSnapshot(malformed)).toThrowError(WalletReadRequestError);
    }
  });

  it("rejects duplicate or cross-chain tokens and non-canonical EIP-681 content", () => {
    expect(parseWalletTokenPage({ chainId: 56, items: [token], walletId })).toEqual({
      chainId: 56,
      items: [token],
      walletId,
    });
    expect(() =>
      parseWalletTokenPage({ chainId: 56, items: [token, token], walletId }),
    ).toThrowError(WalletReadRequestError);
    expect(() =>
      parseWalletTokenPage({ chainId: 56, items: [{ ...token, chainId: 1 }], walletId }),
    ).toThrowError(WalletReadRequestError);

    expect(parseWalletReceiveContent(receive)).toEqual(receive);
    expect(() =>
      parseWalletReceiveContent({ ...receive, eip681: `ethereum:${address}@56?value=1234567` }),
    ).toThrowError(WalletReadRequestError);
    expect(() =>
      parseWalletReceiveContent({ ...receive, amountBaseUnit: "1234568" }),
    ).toThrowError(WalletReadRequestError);
  });

  it("enforces address classification pointer semantics", () => {
    const ownWallet = { address, name: "Mine", walletId };
    const base = { chainId: 56, entries: [entry], ownWallets: [ownWallet] };
    expect(
      parseAddressBookPage({
        ...base,
        classification: { address, entryId: null, kind: "own-wallet", walletId },
      }).classification,
    ).toMatchObject({ kind: "own-wallet", walletId });
    expect(
      parseAddressBookPage({
        ...base,
        classification: {
          address: tokenAddress,
          entryId,
          kind: "known-external",
          walletId: null,
        },
      }).classification,
    ).toMatchObject({ entryId, kind: "known-external" });

    for (const classification of [
      { address, entryId, kind: "own-wallet", walletId },
      { address: tokenAddress, entryId: null, kind: "known-external", walletId: null },
      { address: tokenAddress, entryId, kind: "new-external", walletId: null },
    ]) {
      expect(() => parseAddressBookPage({ ...base, classification })).toThrowError(
        WalletReadRequestError,
      );
    }
  });

  it("uses no-store authenticated requests and zeroizes address-book password ingress", async () => {
    const captured: Array<{ bytes: Uint8Array; during: string }> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input) === "/api/address-book") {
        const bytes = init?.body as unknown as Uint8Array;
        captured.push({ bytes, during: new TextDecoder().decode(bytes) });
        return success(entry, 201);
      }
      if (String(input).includes("/balances")) return success(balanceSnapshot);
      if (String(input).includes("/tokens")) {
        return success({ chainId: 56, items: [token], walletId });
      }
      throw new Error("unexpected fixture request");
    });
    const client = new WalletReadClient(fetcher);
    await expect(client.balances(walletId, 56)).resolves.toEqual(balanceSnapshot);
    await expect(client.tokens(walletId, 56)).resolves.toEqual({
      chainId: 56,
      items: [token],
      walletId,
    });
    await expect(
      client.createAddressBookEntry({
        address: tokenAddress,
        category: "exchange",
        chainId: 56,
        label: "Fixture exchange",
        note: "Local only",
        password: "synthetic-security-password",
      }),
    ).resolves.toEqual(entry);

    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store", credentials: "include" });
    }
    expect(fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({
      "Content-Type": addressBookSecretMediaType,
    });
    expect(captured[0]!.during).toContain("synthetic-security-password");
    expect(captured[0]!.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("preserves only stable API error fields and never retries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CHAIN_NOT_ALLOWED",
            message: "provider URL and secret details",
            retryable: false,
          },
          success: false,
        }),
        { status: 403 },
      ),
    );
    const client = new WalletReadClient(fetcher);
    await expect(client.balances(walletId, 56)).rejects.toEqual(
      expect.objectContaining<Partial<WalletReadRequestError>>({
        code: "CHAIN_NOT_ALLOWED",
        retryable: false,
        status: 403,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
