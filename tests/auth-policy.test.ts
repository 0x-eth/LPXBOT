import {
  authorizeAccount,
  canAccessOwnedResource,
  roleCanAccess,
  type AccountAccessContext,
  type AccessLevel,
} from "../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const activeUser: AccountAccessContext = {
  accountStatus: "active",
  maintenance: { enabled: false, message: null, until: null },
  region: { blocked: false, code: null, message: null },
  role: "user",
};

describe("P01-02 server authorization policy", () => {
  it("enforces the user/pro/admin role matrix and defaults to deny", () => {
    const levels: AccessLevel[] = ["authenticated", "pro", "admin"];
    const expected = {
      admin: [true, true, true],
      pro: [true, true, false],
      user: [true, false, false],
    } as const;

    for (const [role, decisions] of Object.entries(expected)) {
      expect(levels.map((level) => roleCanAccess(role, level))).toEqual(decisions);
    }

    expect(roleCanAccess("user", null)).toBe(false);
    expect(roleCanAccess("admin", "unknown" as AccessLevel)).toBe(false);
  });

  it.each([
    ["pending", "ACCOUNT_PENDING", 403],
    ["rejected", "ACCOUNT_REJECTED", 403],
    ["banned", "ACCOUNT_BANNED", 403],
  ] as const)("denies %s accounts with a stable error", (accountStatus, code, statusCode) => {
    expect(authorizeAccount({ ...activeUser, accountStatus })).toMatchObject({
      allowed: false,
      code,
      retryable: false,
      statusCode,
    });
  });

  it("denies blocked regions before entering protected handlers", () => {
    expect(
      authorizeAccount({
        ...activeUser,
        region: { blocked: true, code: "ZZ", message: "Unavailable in this region" },
      }),
    ).toEqual({
      allowed: false,
      code: "REGION_BLOCKED",
      message: "Unavailable in this region",
      region: "ZZ",
      retryable: false,
      statusCode: 403,
    });
  });

  it("returns maintenance for user/pro and explicitly bypasses it for admin", () => {
    const maintenance = {
      enabled: true,
      message: "Scheduled maintenance",
      until: "2026-08-14T05:00:00.000Z",
    };

    for (const role of ["user", "pro"] as const) {
      expect(authorizeAccount({ ...activeUser, maintenance, role })).toMatchObject({
        allowed: false,
        code: "MAINTENANCE",
        retryable: true,
        statusCode: 503,
      });
    }
    expect(authorizeAccount({ ...activeUser, maintenance, role: "admin" })).toEqual({
      allowed: true,
      maintenanceBypass: true,
    });
  });

  it("requires ownership or an explicit admin scope", () => {
    expect(canAccessOwnedResource("user-a", "user-a", "user", false)).toBe(true);
    expect(canAccessOwnedResource("user-a", "user-b", "user", false)).toBe(false);
    expect(canAccessOwnedResource("admin-a", "user-b", "admin", false)).toBe(false);
    expect(canAccessOwnedResource("admin-a", "user-b", "admin", true)).toBe(true);
  });
});
