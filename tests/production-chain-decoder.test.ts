import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PROTOCOL_EVENT_TOPICS,
  ProductionBscEventDecoder,
  type GoldenRawEvent,
  type QuarantinedLog,
} from "../packages/chain-adapters/src/index.js";
import { BSC_PROTOCOL_DEPLOYMENTS } from "../packages/chain-registry/src/index.js";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it } from "vitest";

const acceptanceRoot = path.resolve("artifacts/acceptance/P02-03");

const EXPECTED_TOPICS = {
  v3: {
    Burn: "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c",
    Collect: "0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0",
    Mint: "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde",
    PoolCreated: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
    SwapPancake: "0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83",
    SwapUniswap: "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  },
  v4: {
    InitializePancake: "0x426cc62fe6a33a40ba2788c2c87a9c34ee4582b95bc9fa5a7bb7ae70b750b99c",
    InitializeUniswap: "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
    ModifyLiquidity: "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
    SwapPancake: "0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237",
    SwapUniswap: "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  },
} as const;

function readGolden(protocol: string, eventName: string): GoldenRawEvent {
  return JSON.parse(
    readFileSync(path.join(acceptanceRoot, "golden/raw", protocol, `${eventName}.json`), "utf8"),
  ) as GoldenRawEvent;
}

async function decodeGolden(
  decoder: ProductionBscEventDecoder,
  protocol: string,
  eventName: string,
) {
  const raw = readGolden(protocol, eventName);
  for (const prerequisite of raw.prerequisites ?? []) {
    await decoder.decode(prerequisite.delivery);
  }
  return { normalized: await decoder.decode(raw.delivery), raw };
}

describe("P02-03 production BSC event decoder", () => {
  it("derives the exact official event topic0 values", () => {
    expect(PROTOCOL_EVENT_TOPICS).toEqual(EXPECTED_TOPICS);
  });

  it.each([
    ["univ3", "PoolCreated"],
    ["univ3", "Swap"],
    ["univ3", "Mint"],
    ["univ3", "Burn"],
    ["univ3", "Collect"],
    ["pcsv3", "PoolCreated"],
    ["pcsv3", "Swap"],
    ["pcsv3", "Mint"],
    ["pcsv3", "Burn"],
    ["pcsv3", "Collect"],
    ["univ4", "Initialize"],
    ["univ4", "Swap"],
    ["univ4", "ModifyLiquidity"],
    ["pcsv4", "Initialize"],
    ["pcsv4", "Swap"],
    ["pcsv4", "ModifyLiquidity"],
  ])("matches the byte-stable %s %s on-chain golden", async (protocol, eventName) => {
    const quarantined: QuarantinedLog[] = [];
    const decoder = new ProductionBscEventDecoder({
      deployments: BSC_PROTOCOL_DEPLOYMENTS,
      quarantine: {
        write: (entry) => {
          quarantined.push(entry);
        },
      },
    });
    const { normalized } = await decodeGolden(decoder, protocol, eventName);
    const raw = readGolden(protocol, eventName);
    const expected = JSON.parse(
      readFileSync(
        path.join(acceptanceRoot, "golden/normalized", protocol, `${eventName}.json`),
        "utf8",
      ),
    );

    expect(normalized).toEqual(expected);
    expect(quarantined).toEqual([]);
    if (protocol.endsWith("v3")) {
      expect(normalized.pool.poolAddress).toMatch(/^0x[0-9a-f]{40}$/u);
      expect(normalized.pool.poolId).toBeNull();
    } else {
      expect(normalized.pool.poolAddress).toBeNull();
      expect(normalized.pool.poolId).toMatch(/^0x[0-9a-f]{64}$/u);
    }
    expect(normalized.payload.positionId).toBeNull();
    expect(raw.amountSignEvidence).toMatchObject({
      status: expect.stringMatching(/^(?:not-applicable|verified-(?:exact|direction))$/u),
    });
  });

  it("preserves swap signs and maps add/remove liquidity without guessing a position ID", async () => {
    const decoder = new ProductionBscEventDecoder({ deployments: BSC_PROTOCOL_DEPLOYMENTS });
    const decoded = [];
    for (const [protocol, eventName] of [
      ["univ3", "Swap"],
      ["univ3", "Mint"],
      ["univ3", "Burn"],
      ["univ3", "Collect"],
      ["univ4", "ModifyLiquidity"],
    ] as const) {
      decoded.push((await decodeGolden(decoder, protocol, eventName)).normalized);
    }
    const [decodedSwap, decodedMint, decodedBurn, decodedCollect, decodedV4Add] = decoded;

    expect(BigInt(decodedSwap!.amount0!) * BigInt(decodedSwap!.amount1!)).toBeLessThan(0n);
    expect(BigInt(decodedMint!.liquidityDelta!)).toBeGreaterThan(0n);
    expect(BigInt(decodedBurn!.liquidityDelta!)).toBeLessThan(0n);
    expect(BigInt(decodedCollect!.amount0!) <= 0n && BigInt(decodedCollect!.amount1!) <= 0n).toBe(
      true,
    );
    expect(BigInt(decodedV4Add!.liquidityDelta!)).toBeGreaterThan(0n);
    for (const event of decoded) {
      expect(event.payload.positionId).toBeNull();
    }
  });

  it("routes a historical log through the deployment version active at its block", async () => {
    const raw = readGolden("univ4", "Initialize");
    const historicalBlock = raw.delivery.log.blockNumber;
    const deployments = BSC_PROTOCOL_DEPLOYMENTS.flatMap((deployment) =>
      deployment.platformId === "univ4"
        ? [
            { ...deployment, validToBlock: historicalBlock },
            {
              ...deployment,
              deploymentVersion: "1.1.0",
              validFromBlock: String(BigInt(historicalBlock) + 1n),
            },
          ]
        : [deployment],
    );
    const decoder = new ProductionBscEventDecoder({ deployments });

    await expect(decoder.decode(raw.delivery)).resolves.toMatchObject({
      blockNumber: historicalBlock,
      protocol: "univ4",
    });
  });

  it.each([
    ["unknown-topic", { topic: `0x${"12".repeat(32)}` }],
    ["wrong-address", { address: "0x0000000000000000000000000000000000000056" }],
    ["wrong-chain", { chainId: 1 }],
    ["malformed-data", { data: "0x01" }],
  ])("quarantines %s and fails closed", async (_label, mutation) => {
    const quarantined: QuarantinedLog[] = [];
    const decoder = new ProductionBscEventDecoder({
      deployments: BSC_PROTOCOL_DEPLOYMENTS,
      quarantine: {
        write: (entry) => {
          quarantined.push(entry);
        },
      },
    });
    const fixture = structuredClone(readGolden("univ4", "Initialize").delivery);
    if ("topic" in mutation) fixture.log.topics[0] = mutation.topic;
    if ("address" in mutation) fixture.log.address = mutation.address;
    if ("chainId" in mutation) fixture.log.chainId = mutation.chainId;
    if ("data" in mutation) fixture.log.data = mutation.data;

    await expect(decoder.decode(fixture)).rejects.toThrow(/DECODER_QUARANTINED/u);
    expect(quarantined).toHaveLength(1);
  });

  it("decodes protocol tick and liquidity integer boundaries without truncation", async () => {
    const decoder = new ProductionBscEventDecoder({ deployments: BSC_PROTOCOL_DEPLOYMENTS });
    const v3Raw = readGolden("univ3", "Mint");
    for (const prerequisite of v3Raw.prerequisites ?? []) {
      await decoder.decode(prerequisite.delivery);
    }
    const v3 = structuredClone(v3Raw.delivery);
    const maxUint128 = (1n << 128n) - 1n;
    v3.log.topics = encodeEventTopics({
      abi: [
        {
          name: "Mint",
          type: "event",
          inputs: [
            { name: "sender", type: "address" },
            { indexed: true, name: "owner", type: "address" },
            { indexed: true, name: "tickLower", type: "int24" },
            { indexed: true, name: "tickUpper", type: "int24" },
            { name: "amount", type: "uint128" },
            { name: "amount0", type: "uint256" },
            { name: "amount1", type: "uint256" },
          ],
        },
      ] as const,
      eventName: "Mint",
      args: {
        owner: "0x0000000000000000000000000000000000000001",
        tickLower: -887_272,
        tickUpper: 887_272,
      },
    }) as unknown as string[];
    v3.log.data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
      ["0x0000000000000000000000000000000000000002", maxUint128, 1n, 2n],
    );
    const decodedV3 = await decoder.decode(v3);
    expect(decodedV3).toMatchObject({
      liquidityDelta: maxUint128.toString(),
      payload: { tickLower: "-887272", tickUpper: "887272" },
    });

    const v4Raw = readGolden("univ4", "ModifyLiquidity");
    for (const prerequisite of v4Raw.prerequisites ?? []) {
      await decoder.decode(prerequisite.delivery);
    }
    const v4 = structuredClone(v4Raw.delivery);
    const minInt256 = -(1n << 255n);
    v4.log.data = encodeAbiParameters(
      [{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }],
      [-887_272, 887_272, minInt256, `0x${"00".repeat(32)}`],
    );
    const decodedV4 = await decoder.decode(v4);
    expect(decodedV4).toMatchObject({
      kind: "liquidity.remove",
      liquidityDelta: minInt256.toString(),
      payload: { tickLower: "-887272", tickUpper: "887272" },
    });
  });

  it("quarantines a deployment ABI hash conflict before decoding", async () => {
    const deployments = BSC_PROTOCOL_DEPLOYMENTS.map((deployment) =>
      deployment.platformId === "univ4"
        ? { ...deployment, abiHash: `sha256:${"11".repeat(32)}` as const }
        : deployment,
    );
    const decoder = new ProductionBscEventDecoder({ deployments });

    await expect(decoder.decode(readGolden("univ4", "Initialize").delivery)).rejects.toThrow(
      /DECODER_QUARANTINED: abi-conflict/u,
    );
    expect(decoder.quarantined).toEqual([expect.objectContaining({ reason: "abi-conflict" })]);
  });

  it("rejects a protocol-specific V4 topic at the other protocol manager", async () => {
    const decoder = new ProductionBscEventDecoder({ deployments: BSC_PROTOCOL_DEPLOYMENTS });
    const delivery = structuredClone(readGolden("univ4", "Initialize").delivery);
    delivery.log.address = BSC_PROTOCOL_DEPLOYMENTS[3]!.poolManager!;

    await expect(decoder.decode(delivery)).rejects.toThrow(/DECODER_QUARANTINED: wrong-protocol/u);
  });
});
