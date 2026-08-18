import type { CustodyWallet, EvmAddress } from "../packages/api-contract/src/index.js";
import {
  MemoryWalletTokenStore,
  WalletAssetError,
  WalletAssetService,
  type ControlledWalletReadProvider,
  type WalletUsdPrice,
} from "../apps/api/src/index.js";
import { encodeAbiParameters, type Hex } from "viem";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-18T10:00:00.000Z");
const wallet: CustodyWallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Read fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "54000000-0000-4000-8000-000000000011",
};
const userId = "54000000-0000-4000-8000-000000000001";
const customToken = "0x1111111111111111111111111111111111111111" as const;
const conflictToken = "0x2222222222222222222222222222222222222222" as const;
const eoa = "0x3333333333333333333333333333333333333333" as const;
const bscUsdt = "0x55d398326f99059ff775485246999027b3197955" as const;
const bscUsdc = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" as const;

interface Metadata {
  decimals: number;
  name: string;
  symbol: string;
}

class ControlledProviderFixture implements ControlledWalletReadProvider {
  readonly chainId = 56;
  readonly balances = new Map<EvmAddress, bigint>();
  readonly codes = new Map<EvmAddress, Hex>();
  readonly metadata = new Map<EvmAddress, Metadata>();
  readonly prices = new Map<string, WalletUsdPrice>();
  blockNumber = 48_000_123n;
  nativeBalance = 1_234_567_890_123_456_789n;
  failCalls = false;
  malformedAddress: EvmAddress | null = null;

  async call(input: { data: Hex; to: EvmAddress }): Promise<Hex> {
    if (this.failCalls) throw new Error("LOCAL_PROVIDER_UNAVAILABLE");
    if (this.malformedAddress === input.to) return "0x01";
    const metadata = this.metadata.get(input.to) ?? {
      decimals: 18,
      name: input.to === bscUsdt ? "Tether USD" : "USD Coin",
      symbol: input.to === bscUsdt ? "USDT" : "USDC",
    };
    switch (input.data.slice(0, 10)) {
      case "0x06fdde03":
        return encodeAbiParameters([{ type: "string" }], [metadata.name]);
      case "0x95d89b41":
        return encodeAbiParameters([{ type: "string" }], [metadata.symbol]);
      case "0x313ce567":
        return encodeAbiParameters([{ type: "uint8" }], [metadata.decimals]);
      case "0x70a08231":
        return encodeAbiParameters([{ type: "uint256" }], [this.balances.get(input.to) ?? 0n]);
      default:
        throw new Error("UNEXPECTED_LOCAL_CALL");
    }
  }

  async getBalance(): Promise<bigint> {
    return this.nativeBalance;
  }

  async getBlockNumber(): Promise<bigint> {
    return this.blockNumber;
  }

  async getCode(address: EvmAddress): Promise<Hex> {
    return this.codes.get(address) ?? "0x6000";
  }

  async getUsdPrice(tokenAddress: EvmAddress | null): Promise<WalletUsdPrice | null> {
    return this.prices.get(tokenAddress ?? "native") ?? null;
  }
}

function fixture() {
  const provider = new ControlledProviderFixture();
  provider.metadata.set(customToken, { decimals: 6, name: "Fixture Dollar", symbol: "FIX" });
  provider.metadata.set(conflictToken, { decimals: 8, name: "Changed Token", symbol: "NEW" });
  const tokens = new MemoryWalletTokenStore();
  const service = new WalletAssetService({
    now: () => now,
    priceMaximumAgeMs: 300_000,
    providers: { get: (chainId) => (chainId === 56 ? provider : null) },
    tokens,
  });
  return { provider, service, tokens };
}

