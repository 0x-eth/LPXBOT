import {
  canonicalPoolCreationAddress,
  canonicalPoolCreationPoolKey,
  canonicalPoolCreationRecord,
  parsePoolCreatorBatchRequest,
  parsePoolCreatorQuery,
  PoolCreationProvenanceValidationError,
} from "../apps/api/src/pool-creation-provenance.js";
import { describe, expect, it } from "vitest";

const v3Address = `0x${"aB".repeat(20)}`;
const v3PoolKey = `56:${v3Address}`;
const v4PoolId = `0x${"cD".repeat(32)}`;
const v4PoolKey = `56:${v4PoolId}`;

describe("P02-12 pool creation provenance contract", () => {
  it("canonicalizes BSC V3 addresses, V4 pool IDs, and canonical pool keys", () => {
    expect(canonicalPoolCreationAddress(v3Address)).toBe(`0x${"ab".repeat(20)}`);
    expect(canonicalPoolCreationPoolKey(v3Address)).toBe(`56:0x${"ab".repeat(20)}`);
    expect(canonicalPoolCreationPoolKey(v3PoolKey)).toBe(`56:0x${"ab".repeat(20)}`);
    expect(canonicalPoolCreationPoolKey(v4PoolId)).toBe(`56:0x${"cd".repeat(32)}`);
    expect(canonicalPoolCreationPoolKey(v4PoolKey)).toBe(`56:0x${"cd".repeat(32)}`);
  });

  it.each([
    "",
    "WBNB",
    "0x1234",
    `0X${"a".repeat(40)}`,
    `1:0x${"a".repeat(40)}`,
    `56:0x${"a".repeat(42)}`,
    `56:0x${"g".repeat(64)}`,
    `0x${"a".repeat(63)}`,
  ])("rejects illegal or ambiguous pool identity %s", (identity) => {
    expect(() => canonicalPoolCreationPoolKey(identity)).toThrow(
      PoolCreationProvenanceValidationError,
    );
  });

  it("freezes the record fields and enforces protocol generation and created evidence", () => {
    expect(
      canonicalPoolCreationRecord({
        chainId: 56,
        completedAt: "2026-08-17T10:00:00.000Z",
        creatorAddress: `0x${"EF".repeat(20)}`,
        feePips: "2500",
        operationId: "12000000-0000-4000-8000-000000000001",
        outcome: "created",
        poolKey: v3PoolKey,
        protocol: "pcsv3",
        schemaVersion: 1,
        txHash: `0x${"AB".repeat(32)}`,
        userId: "12000000-0000-4000-8000-000000000101",
      }),
    ).toEqual({
      chainId: 56,
      completedAt: "2026-08-17T10:00:00.000Z",
      creatorAddress: `0x${"ef".repeat(20)}`,
      feePips: "2500",
      operationId: "12000000-0000-4000-8000-000000000001",
      outcome: "created",
      poolKey: `56:0x${"ab".repeat(20)}`,
      protocol: "pcsv3",
      schemaVersion: 1,
      txHash: `0x${"ab".repeat(32)}`,
      userId: "12000000-0000-4000-8000-000000000101",
    });

    for (const invalid of [
      { creatorAddress: null },
      { txHash: null },
      { protocol: "pcsv4", poolKey: v3PoolKey },
      { protocol: "univ3", poolKey: v4PoolKey },
      { feePips: "-1" },
      { outcome: "unknown" },
      { chainId: 1 },
      { schemaVersion: 2 },
    ]) {
      expect(() =>
        canonicalPoolCreationRecord({
          chainId: 56,
          completedAt: "2026-08-17T10:00:00.000Z",
          creatorAddress: `0x${"e".repeat(40)}`,
          feePips: "2500",
          operationId: "12000000-0000-4000-8000-000000000001",
          outcome: "created",
          poolKey: v3PoolKey,
          protocol: "pcsv3",
          schemaVersion: 1,
          txHash: `0x${"a".repeat(64)}`,
          userId: "12000000-0000-4000-8000-000000000101",
          ...invalid,
        }),
      ).toThrow(PoolCreationProvenanceValidationError);
    }
  });

  it("allows legacy already-exists evidence to retain explicit null wallet and transaction fields", () => {
    expect(
      canonicalPoolCreationRecord({
        chainId: 56,
        completedAt: "2026-08-17T10:00:00.000Z",
        creatorAddress: null,
        feePips: "500",
        operationId: "12000000-0000-4000-8000-000000000002",
        outcome: "already_exists",
        poolKey: v4PoolKey,
        protocol: "univ4",
        schemaVersion: 1,
        txHash: null,
        userId: "12000000-0000-4000-8000-000000000101",
      }),
    ).toMatchObject({ creatorAddress: null, outcome: "already_exists", txHash: null });
  });

  it("parses the target V3 single query without accepting fuzzy parameters", () => {
    expect(parsePoolCreatorQuery({ address: v3Address, chainId: "56" })).toEqual({
      identity: `0x${"ab".repeat(20)}`,
      poolKey: `56:0x${"ab".repeat(20)}`,
    });
    for (const query of [
      { address: v4PoolId, chainId: "56" },
      { address: v3Address, chainId: "1" },
      { address: v3Address },
      { address: v3Address, chainId: "56", poolKey: v3PoolKey },
    ]) {
      expect(() => parsePoolCreatorQuery(query)).toThrow(PoolCreationProvenanceValidationError);
    }
  });

  it("supports bounded address or poolKey batches and rejects mixed, duplicate, or fuzzy identity", () => {
    expect(parsePoolCreatorBatchRequest({ addresses: [v3Address] }, 2)).toEqual({
      identities: [`0x${"ab".repeat(20)}`],
      identityType: "address",
      poolKeys: [`56:0x${"ab".repeat(20)}`],
    });
    expect(parsePoolCreatorBatchRequest({ poolKeys: [v3PoolKey, v4PoolKey] }, 2)).toEqual({
      identities: [`56:0x${"ab".repeat(20)}`, `56:0x${"cd".repeat(32)}`],
      identityType: "poolKey",
      poolKeys: [`56:0x${"ab".repeat(20)}`, `56:0x${"cd".repeat(32)}`],
    });
    for (const body of [
      { addresses: [] },
      { addresses: [v3Address, v3Address.toLowerCase()] },
      { addresses: [v3Address], poolKeys: [v4PoolKey] },
      { identities: [v3Address] },
      { poolKeys: [v3PoolKey, v4PoolKey, `56:0x${"e".repeat(64)}`] },
      { poolKeys: [v3Address] },
    ]) {
      expect(() => parsePoolCreatorBatchRequest(body, 2)).toThrow(
        PoolCreationProvenanceValidationError,
      );
    }
  });
});
