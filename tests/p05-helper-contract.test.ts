import {
  helperReadContracts,
  helperReadStates,
  helperResidualReadStates,
  helperResidualUiStates,
} from "../packages/api-contract/src/index.js";
import { describe, expect, it } from "vitest";

describe("P05-02 Helper read contracts", () => {
  it("exposes only status and idempotent read-scan contracts", () => {
    expect(helperReadContracts).toEqual({
      residuals: { method: "GET", path: "/api/wallets/helper-residuals" },
      scanResiduals: { method: "POST", path: "/api/wallets/helper-residuals/scan" },
      status: { method: "GET", path: "/api/wallets/{address}/helper" },
    });
    expect(Object.values(helperReadContracts).map(({ path }) => path)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/deploy|upgrade|sweep|rescue/u)]),
    );
  });

  it("freezes all requested Helper and residual UI states without approval states", () => {
    expect(helperReadStates).toEqual([
      "undeployed",
      "active",
      "degraded",
      "superseded",
      "residual",
    ]);
    expect(helperResidualReadStates).toEqual(["empty", "ready", "partial"]);
    expect(helperResidualUiStates).toEqual([
      "loading",
      "empty",
      "scanning",
      "ready",
      "partial",
      "error",
    ]);
    expect(helperResidualUiStates).not.toContain("ready-for-approval");
    expect(Object.isFrozen(helperReadStates)).toBe(true);
  });
});
