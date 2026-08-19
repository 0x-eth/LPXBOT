import { execFileSync } from "node:child_process";

import { P05_BSC_LOCAL_EXECUTION_REGISTRY } from "../../packages/chain-registry/src/index.js";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_ANVIL_INTEGRATION === "1";

interface LocalSnapshot {
  deploymentOrder: Array<{
    abiHash: string;
    address: string;
    contract: string;
    runtimeCodeHash: string;
  }>;
  executionCounters: {
    localChainWrites: number;
    mainnetBroadcasts: number;
    mainnetSignatures: number;
    realFundOperations: number;
    testnetBroadcasts: number;
    testnetSignatures: number;
  };
  helperBaseline: {
    abiHash: string;
    businessSelectors: Record<string, string>;
    creationCodeHash: string;
    runtimeCodeHash: string;
  };
  network: { chainId: number; forked: boolean; wallet: string };
  operationEvidence: {
    duplicatePlanRejected: boolean;
    duplicateRawTransaction: {
      firstHash: string;
      repeatedHash: string;
      secondSubmissionRejected: boolean;
    };
    nonceReplacement: {
      firstReceiptState: string;
      replacementReceiptStatus: string;
    };
    restartRecovery: {
      executedPlanRecovered: boolean;
      helperCodeHash: string;
      nonceBeforeRestart: string;
      nonceRecovered: string;
      owner: string;
    };
    swap: { receiptStatus: string };
  };
  routerBaseline: { abiHash: string; allowedSelectors: string[] };
}

const contractByRole = {
  adapter: "LocalExecutionAdapter",
  helper: "WalletHelperV1",
  permit2: "TestOnlyPermit2",
  "position-manager": "TestOnlyPositionManager",
  router: "TestOnlySwapRouter",
  spender: "LocalExecutionAdapter",
} as const;

describe.skipIf(!enabled)("P05-04 deterministic local Anvil execution closure", () => {
  it("reproduces registry identities, typed execution, replacement, and restart recovery", () => {
    const output = execFileSync(process.execPath, ["scripts/snapshot-p05-04-local-execution.mjs"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const snapshot = JSON.parse(output) as LocalSnapshot;
    const registry = P05_BSC_LOCAL_EXECUTION_REGISTRY;
    expect(snapshot.network).toEqual({
      chainId: registry.chainId,
      forked: false,
      wallet: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    });
    for (const component of registry.components) {
      const deployed = snapshot.deploymentOrder.find(
        ({ contract }) => contract === contractByRole[component.role],
      );
      expect(deployed, component.role).toMatchObject({
        abiHash: component.abiHash,
        address: component.address,
        runtimeCodeHash: component.runtimeCodeHash,
      });
      expect(component.proxyImplementation).toBeNull();
      expect(component.proxyImplementationRuntimeCodeHash).toBeNull();
    }
    expect(snapshot.helperBaseline).toMatchObject({
      abiHash: registry.components.find(({ role }) => role === "helper")?.abiHash,
      businessSelectors: {
        executePosition: registry.helperSelectorAllowlist[1],
        executeSwap: registry.helperSelectorAllowlist[0],
        sweepNative: registry.helperSelectorAllowlist[3],
        sweepToken: registry.helperSelectorAllowlist[2],
      },
      runtimeCodeHash: registry.components.find(({ role }) => role === "helper")?.runtimeCodeHash,
    });
    expect(snapshot.routerBaseline).toMatchObject({
      abiHash: registry.components.find(({ role }) => role === "router")?.abiHash,
      allowedSelectors: registry.routerSelectorAllowlist,
    });
    expect(snapshot.operationEvidence.swap.receiptStatus).toBe("success");
    expect(snapshot.operationEvidence.duplicatePlanRejected).toBe(true);
    expect(snapshot.operationEvidence.duplicateRawTransaction).toMatchObject({
      secondSubmissionRejected: true,
    });
    expect(snapshot.operationEvidence.duplicateRawTransaction.firstHash).toBe(
      snapshot.operationEvidence.duplicateRawTransaction.repeatedHash,
    );
    expect(snapshot.operationEvidence.nonceReplacement).toMatchObject({
      firstReceiptState: "replaced",
      replacementReceiptStatus: "success",
    });
    expect(snapshot.operationEvidence.restartRecovery).toMatchObject({
      executedPlanRecovered: true,
      helperCodeHash: snapshot.helperBaseline.runtimeCodeHash,
      owner: snapshot.network.wallet,
    });
    expect(snapshot.operationEvidence.restartRecovery.nonceRecovered).toBe(
      snapshot.operationEvidence.restartRecovery.nonceBeforeRestart,
    );
    expect(snapshot.executionCounters.localChainWrites).toBeGreaterThan(0);
    expect(snapshot.executionCounters).toMatchObject({
      mainnetBroadcasts: 0,
      mainnetSignatures: 0,
      realFundOperations: 0,
      testnetBroadcasts: 0,
      testnetSignatures: 0,
    });
  });
});
