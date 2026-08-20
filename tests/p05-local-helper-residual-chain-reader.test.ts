import {
  ViemLocalHelperResidualChainReader,
  type LocalHelperResidualInventorySource,
} from "../apps/api/src/index.js";
import { P05_LOCAL_HELPER_SWEEP_REGISTRY } from "../packages/chain-registry/src/index.js";
import type { LocalHelperSweepBinding } from "../packages/domain/src/local-helper-sweep.js";
import { encodeFunctionResult, keccak256, parseAbi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

const helper = "0x1111111111111111111111111111111111111111" as const;
const owner = "0x2222222222222222222222222222222222222222" as const;
const unknown = "0x3333333333333333333333333333333333333333" as const;
const walletId = "a8000000-0000-4000-8000-000000000001";
const blockHash = `0x${"42".repeat(32)}` as const;
const helperCode = "0x60006000" as const;
const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const helperAbi = parseAbi(["function owner() view returns (address)"]);
const managerAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

const binding: LocalHelperSweepBinding = {
  adapterAddress: P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(({ role }) => role === "adapter")!
    .address,
  bindingId: "a8000000-0000-4000-8000-000000000002",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2",
  helperAddress: helper,
  helperVersion: "WalletHelperV1",
  ownerAddress: owner,
  permit2Address: P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(({ role }) => role === "permit2")!
    .address,
  runtimeCodeHash: keccak256(helperCode),
  state: "active",
  verifiedBlockNumber: "8",
  walletId,
};

class Inventory implements LocalHelperResidualInventorySource {
  complete = true;

  async list() {
    return {
      complete: this.complete,
      knownNfts: [
        {
          managerAddress: P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(
            ({ role }) => role === "manager",
          )!.address,
          tokenId: "7",
        },
      ],
      tokenAddresses: [unknown],
    };
  }
}

function rpcFetch(input: { divergentNative?: boolean } = {}): typeof fetch {
  return async (request, init) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    const provider = new URL(String(request)).port;
    let result: unknown;
    switch (body.method) {
      case "eth_chainId":
        result = "0x7a69";
        break;
      case "eth_getBlockByNumber":
        result = {
          baseFeePerGas: "0xa",
          hash: blockHash,
          number: body.params[0] === "latest" ? "0xa" : body.params[0],
          timestamp: "0x68a69f00",
        };
        break;
      case "eth_blockNumber":
        result = "0xa";
        break;
      case "eth_getTransactionCount":
        result = "0x5";
        break;
      case "eth_getBalance":
        result = input.divergentNative && provider === "8546" ? "0x3ea" : "0x3e9";
        break;
      case "eth_getCode":
        result = helperCode;
        break;
      case "eth_maxPriorityFeePerGas":
        result = "0x1";
        break;
      case "eth_estimateGas":
        result = "0x5208";
        break;
      case "eth_call": {
        const transaction = body.params[0] as { data: Hex; to: Address };
        const selector = transaction.data.slice(0, 10);
        if (selector === "0x8da5cb5b") {
          result = encodeFunctionResult({ abi: helperAbi, functionName: "owner", result: owner });
        } else if (selector === "0x70a08231") {
          const amounts = new Map<Address, bigint>([
            [P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens[0].address, 10n],
            [P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens[1].address, 20n],
            [unknown, 7n],
          ]);
          result = encodeFunctionResult({
            abi: erc20Abi,
            functionName: "balanceOf",
            result: amounts.get(transaction.to) ?? 0n,
          });
        } else if (selector === "0xdd62ed3e") {
          result = encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: 0n });
        } else if (selector === "0x6352211e") {
          result = encodeFunctionResult({
            abi: managerAbi,
            functionName: "ownerOf",
            result: helper,
          });
        } else {
          return new Response(
            JSON.stringify({ error: { code: -32_000, message: "unknown call" }, id: body.id }),
            { headers: { "content-type": "application/json" } },
          );
        }
        break;
      }
      default:
        return new Response(
          JSON.stringify({ error: { code: -32_601, message: "unknown method" }, id: body.id }),
          { headers: { "content-type": "application/json" } },
        );
    }
    return new Response(JSON.stringify({ id: body.id, jsonrpc: "2.0", result }), {
      headers: { "content-type": "application/json" },
    });
  };
}

function reader(inventory: Inventory, fetchImplementation = rpcFetch()) {
  return new ViemLocalHelperResidualChainReader({
    chainId: 31_337,
    fetch: fetchImplementation,
    inventory,
    providers: [
      { providerId: "local-a", rpcUrl: "http://127.0.0.1:8545" },
      { providerId: "local-b", rpcUrl: "http://127.0.0.1:8546" },
    ],
  });
}

describe("P05-08 Viem local Helper residual reader", () => {
  it("binds complete residual facts and fee caps to one canonical block", async () => {
    const inspection = await reader(new Inventory()).inspect({
      binding,
      referencedBlockNumber: "5",
      walletAddress: owner,
    });

    expect(inspection).toMatchObject({
      block: { hash: blockHash, number: "10" },
      coverage: { complete: true },
      helper: { owner, runtimeCodeHash: keccak256(helperCode) },
      nativeBalanceBaseUnit: "1001",
      referencedBlockHash: blockHash,
    });
    expect(inspection.allowances).toHaveLength(8);
    expect(inspection.tokenBalances.map(({ amountBaseUnit }) => amountBaseUnit)).toEqual([
      "10",
      "20",
    ]);
    expect(inspection.unknownTokens).toEqual([
      { address: unknown, amountBaseUnit: "7", runtimeCodeHash: keccak256(helperCode) },
    ]);
    expect(inspection.nftCustody).toEqual([
      {
        managerAddress: P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(
          ({ role }) => role === "manager",
        )!.address,
        tokenId: "7",
      },
    ]);
    expect(inspection.feeLimits.map(({ assetId }) => assetId)).toEqual([
      "native:31337",
      `token:${P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens[0].address}`,
      `token:${P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens[1].address}`,
    ]);
    expect(inspection.nonceViews.map(({ providerId }) => providerId)).toEqual([
      "local-a",
      "local-b",
    ]);
  });

  it("marks token and NFT inventory coverage incomplete without hiding known balances", async () => {
    const inventory = new Inventory();
    inventory.complete = false;
    const inspection = await reader(inventory).inspect({
      binding,
      referencedBlockNumber: null,
      walletAddress: owner,
    });
    expect(inspection.coverage).toMatchObject({
      complete: false,
      nftCustodyComplete: false,
      tokenInventoryComplete: false,
    });
    expect(inspection.unknownTokens[0]?.amountBaseUnit).toBe("7");
  });

  it("rejects provider divergence before a snapshot can be signed or swept", async () => {
    await expect(
      reader(new Inventory(), rpcFetch({ divergentNative: true })).inspect({
        binding,
        referencedBlockNumber: null,
        walletAddress: owner,
      }),
    ).rejects.toThrow("LOCAL_HELPER_RESIDUAL_PROVIDER_DIVERGENCE");
  });
});
