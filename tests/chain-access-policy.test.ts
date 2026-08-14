import {
  authorizeChainOperation,
  chainOperationCategory,
  effectiveAllowedChainIds,
  type ChainAccessMode,
  type ChainOperationCategory,
  type Role,
  type Tier,
} from "../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const roles: ReadonlyArray<{ role: Role; tier: Tier }> = [
  { role: "user", tier: "normal" },
  { role: "pro", tier: "pro" },
  { role: "admin", tier: "normal" },
];
const modes: ChainAccessMode[] = ["off", "pro", "all"];
const operations: ChainOperationCategory[] = ["read", "monitor", "unwind", "new-exposure"];

describe("AUTH-10 chain access policy", () => {
  it("exhaustively enforces user/pro/admin x off/pro/all x four operation categories", () => {
    const expectedNewExposure = {
      admin: { all: true, off: false, pro: true },
      pro: { all: true, off: false, pro: true },
      user: { all: true, off: false, pro: false },
    } as const;

    for (const subject of roles) {
      for (const access of modes) {
        for (const operation of operations) {
          const expected =
            operation === "new-exposure" ? expectedNewExposure[subject.role][access] : true;
          expect(
            authorizeChainOperation({ access, operation, ...subject }).allowed,
            `${subject.role}/${subject.tier} ${access} ${operation}`,
          ).toBe(expected);
        }
      }
    }
  });

  it("returns stable denials for off and Pro-only new exposure", () => {
    expect(
      authorizeChainOperation({
        access: "off",
        operation: "new-exposure",
        role: "admin",
        tier: "normal",
      }),
    ).toEqual({ allowed: false, code: "CHAIN_CREATION_DISABLED" });
    expect(
      authorizeChainOperation({
        access: "pro",
        operation: "new-exposure",
        role: "user",
        tier: "normal",
      }),
    ).toEqual({ allowed: false, code: "CHAIN_PRO_REQUIRED" });
  });

  it("classifies every named operation and rejects unknown operations", () => {
    for (const action of [
      "task.create",
      "pool.create",
      "position.increase",
      "position.compound",
      "position.switch_pool",
    ]) {
      expect(chainOperationCategory(action), action).toBe("new-exposure");
    }
    for (const action of [
      "pool.withdraw",
      "task.stop",
      "position.close",
      "position.emergency_exit",
    ]) {
      expect(chainOperationCategory(action), action).toBe("unwind");
    }
    expect(chainOperationCategory("position.read")).toBe("read");
    expect(chainOperationCategory("position.monitor")).toBe("monitor");
    expect(chainOperationCategory("position.teleport")).toBeNull();
  });

  it("fails closed for unknown modes, roles, tiers, operations and inconsistent role/tier pairs", () => {
    const valid = { access: "all", operation: "read", role: "user", tier: "normal" };
    expect(authorizeChainOperation({ ...valid, access: "preview" }).allowed).toBe(false);
    expect(authorizeChainOperation({ ...valid, role: "owner" }).allowed).toBe(false);
    expect(authorizeChainOperation({ ...valid, tier: "enterprise" }).allowed).toBe(false);
    expect(authorizeChainOperation({ ...valid, operation: "execute" }).allowed).toBe(false);
    expect(authorizeChainOperation({ ...valid, tier: "pro" }).allowed).toBe(false);
    expect(authorizeChainOperation({ ...valid, role: "pro", tier: "normal" }).allowed).toBe(false);
  });

  it("derives session chain IDs from current policy and trusted role instead of account storage", () => {
    const policies = [
      { access: "all", chainId: 56 },
      { access: "pro", chainId: 8453 },
      { access: "off", chainId: 1 },
      { access: "unknown", chainId: 4663 },
    ];

    expect(effectiveAllowedChainIds(policies, "user", "normal")).toEqual([56]);
    expect(effectiveAllowedChainIds(policies, "pro", "pro")).toEqual([56, 8453]);
    expect(effectiveAllowedChainIds(policies, "admin", "normal")).toEqual([56, 8453]);
    expect(effectiveAllowedChainIds(policies, "user", "pro")).toEqual([]);
  });
});
