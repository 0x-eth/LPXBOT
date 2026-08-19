import {
  positionReadContracts,
  positionReadStates,
  positionReadUiStates,
} from "../packages/api-contract/src/index.js";
import { describe, expect, it } from "vitest";

describe("P05-02 position read API contract", () => {
  it("freezes only the two read endpoints and the complete UI state vocabulary", () => {
    expect(positionReadContracts).toEqual({
      list: { method: "GET", path: "/api/wallets/{address}/positions" },
      scan: { method: "GET", path: "/api/positions/scan/{address}" },
    });
    expect(positionReadStates).toEqual(["empty", "ready", "partial", "stale", "quarantined"]);
    expect(positionReadUiStates).toEqual([
      "loading",
      "empty",
      "ready",
      "partial",
      "stale",
      "quarantined",
      "error",
    ]);
    expect(Object.isFrozen(positionReadContracts)).toBe(true);
    expect(Object.isFrozen(positionReadUiStates)).toBe(true);
  });
});
