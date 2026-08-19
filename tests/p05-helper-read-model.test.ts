import type { HelperResidualPage } from "../packages/api-contract/src/index.js";
import {
  HELPER_OWNER_READ_ABI,
  MemoryWalletHelperReadStore,
  WalletHelperReadService,
} from "../apps/api/src/index.js";
import type {
  PositionReadLog,
  PositionReadRpc,
  PositionReadSnapshot,
} from "../packages/chain-adapters/src/index.js";
import type { BscHelperReadRegistry } from "../packages/chain-registry/src/index.js";
import {
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

const userId = "64000000-0000-4000-8000-000000000001";
const walletId = "64000000-0000-4000-8000-000000000011";
const bindingId = "64000000-0000-4000-8000-000000000021";
const walletAddress = "0x1111111111111111111111111111111111111111" as const;
const helperAddress = "0x2222222222222222222222222222222222222222" as const;
const otherAddress = "0x3333333333333333333333333333333333333333" as const;
const snapshot: PositionReadSnapshot = {
  blockHash: `0x${"ab".repeat(32)}`,
  blockNumber: "116718500",
  blockTimestamp: "2026-08-19T02:00:00.000Z",
};
const ownerSelector = "0x8da5cb5b" as const;
const operationSelector = "0x12345678" as const;

function runtime(...selectors: readonly Hex[]): Hex {
  return `0x${selectors.map((selector) => `63${selector.slice(2)}14`).join("")}00` as Hex;
}

const v1Code = runtime(ownerSelector, "0x11112222");
const v2Code = runtime(ownerSelector, operationSelector);

const registry: BscHelperReadRegistry = {
  chainId: 56,
  currentVersion: "fixture-v2",
  executionEnabled: false,
  registryVersion: "p05-bsc-execution-v1",
  versions: [
    {
      chainId: 56,
      helperVersion: "fixture-v1",
      ownerSelector,
      registryVersion: "p05-bsc-execution-v1",
      requiredSelectors: [ownerSelector, "0x11112222"],
      runtimeCodeHash: keccak256(v1Code),
    },
    {
      chainId: 56,
      helperVersion: "fixture-v2",
      ownerSelector,
      registryVersion: "p05-bsc-execution-v1",
      requiredSelectors: [ownerSelector, operationSelector],
      runtimeCodeHash: keccak256(v2Code),
    },
  ],
  versionsComparableAcrossChains: false,
};

class HelperRpc implements PositionReadRpc {
  readonly calls: Array<{ blockNumber: string; data: Hex; to: Address }> = [];
  readonly codeReads: Array<{ address: Address; blockNumber: string }> = [];
  blockReads: Array<string | "latest"> = [];
  code = v2Code;
  owner: Address = walletAddress;
  failOwner = false;
  reorg = false;

  async call(input: { blockNumber: string; data: Hex; to: Address }): Promise<Hex> {
    this.calls.push(input);
    if (this.failOwner) throw new Error("fixture provider failure with secret URL");
    expect(input.data).toBe(
      encodeFunctionData({ abi: HELPER_OWNER_READ_ABI, functionName: "owner" }),
    );
    return encodeFunctionResult({
      abi: HELPER_OWNER_READ_ABI,
      functionName: "owner",
      result: this.owner,
    });
  }

  async getBalance(): Promise<bigint> {
    return 0n;
  }

  async getBlock(blockNumber: string | "latest"): Promise<PositionReadSnapshot> {
    this.blockReads.push(blockNumber);
    return this.reorg && this.blockReads.length > 1
      ? { ...snapshot, blockHash: `0x${"cd".repeat(32)}` }
      : snapshot;
  }

  async getCode(address: Address, blockNumber: string): Promise<Hex> {
    this.codeReads.push({ address, blockNumber });
    return this.code;
  }

  async getLogs(): Promise<readonly PositionReadLog[]> {
    return [];
  }
}

function binding(version = "fixture-v2") {
  return {
    bindingId,
    boundAt: new Date("2026-08-19T01:00:00.000Z"),
    chainId: 56 as const,
    helperAddress,
    helperVersion: version,
    registryVersion: "p05-bsc-execution-v1",
    source: "deployment-result" as const,
    userId,
    walletId,
  };
}

function statusInput() {
  return { chainId: 56 as const, userId, walletAddress, walletId };
}

function residualPage(): HelperResidualPage {
  return {
    allowlistVersion: "fixture-allowlist-v1",
    chainId: 56,
    coverage: {
      allowlistComplete: true,
      complete: true,
      missingSources: [],
      positionTokensComplete: true,
      walletTokenRegistryComplete: true,
    },
    cursor: null,
    helperAddress,
    items: [
      {
        amountBaseUnit: "1",
        assetId: "native:56",
        chainId: 56,
        kind: "native",
        tokenAddress: null,
      },
    ],
    registryVersion: "p05-bsc-execution-v1",
    scanId: "64000000-0000-4000-8000-000000000031",
    scannedAt: "2026-08-19T02:00:01.000Z",
    snapshot: { ...snapshot, digest: `0x${"ef".repeat(32)}` },
    state: "ready",
    walletId,
  };
}

describe("P05-02 wallet Helper identity and health read model", () => {
  it("returns undeployed without touching RPC when no trusted binding exists", async () => {
    const rpc = new HelperRpc();
    const store = new MemoryWalletHelperReadStore();
    const service = new WalletHelperReadService({ registry, rpc, store });
    await expect(service.status(statusInput())).resolves.toEqual({
      address: null,
      chainId: 56,
      failures: [],
      helperVersion: null,
      owner: walletAddress,
      registryVersion: "p05-bsc-execution-v1",
      state: "undeployed",
      verification: null,
      walletId,
    });
    expect(rpc.blockReads).toEqual([]);
    expect(store.verifications()).toEqual([]);
  });

  it("verifies active address, owner, code hash, selectors, and version at one canonical block", async () => {
    const rpc = new HelperRpc();
    const store = new MemoryWalletHelperReadStore();
    await store.recordTrustedBinding(binding());
    const result = await new WalletHelperReadService({ registry, rpc, store }).status(statusInput());
    expect(result).toMatchObject({
      address: helperAddress,
      failures: [],
      helperVersion: "fixture-v2",
      owner: walletAddress,
      state: "active",
      verification: {
        blockHash: snapshot.blockHash,
        blockNumber: snapshot.blockNumber,
        checks: {
          address: true,
          owner: true,
          runtimeCodeHash: true,
          selectorSet: true,
          version: true,
        },
        observedOwner: walletAddress,
        observedRuntimeCodeHash: keccak256(v2Code),
        observedSelectors: [operationSelector, ownerSelector],
      },
    });
    expect(rpc.calls).toEqual([
      expect.objectContaining({ blockNumber: snapshot.blockNumber, to: helperAddress }),
    ]);
    expect(rpc.codeReads).toEqual([{ address: helperAddress, blockNumber: snapshot.blockNumber }]);
    expect(rpc.blockReads).toEqual(["latest", snapshot.blockNumber]);
    expect(store.verifications()).toHaveLength(1);
    expect(Object.isFrozen(result.verification)).toBe(true);
  });

  it("degrades on owner, code, selector, version, provider, and canonical mismatches", async () => {
    const cases: Array<{
      configure(rpc: HelperRpc): void;
      expected: string;
      version?: string;
    }> = [
      { configure: (rpc) => void (rpc.owner = otherAddress), expected: "owner-mismatch" },
      { configure: (rpc) => void (rpc.code = "0x6000"), expected: "runtime-code-hash-mismatch" },
      {
        configure: (rpc) => void (rpc.code = runtime(ownerSelector)),
        expected: "selector-set-mismatch",
      },
      { configure: () => undefined, expected: "version-unregistered", version: "unknown-v9" },
      { configure: (rpc) => void (rpc.failOwner = true), expected: "provider-read-failed" },
      { configure: (rpc) => void (rpc.reorg = true), expected: "provider-read-failed" },
    ];
    for (const fixture of cases) {
      const rpc = new HelperRpc();
      fixture.configure(rpc);
      const store = new MemoryWalletHelperReadStore();
      await store.recordTrustedBinding(binding(fixture.version));
      const result = await new WalletHelperReadService({ registry, rpc, store }).status(
        statusInput(),
      );
      expect(result.state).toBe("degraded");
      expect(result.failures).toContain(fixture.expected);
      expect(store.verifications()).toHaveLength(1);
    }
  });

  it("interprets an older valid version only within chain 56 as superseded", async () => {
    const rpc = new HelperRpc();
    rpc.code = v1Code;
    const store = new MemoryWalletHelperReadStore();
    await store.recordTrustedBinding(binding("fixture-v1"));
    const result = await new WalletHelperReadService({ registry, rpc, store }).status(statusInput());
    expect(result).toMatchObject({ helperVersion: "fixture-v1", state: "superseded" });
    expect(registry.versionsComparableAcrossChains).toBe(false);
  });

  it("reports residual when the latest bounded residual snapshot has nonzero assets", async () => {
    const rpc = new HelperRpc();
    const store = new MemoryWalletHelperReadStore();
    await store.recordTrustedBinding(binding());
    await store.appendResidualSnapshot({
      idempotencyKey: "helper-status-residual-fixture",
      page: residualPage(),
      userId,
    });
    const result = await new WalletHelperReadService({ registry, rpc, store }).status(statusInput());
    expect(result.state).toBe("residual");
  });

  it("accepts only internal binding sources and makes repeated identity recording idempotent", async () => {
    const store = new MemoryWalletHelperReadStore();
    await expect(store.recordTrustedBinding(binding())).resolves.toMatchObject({ bindingId });
    await expect(store.recordTrustedBinding(binding())).resolves.toMatchObject({ bindingId });
    await expect(
      store.recordTrustedBinding({ ...binding(), source: "client" as "deployment-result" }),
    ).rejects.toThrow(/HELPER_BINDING_SOURCE_INVALID/u);
    await expect(
      store.recordTrustedBinding({ ...binding(), helperAddress: otherAddress }),
    ).rejects.toThrow(/HELPER_BINDING_CONFLICT/u);
  });
});
