import {
  canonicalPoolBlocklistEntry,
  createPoolBlocklistSnapshot,
  parsePoolBlocklistPatch,
  PoolBlocklistValidationError,
} from "../apps/api/src/pool-blocklist.js";
import { describe, expect, it } from "vitest";

const v3PoolKey = `56:0x${"1".repeat(40)}`;
const v4PoolKey = `56:0x${"2".repeat(64)}`;
const tokenAddress = `0x${"a".repeat(40)}`;

describe("P02-11 pool blocklist contract", () => {
  it("accepts only canonical BSC V3/V4 pool keys and 20-byte Token addresses", () => {
    expect(
      canonicalPoolBlocklistEntry({ chainId: 56, identity: v3PoolKey, scope: "pool" }),
    ).toEqual({ chainId: 56, identity: v3PoolKey, scope: "pool" });
    expect(
      canonicalPoolBlocklistEntry({
        chainId: 56,
        identity: v4PoolKey,
        label: "V4 candidate",
        scope: "pool",
      }),
    ).toEqual({ chainId: 56, identity: v4PoolKey, label: "V4 candidate", scope: "pool" });
    expect(
      canonicalPoolBlocklistEntry({ chainId: 56, identity: tokenAddress, scope: "token" }),
    ).toEqual({ chainId: 56, identity: tokenAddress, scope: "token" });

    for (const entry of [
      { chainId: 1, identity: tokenAddress, scope: "token" },
      { chainId: 56, identity: "WBNB", scope: "token" },
      { chainId: 56, identity: `0x${"a".repeat(39)}`, scope: "token" },
      { chainId: 56, identity: `0x${"A".repeat(40)}`, scope: "token" },
      { chainId: 56, identity: v3PoolKey.slice(3), scope: "pool" },
      { chainId: 56, identity: `1:${v3PoolKey.slice(3)}`, scope: "pool" },
      { chainId: 56, identity: `56:0x${"F".repeat(40)}`, scope: "pool" },
      { chainId: 56, identity: `56:0x${"1".repeat(41)}`, scope: "pool" },
    ]) {
      expect(() => canonicalPoolBlocklistEntry(entry)).toThrow(PoolBlocklistValidationError);
    }
  });

  it("rejects unknown fields, invalid labels, and malformed single-operation PATCH bodies", () => {
    const valid = {
      expectedRevision: 0,
      operation: {
        entry: { chainId: 56, identity: tokenAddress, label: "Token A", scope: "token" },
        type: "block",
      },
    };
    expect(parsePoolBlocklistPatch(valid)).toEqual(valid);
    expect(
      parsePoolBlocklistPatch({
        expectedRevision: 4,
        operation: {
          entry: { chainId: 56, identity: v3PoolKey, scope: "pool" },
          type: "restore",
        },
      }),
    ).toEqual({
      expectedRevision: 4,
      operation: {
        entry: { chainId: 56, identity: v3PoolKey, scope: "pool" },
        type: "restore",
      },
    });

    for (const request of [
      { ...valid, unexpected: true },
      { ...valid, expectedRevision: -1 },
      { ...valid, operation: [{ type: "block", entry: valid.operation.entry }] },
      { ...valid, operation: { ...valid.operation, unexpected: true } },
      { ...valid, operation: { ...valid.operation, type: "delete" } },
      {
        ...valid,
        operation: { entry: { ...valid.operation.entry, unexpected: true }, type: "block" },
      },
      {
        ...valid,
        operation: { entry: { ...valid.operation.entry, label: " padded " }, type: "block" },
      },
      {
        ...valid,
        operation: { entry: { ...valid.operation.entry, label: "x".repeat(65) }, type: "block" },
      },
      {
        ...valid,
        operation: { entry: { ...valid.operation.entry, label: "line\nbreak" }, type: "block" },
      },
      {
        ...valid,
        operation: { entry: { ...valid.operation.entry, label: "restore label" }, type: "restore" },
      },
    ]) {
      expect(() => parsePoolBlocklistPatch(request)).toThrow(PoolBlocklistValidationError);
    }
  });

  it("sorts entries deterministically, rejects duplicates, and freezes the eligibility hash", () => {
    const snapshot = createPoolBlocklistSnapshot({
      entries: [
        { chainId: 56, identity: tokenAddress, label: "display only", scope: "token" },
        { chainId: 56, identity: v3PoolKey, scope: "pool" },
      ],
      revision: 7,
      updatedAt: new Date("2026-08-17T08:00:00.000Z"),
    });
    expect(snapshot).toEqual({
      blocklistHash: "sha256:9e1ad95bb801ffe00803c8752f78b8e44dd334b2070bb07088446f6734100f22",
      entries: [
        { chainId: 56, identity: v3PoolKey, scope: "pool" },
        { chainId: 56, identity: tokenAddress, label: "display only", scope: "token" },
      ],
      revision: 7,
      schemaVersion: 1,
      updatedAt: "2026-08-17T08:00:00.000Z",
    });

    const relabeled = createPoolBlocklistSnapshot({
      entries: [
        { chainId: 56, identity: v3PoolKey, label: "renamed", scope: "pool" },
        { chainId: 56, identity: tokenAddress, scope: "token" },
      ],
      revision: 8,
      updatedAt: new Date("2026-08-17T08:01:00.000Z"),
    });
    expect(relabeled.blocklistHash).toBe(snapshot.blocklistHash);

    expect(() =>
      createPoolBlocklistSnapshot({
        entries: [
          { chainId: 56, identity: tokenAddress, scope: "token" },
          { chainId: 56, identity: tokenAddress, label: "duplicate", scope: "token" },
        ],
        revision: 1,
        updatedAt: new Date(),
      }),
    ).toThrow(PoolBlocklistValidationError);
  });
});
