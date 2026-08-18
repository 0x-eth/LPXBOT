import type { CustodyWallet, EvmAddress } from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  MemoryWalletTokenStore,
  WalletAssetService,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateInput,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type ChainManagementAuditInput,
  type ControlledWalletReadProvider,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { encodeAbiParameters, type Hex } from "viem";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-18T10:30:00.000Z");
const userA = "56000000-0000-4000-8000-000000000001";
const userB = "56000000-0000-4000-8000-000000000002";
const customToken = "0x1111111111111111111111111111111111111111" as const;
const eoa = "0x2222222222222222222222222222222222222222" as const;
const wallet: CustodyWallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "API fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "56000000-0000-4000-8000-000000000011",
};

function policy(chainId: number, access: "all" | "off", complete = true): ChainAccessPolicyView {
  return {
    access,
    chainId,
    configurationComplete: complete,
    displayName: `Chain ${chainId}`,
    isDefault: chainId === 56,
    missingConfiguration: complete ? [] : ["execution-adapter"],
    previousAccess: null,
    reason: "Local fixture",
    revision: 1,
    updatedAt: now.toISOString(),
    updatedBy: "local-fixture",
  };
}

class ChainPolicies implements ChainAccessPolicyStore {
  async list(): Promise<ChainAccessPolicyView[]> {
    return [policy(56, "all"), policy(8453, "off"), policy(4663, "off", false)];
  }

  async recordManagementAudit(_input: ChainManagementAuditInput): Promise<void> {}

  async update(_input: ChainAccessPolicyUpdateInput): Promise<ChainAccessPolicyUpdateResult> {
    throw new Error("not used by local fixture");
  }
}

class WalletDirectoryFixture implements WalletDirectory {
  calls = 0;

  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    this.calls += 1;
    return userId === userA && walletId === wallet.walletId ? wallet : null;
  }

  async listWallets(userId: string) {
    this.calls += 1;
    return { items: userId === userA ? [wallet] : [] };
  }
}

class ProviderFixture implements ControlledWalletReadProvider {
  readonly chainId = 56;
  readonly noCode = new Set<EvmAddress>();
  callCount = 0;

  async call(input: { data: Hex; to: EvmAddress }): Promise<Hex> {
    this.callCount += 1;
    const custom = input.to === customToken;
    switch (input.data.slice(0, 10)) {
      case "0x06fdde03":
        return encodeAbiParameters(
          [{ type: "string" }],
          [custom ? "Fixture Dollar" : "Default Token"],
        );
      case "0x95d89b41":
        return encodeAbiParameters([{ type: "string" }], [custom ? "FIX" : "USD"]);
      case "0x313ce567":
        return encodeAbiParameters([{ type: "uint8" }], [custom ? 6 : 18]);
      case "0x70a08231":
        return encodeAbiParameters([{ type: "uint256" }], [custom ? 1_234_567n : 0n]);
      default:
        throw new Error("unexpected local call");
    }
  }

  async getBalance(): Promise<bigint> {
    this.callCount += 1;
    return 2_000_000_000_000_000_000n;
  }

  async getBlockNumber(): Promise<bigint> {
    this.callCount += 1;
    return 48_100_000n;
  }

  async getCode(address: EvmAddress): Promise<Hex> {
    this.callCount += 1;
    return this.noCode.has(address) ? "0x" : "0x6000";
  }