describe("P04-05 wallet asset read model", () => {
  it("keeps balances, prices and valuations as exact strings with explicit stale/missing states", async () => {
    const { provider, service } = fixture();
    await service.importToken({ chainId: 56, tokenAddress: customToken, userId, walletId: wallet.walletId });
    provider.balances.set(customToken, 1_234_567n);
    provider.prices.set("native", { observedAt: now, priceDecimal: "300.12" });
    provider.prices.set(bscUsdt, {
      observedAt: new Date(now.getTime() - 300_001),
      priceDecimal: "1.0001",
    });
    provider.prices.set(customToken, { observedAt: now, priceDecimal: "2.5" });

    const snapshot = await service.balances({ chainId: 56, userId, wallet });
    expect(snapshot).toMatchObject({
      blockNumberDecimal: "48000123",
      chainId: 56,
      readAt: now.toISOString(),
      totalUsdValueDecimal: null,
      walletId: wallet.walletId,
    });
    expect(snapshot.items[0]).toMatchObject({
      balanceBaseUnit: "1234567890123456789",
      balanceDecimal: "1.234567890123456789",
      priceStatus: "current",
      usdPriceDecimal: "300.12",
      usdValueDecimal: "370.51851851851851851468",
    });
    expect(snapshot.items.find(({ tokenAddress }) => tokenAddress === bscUsdt)).toMatchObject({
      priceStatus: "stale",
      usdPriceDecimal: "1.0001",
      usdValueDecimal: null,
    });
    expect(snapshot.items.find(({ tokenAddress }) => tokenAddress === bscUsdc)).toMatchObject({
      priceStatus: "missing",
      usdPriceDecimal: null,
      usdValueDecimal: null,
    });
    expect(snapshot.items.find(({ tokenAddress }) => tokenAddress === customToken)).toMatchObject({
      balanceBaseUnit: "1234567",
      balanceDecimal: "1.234567",
      priceStatus: "current",
      usdValueDecimal: "3.0864175",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/NaN|Infinity/iu);
  });

  it("validates code and strict ERC-20 metadata, then rejects duplicates and conflicts", async () => {
    const { provider, service, tokens } = fixture();
    provider.codes.set(eoa, "0x");
    await expect(
      service.importToken({ chainId: 56, tokenAddress: eoa, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "TOKEN_NOT_CONTRACT" });

    provider.metadata.set(eoa, { decimals: 18, name: "Bad\nToken", symbol: "BAD" });
    provider.codes.set(eoa, "0x6000");
    await expect(
      service.importToken({ chainId: 56, tokenAddress: eoa, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "TOKEN_METADATA_INVALID" });

    await expect(
      service.importToken({ chainId: 56, tokenAddress: customToken, userId, walletId: wallet.walletId }),
    ).resolves.toMatchObject({ decimals: 6, default: false, symbol: "FIX" });
    await expect(
      service.importToken({ chainId: 56, tokenAddress: customToken, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "TOKEN_ALREADY_EXISTS" });

    await tokens.insert({
      chainId: 56,
      createdAt: now,
      decimals: 8,
      default: false,
      name: "Stored Token",
      symbol: "OLD",
      tokenAddress: conflictToken,
      userId,
      walletId: wallet.walletId,
    });
    await expect(
      service.importToken({ chainId: 56, tokenAddress: conflictToken, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "TOKEN_METADATA_CONFLICT" });

    await expect(
      service.importToken({ chainId: 56, tokenAddress: bscUsdt, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "DEFAULT_TOKEN_IMMUTABLE" });
    await expect(
      service.deleteToken({ chainId: 56, tokenAddress: bscUsdt, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "DEFAULT_TOKEN_IMMUTABLE" });
    await expect(
      service.deleteToken({ chainId: 56, tokenAddress: customToken, userId, walletId: wallet.walletId }),
    ).resolves.toBe(true);
    expect((await service.listTokens({ chainId: 56, userId, walletId: wallet.walletId })).items).not.toContainEqual(
      expect.objectContaining({ tokenAddress: customToken }),
    );
  });

  it("builds canonical EIP-681 native and ERC-20 receive requests without floating-point conversion", async () => {
    const { service } = fixture();
    await service.importToken({ chainId: 56, tokenAddress: customToken, userId, walletId: wallet.walletId });

    await expect(
      service.receive({ amountDecimal: "1.000000000000000001", chainId: 56, userId, wallet }),
    ).resolves.toEqual({
      address: wallet.address,
      amountBaseUnit: "1000000000000000001",
      amountDecimal: "1.000000000000000001",
      chainId: 56,
      eip681: `ethereum:${wallet.address}@56?value=1000000000000000001`,
      tokenAddress: null,
      walletId: wallet.walletId,
    });
    await expect(
      service.receive({
        amountDecimal: "12.345678",
        chainId: 56,
        tokenAddress: customToken,
        userId,
        wallet,
      }),
    ).resolves.toMatchObject({
      amountBaseUnit: "12345678",
      eip681: `ethereum:${customToken}@56/transfer?address=${wallet.address}&uint256=12345678`,
      tokenAddress: customToken,
    });
    await expect(
      service.receive({
        amountDecimal: "0.0000001",
        chainId: 56,
        tokenAddress: customToken,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("maps controlled-provider call failures and malformed balance responses to read unavailability", async () => {
    const { provider, service } = fixture();
    provider.failCalls = true;
    await expect(service.balances({ chainId: 56, userId, wallet })).rejects.toEqual(
      expect.objectContaining<Partial<WalletAssetError>>({ code: "CHAIN_READ_UNAVAILABLE" }),
    );

    provider.failCalls = false;
    provider.malformedAddress = bscUsdt;
    await expect(service.balances({ chainId: 56, userId, wallet })).rejects.toMatchObject({
      code: "CHAIN_READ_UNAVAILABLE",
    });
  });
});
