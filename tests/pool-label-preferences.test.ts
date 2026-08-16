import { defaultUserPreferences, userPreferenceSchemaVersion } from "../packages/api-contract/src/index.js";
import { normalizeStoredUserPreferences } from "../apps/api/src/user-preferences.js";
import { describe, expect, it } from "vitest";

describe("P02-08 pool label preference migration", () => {
  it("moves schema v4 to v5 while preserving navigation, theme and column order", () => {
    const legacy = {
      colorTheme: "teal",
      customColor: null,
      navConfig: [
        { key: "wallets", visible: false },
        { key: "tasks", visible: true },
        { key: "pools", visible: true },
        { key: "strategies", visible: false },
        { key: "activity", visible: true },
        { key: "chat", visible: true },
      ],
      poolColumns: [
        { key: "pool", visible: true },
        { key: "fdv", visible: false },
        { key: "fees", visible: true },
        { key: "protocol", visible: true },
        { key: "volume", visible: false },
        { key: "feeTvl", visible: true },
        { key: "feeActiveTvl", visible: true },
        { key: "tvl", visible: true },
        { key: "txs", visible: true },
        { key: "actions", visible: true },
      ],
      poolsPanelCollapsed: true,
      showHotPools: true,
      showScanTab: false,
      taskViewMode: "list",
      theme: "dark",
    };
    expect(userPreferenceSchemaVersion).toBe(5);
    expect(normalizeStoredUserPreferences(legacy)).toEqual({ ...legacy, showPoolLabels: true });
  });

  it("defaults labels on and preserves an explicit migrated preference", () => {
    expect(defaultUserPreferences.showPoolLabels).toBe(true);
    expect(
      normalizeStoredUserPreferences({ ...structuredClone(defaultUserPreferences), showPoolLabels: false })
        .showPoolLabels,
    ).toBe(false);
  });
});
