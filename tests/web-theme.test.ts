import type { UserPreferences } from "../packages/api-contract/src/index.js";
import {
  accentColorPresets,
  buildThemeTokens,
  contrastRatio,
  resolveThemeMode,
} from "../apps/web/src/theme.js";
import { describe, expect, it } from "vitest";

const preferences: UserPreferences = {
  colorTheme: "neutral",
  customColor: null,
  navConfig: [
    { key: "tasks", visible: true },
    { key: "pools", visible: true },
    { key: "strategies", visible: true },
    { key: "activity", visible: true },
    { key: "wallets", visible: true },
    { key: "chat", visible: true },
  ],
  poolColumns: [
    { key: "pool", visible: true },
    { key: "protocol", visible: true },
    { key: "fees", visible: true },
    { key: "volume", visible: true },
    { key: "tvl", visible: true },
    { key: "txs", visible: true },
    { key: "fdv", visible: true },
    { key: "actions", visible: true },
  ],
  poolsPanelCollapsed: false,
  showHotPools: false,
  showPoolLabels: true,
  showScanTab: true,
  taskViewMode: "grid",
  theme: "system",
};

describe("P01-06 semantic theme tokens", () => {
  it("resolves light, dark and both live system modes", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
    expect(resolveThemeMode("system", true)).toBe("dark");
  });

  it("matches the observed accent swatches and derives accessible interaction colors", () => {
    expect(accentColorPresets.map(({ key }) => key)).toEqual([
      "neutral",
      "blue",
      "violet",
      "green",
      "orange",
      "red",
      "cyan",
      "pink",
      "indigo",
      "amber",
      "teal",
    ]);

    for (const mode of ["light", "dark"] as const) {
      for (const colorTheme of accentColorPresets.map(({ key }) => key)) {
        const tokens = buildThemeTokens({ ...preferences, colorTheme }, mode);
        expect(contrastRatio(tokens.accent, tokens.accentForeground)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens.focusRing, tokens.background)).toBeGreaterThanOrEqual(3);
        expect(tokens.themeColor).toMatch(/^#[0-9A-F]{6}$/u);
      }
    }
  });

  it("accepts six-digit custom colors and still guarantees text and focus contrast", () => {
    const tokens = buildThemeTokens(
      { ...preferences, colorTheme: "custom", customColor: "#F5F5F5" },
      "light",
    );
    expect(tokens.accent).toBe("#F5F5F5");
    expect(contrastRatio(tokens.accent, tokens.accentForeground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.focusRing, tokens.background)).toBeGreaterThanOrEqual(3);
    expect(() =>
      buildThemeTokens({ ...preferences, colorTheme: "custom", customColor: "red" }, "light"),
    ).toThrow(/custom color/iu);
  });
});
