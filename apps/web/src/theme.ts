import type { ColorTheme, ThemePreference, UserPreferences } from "@lpbot/api-contract";

export type ResolvedTheme = "light" | "dark";

export interface AccentColorPreset {
  color: string;
  key: Exclude<ColorTheme, "custom">;
  label: string;
}

export interface ThemeTokens {
  accent: string;
  accentForeground: string;
  accentSurface: string;
  background: string;
  border: string;
  danger: string;
  dangerSurface: string;
  focusRing: string;
  muted: string;
  mutedForeground: string;
  surface: string;
  surfaceHover: string;
  text: string;
  themeColor: string;
}

export const accentColorPresets: readonly AccentColorPreset[] = [
  { color: "#171717", key: "neutral", label: "中性" },
  { color: "#3B82F6", key: "blue", label: "蓝色" },
  { color: "#8B5CF6", key: "violet", label: "紫色" },
  { color: "#22C55E", key: "green", label: "绿色" },
  { color: "#F97316", key: "orange", label: "橙色" },
  { color: "#E11D48", key: "red", label: "红色" },
  { color: "#06B6D4", key: "cyan", label: "青色" },
  { color: "#EC4899", key: "pink", label: "粉色" },
  { color: "#6366F1", key: "indigo", label: "靛蓝" },
  { color: "#F59E0B", key: "amber", label: "琥珀" },
  { color: "#14B8A6", key: "teal", label: "蓝绿" },
] as const;

const customColorPattern = /^#[0-9A-F]{6}$/u;

function parseHex(color: string): [number, number, number] {
  const normalized = color.toUpperCase();
  if (!customColorPattern.test(normalized)) throw new TypeError("Invalid custom color");
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function toHex(channels: readonly number[]): string {
  return `#${channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

function mix(first: string, second: string, amount: number): string {
  const a = parseHex(first);
  const b = parseHex(second);
  return toHex(a.map((channel, index) => channel + (b[index]! - channel) * amount));
}

function relativeLuminance(color: string): number {
  const channels = parseHex(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function contrastingForeground(background: string): "#000000" | "#FFFFFF" {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#FFFFFF")
    ? "#000000"
    : "#FFFFFF";
}

function ensureContrast(color: string, background: string, minimum: number): string {
  if (contrastRatio(color, background) >= minimum) return color;
  const target =
    contrastRatio("#000000", background) >= contrastRatio("#FFFFFF", background)
      ? "#000000"
      : "#FFFFFF";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

function accentColor(preferences: Pick<UserPreferences, "colorTheme" | "customColor">): string {
  if (preferences.colorTheme === "custom") {
    if (!preferences.customColor) throw new TypeError("Invalid custom color");
    const normalized = preferences.customColor.toUpperCase();
    parseHex(normalized);
    return normalized;
  }
  return accentColorPresets.find(({ key }) => key === preferences.colorTheme)!.color;
}

export function resolveThemeMode(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;
}

export function buildThemeTokens(
  preferences: Pick<UserPreferences, "colorTheme" | "customColor">,
  mode: ResolvedTheme,
): ThemeTokens {
  const accent = accentColor(preferences);
  const dark = mode === "dark";
  const background = dark ? "#151719" : "#FFFFFF";
  return {
    accent,
    accentForeground: contrastingForeground(accent),
    accentSurface: mix(accent, background, dark ? 0.78 : 0.9),
    background,
    border: dark ? "#34393C" : "#E1E5E6",
    danger: dark ? "#F47F78" : "#B5413B",
    dangerSurface: dark ? "#321E1D" : "#FFF2F1",
    focusRing: ensureContrast(accent, background, 3),
    muted: dark ? "#222629" : "#F5F6F6",
    mutedForeground: dark ? "#A9B1B5" : "#60686C",
    surface: dark ? "#1B1E20" : "#FFFFFF",
    surfaceHover: dark ? "#282D30" : "#EFF1F2",
    text: dark ? "#F2F5F6" : "#17191B",
    themeColor: background,
  };
}

export function applyThemeToDocument(
  preferences: Pick<UserPreferences, "colorTheme" | "customColor" | "theme">,
  systemPrefersDark: boolean,
  documentTarget: Document = document,
): ResolvedTheme {
  const mode = resolveThemeMode(preferences.theme, systemPrefersDark);
  const tokens = buildThemeTokens(preferences, mode);
  const root = documentTarget.documentElement;
  root.dataset.accent = preferences.colorTheme;
  root.dataset.theme = mode;
  root.dataset.themePreference = preferences.theme;
  root.style.colorScheme = mode;
  for (const [key, value] of Object.entries(tokens)) {
    const cssName = key.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
    root.style.setProperty(`--${cssName}`, value);
  }
  documentTarget
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", tokens.themeColor);
  return mode;
}
