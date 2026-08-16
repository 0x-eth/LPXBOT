import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PROTOCOL_EVENT_TOPICS,
  ProductionBscEventDecoder,
  type GoldenRawEvent,
  type QuarantinedLog,
} from "../packages/chain-adapters/src/index.js";
import { BSC_PROTOCOL_DEPLOYMENTS } from "../packages/chain-registry/src/index.js";
import { describe, expect, it } from "vitest";

const acceptanceRoot = path.resolve("artifacts/acceptance/P02-03");

const EXPECTED_TOPICS = {
  v3: {
    Burn: "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c",
    Collect: "0x70935338e69775456a85eaf593ee9f9f0c4a68d2c86f1b918f05a40c0d12ca9c0",
    Mint: "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde",
    PoolCreated: "0x783cca1c0412dd0d695e784568c96f3a0f6719e57e657b7b32b2fbe2b9e6b7118",
    SwapPancake:
      "0x19b47279256b2a23a359a152c09a67a4cd5c66427a75001d0e1e8c6e7c5f7dc83",
    SwapUniswap:
      "0xc42079f94a6350d7e6235f291749249e109727d57a804b116afc46a04a2ca67",
  },
  v4: {
    InitializePancake:
      "0x426cc62f3a4b5f8e23b4f8d3a82d1e95de1d9f63f2f35c312e30f51e8f6db99c",
    InitializeUniswap:
      "0xdd466e674ea557f56295e2d0218a125b4e3b51b6e4df6b4f742e8d2c5d8d6438",
    ModifyLiquidity:
      "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
    SwapPancake:
      "0x04206ad2d089c1c8d4f1d2152f7355aef9a885f3b960ced55c8640f5b1cdd237",
    SwapUniswap:
      "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  },
} as const;

function readGolden(protocol: string, eventName: string): GoldenRawEvent {
  return JSON.parse(
    readFileSync(path.join(acceptanceRoot, "golden/raw", protocol, `${eventName}.json`), "utf8"),
  ) as GoldenRawEvent;
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
      quarantine: { write: (entry) => quarantined.push(entry) },
    });
    const poolCreated =
      protocol.endsWith("v3") && eventName !== "PoolCreated"
        ? readGolden(protocol, "PoolCreated")
        : null;
    if (poolCreated) await decoder.decode(poolCreated.delivery);

    const raw = readGolden(protocol, eventName);
    const normalized = await decoder.decode(raw.delivery);
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
  });

  it("preserves swap signs and maps add/remove liquidity without guessing a position ID", async () => {
    const decoder = new ProductionBscEventDecoder({ deployments: BSC_PROTOCOL_DEPLOYMENTS });
    await decoder.decode(readGolden("univ3", "PoolCreated").delivery);
    const [swap, mint, burn, collect, v4Add] = await Promise.all([
      decoder.decode(readGolden("univ3", "Swap").delivery),
      decoder.decode(readGolden("univ3", "Mint").delivery),
      decoder.decode(readGolden("univ3", "Burn").delivery),
      decoder.decode(readGolden("univ3", "Collect").delivery),
      decoder.decode(readGolden("univ4", "ModifyLiquidity").delivery),
    ]);

    expect(BigInt(swap.amount0!) * BigInt(swap.amount1!)).toBeLessThan(0n);
    expect(BigInt(mint.liquidityDelta!)).toBeGreaterThan(0n);
    expect(BigInt(burn.liquidityDelta!)).toBeLessThan(0n);
    expect(BigInt(collect.amount0!) <= 0n && BigInt(collect.amount1!) <= 0n).toBe(true);
    expect(BigInt(v4Add.liquidityDelta!)).toBeGreaterThan(0n);
    for (const event of [swap, mint, burn, collect, v4Add]) {
      expect(event.payload.positionId).toBeNull();
    }
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
      quarantine: { write: (entry) => quarantined.push(entry) },
    });
    const fixture = structuredClone(readGolden("univ4", "Initialize").delivery);
    if ("topic" in mutation) fixture.log.topics[0] = mutation.topic;
    if ("address" in mutation) fixture.log.address = mutation.address;
    if ("chainId" in mutation) fixture.log.chainId = mutation.chainId;
    if ("data" in mutation) fixture.log.data = mutation.data;

    await expect(decoder.decode(fixture)).rejects.toThrow(/DECODER_QUARANTINED/u);
    expect(quarantined).toHaveLength(1);
  });
});