  async getUsdPrice(tokenAddress: EvmAddress | null) {
    this.callCount += 1;
    return tokenAddress === null ? { observedAt: now, priceDecimal: "300" } : null;
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const provider = new ProviderFixture();
  const providerRegistry = {
    calls: 0,
    get(chainId: number) {
      this.calls += 1;
      return chainId === 56 ? provider : null;
    },
  };
  const directory = new WalletDirectoryFixture();
  const app = buildApiApp({
    chainPolicyStore: new ChainPolicies(),
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    walletAssets: new WalletAssetService({
      now: () => now,
      providers: providerRegistry,
      tokens: new MemoryWalletTokenStore(),
    }),
    walletDirectory: directory,
  });
  apps.push(app);
  return { app, directory, provider, providerRegistry, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-05 wallet asset API", () => {
  it("requires authentication and performs complete token/balance/receive CRUD with no-store", async () => {
    const { app, tokenA } = await fixture();
    expect(
      (await app.inject({ method: "GET", url: `/api/wallets/${wallet.walletId}/balances` }))
        .statusCode,
    ).toBe(401);

    const initial = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.walletId}/tokens?chainId=56`,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(initial.json().data.items).toHaveLength(2);

    const imported = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { chainId: 56, tokenAddress: customToken },
      url: `/api/wallets/${wallet.walletId}/tokens`,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data).toMatchObject({
      chainId: 56,
      decimals: 6,
      default: false,
      symbol: "FIX",
      tokenAddress: customToken,
    });

    const balances = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.walletId}/balances?chainId=56`,
    });
    expect(balances.statusCode).toBe(200);
    expect(balances.json().data).toMatchObject({
      blockNumberDecimal: "48100000",
      totalUsdValueDecimal: null,
      walletId: wallet.walletId,
    });
    expect(balances.json().data.items[0]).toMatchObject({
      balanceBaseUnit: "2000000000000000000",
      balanceDecimal: "2",
      usdValueDecimal: "600",
    });

    const receive = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.walletId}/receive?chainId=56&tokenAddress=${customToken}&amountDecimal=1.234567`,
    });
    expect(receive.statusCode).toBe(200);
    expect(receive.json().data).toMatchObject({
      amountBaseUnit: "1234567",
      eip681: `ethereum:${customToken}@56/transfer?address=${wallet.address}&uint256=1234567`,
    });

    const deleted = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      url: `/api/wallets/${wallet.walletId}/tokens/${customToken}?chainId=56`,
    });
    expect(deleted.json().data).toEqual({ deleted: true });
    const absent = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      url: `/api/wallets/${wallet.walletId}/tokens/${customToken}?chainId=56`,
    });
    expect(absent.json().data).toEqual({ deleted: false });
  });

  it("rejects EOA, duplicate/default tokens, malformed requests, and cross-user wallet reads", async () => {
    const { app, provider, tokenA, tokenB } = await fixture();
    provider.noCode.add(eoa);
    const eoaResponse = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { chainId: 56, tokenAddress: eoa },
      url: `/api/wallets/${wallet.walletId}/tokens`,
    });
    expect(eoaResponse.statusCode).toBe(400);
    expect(eoaResponse.json().error.code).toBe("TOKEN_NOT_CONTRACT");

    const first = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { chainId: 56, tokenAddress: customToken },
      url: `/api/wallets/${wallet.walletId}/tokens`,
    });
    expect(first.statusCode).toBe(201);
    const duplicate = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { chainId: 56, tokenAddress: customToken },
      url: `/api/wallets/${wallet.walletId}/tokens`,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("TOKEN_ALREADY_EXISTS");

    const immutable = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      url: `/api/wallets/${wallet.walletId}/tokens/0x55d398326f99059ff775485246999027b3197955?chainId=56`,
    });
    expect(immutable.statusCode).toBe(409);
    expect(immutable.json().error.code).toBe("DEFAULT_TOKEN_IMMUTABLE");

    const malformed = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { chainId: 56, extra: true, tokenAddress: customToken },
      url: `/api/wallets/${wallet.walletId}/tokens`,
    });
    expect(malformed.statusCode).toBe(400);
    const isolated = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: `/api/wallets/${wallet.walletId}/balances?chainId=56`,
    });
    expect(isolated.statusCode).toBe(404);
    expect(isolated.json().error.code).toBe("WALLET_NOT_FOUND");
  });

  it("rejects disallowed or incomplete chains before wallet/provider access", async () => {
    const { app, directory, providerRegistry, tokenA } = await fixture();
    for (const chainId of [8453, 4663, 999_999]) {
      const calls = { directory: directory.calls, provider: providerRegistry.calls };
      const response = await app.inject({
        headers: auth(tokenA),
        method: "GET",
        url: `/api/wallets/${wallet.walletId}/balances?chainId=${chainId}`,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CHAIN_NOT_ALLOWED");
      expect(directory.calls).toBe(calls.directory);
      expect(providerRegistry.calls).toBe(calls.provider);
    }
  });
});
