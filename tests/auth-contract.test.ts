import {
  authStateDestination,
  createErrorEnvelope,
  isSessionView,
  type AuthState,
  type SessionView,
} from "../packages/api-contract/src/index.js";
import { describe, expect, it } from "vitest";

const session: SessionView = {
  allowedChainIds: [1, 56],
  avatarUrl: null,
  displayName: "Local User",
  maintenanceBypass: false,
  role: "user",
  tier: "normal",
  userId: "00000000-0000-4000-8000-000000000001",
};

describe("P01-02 auth contract", () => {
  it("routes every discriminated auth state without a fallback state", () => {
    const cases: Array<[AuthState, string | null]> = [
      [{ status: "booting" }, null],
      [{ status: "anonymous" }, "/login"],
      [{ status: "active", session }, null],
      [{ status: "blocked", reason: "pending", message: null }, "/blocked"],
      [{ status: "maintenance", message: "Scheduled", until: null }, "/maintenance"],
      [
        { status: "region-blocked", region: "ZZ", message: "Unavailable in this region" },
        "/blocked",
      ],
    ];

    for (const [state, destination] of cases) {
      expect(authStateDestination(state)).toBe(destination);
    }
  });

  it("accepts only complete SessionView values", () => {
    expect(isSessionView(session)).toBe(true);
    expect(isSessionView({ ...session, role: "owner" })).toBe(false);
    expect(isSessionView({ ...session, allowedChainIds: [56, "1"] })).toBe(false);
    expect(isSessionView({ ...session, maintenanceBypass: undefined })).toBe(false);
  });

  it("builds the stable error envelope without leaking arbitrary details", () => {
    expect(
      createErrorEnvelope({
        code: "AUTH_EXPIRED",
        message: "Session expired",
        requestId: "req-local-1",
        retryable: false,
      }),
    ).toEqual({
      success: false,
      error: {
        code: "AUTH_EXPIRED",
        message: "Session expired",
        requestId: "req-local-1",
        retryable: false,
      },
    });
  });
});
