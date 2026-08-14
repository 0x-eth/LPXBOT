import {
  colorThemeKeys,
  defaultUserPreferences as contractDefaultUserPreferences,
  navigationKeys,
  userPreferenceSchemaVersion,
  type ColorTheme,
  type NavigationKey,
  type NavigationPreference,
  type UpdateUserPreferencesRequest,
  type UserPreferences,
  type VersionedUserPreferences,
} from "@lpbot/api-contract";

export const defaultUserPreferences = contractDefaultUserPreferences;

export interface UpdateUserPreferencesInput {
  expectedRevision: number;
  preferences: UserPreferences;
  updatedAt: Date;
  userId: string;
}

export type UserPreferencesUpdateResult =
  | { status: "updated"; value: VersionedUserPreferences }
  | { current: VersionedUserPreferences; status: "conflict" };

export interface UserPreferencesStore {
  get(userId: string): Promise<VersionedUserPreferences | null>;
  update(input: UpdateUserPreferencesInput): Promise<UserPreferencesUpdateResult>;
}

export class UserPreferencesValidationError extends Error {
  constructor() {
    super("User preferences are invalid");
    this.name = "UserPreferencesValidationError";
  }
}

const preferenceKeys = [
  "colorTheme",
  "customColor",
  "navConfig",
  "poolsPanelCollapsed",
  "showHotPools",
  "showScanTab",
  "taskViewMode",
  "theme",
] as const satisfies ReadonlyArray<keyof UserPreferences>;
const preferenceKeySet = new Set<string>(preferenceKeys);
const navigationKeySet = new Set<string>(navigationKeys);
const colorThemeKeySet = new Set<string>(colorThemeKeys);
const customColorPattern = /^#[0-9A-F]{6}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownKeysAre(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => expected.has(key));
}

function isNavigationKey(value: unknown): value is NavigationKey {
  return typeof value === "string" && navigationKeySet.has(value);
}

function isColorTheme(value: unknown): value is ColorTheme {
  return typeof value === "string" && colorThemeKeySet.has(value);
}

function normalizeCustomColor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new UserPreferencesValidationError();
  const normalized = value.toUpperCase();
  if (!customColorPattern.test(normalized)) throw new UserPreferencesValidationError();
  return normalized;
}

function validateNavigation(value: unknown): NavigationPreference[] {
  if (!Array.isArray(value) || value.length !== navigationKeys.length) {
    throw new UserPreferencesValidationError();
  }
  const seen = new Set<NavigationKey>();
  const normalized = value.map((item) => {
    if (!isRecord(item) || Object.keys(item).length !== 2 || !isNavigationKey(item.key)) {
      throw new UserPreferencesValidationError();
    }
    if (typeof item.visible !== "boolean" || seen.has(item.key)) {
      throw new UserPreferencesValidationError();
    }
    seen.add(item.key);
    return { key: item.key, visible: item.visible };
  });
  if (
    seen.size !== navigationKeys.length ||
    !normalized.find(({ key }) => key === "tasks")?.visible
  ) {
    throw new UserPreferencesValidationError();
  }
  return normalized;
}

function validateCompletePreferences(value: Record<string, unknown>): UserPreferences {
  if (Object.keys(value).length !== preferenceKeys.length || !ownKeysAre(value, preferenceKeySet)) {
    throw new UserPreferencesValidationError();
  }
  if (!isColorTheme(value.colorTheme)) throw new UserPreferencesValidationError();
  const customColor = normalizeCustomColor(value.customColor);
  if (value.colorTheme === "custom" && customColor === null) {
    throw new UserPreferencesValidationError();
  }
  if (value.taskViewMode !== "grid" && value.taskViewMode !== "list") {
    throw new UserPreferencesValidationError();
  }
  if (value.theme !== "light" && value.theme !== "dark" && value.theme !== "system") {
    throw new UserPreferencesValidationError();
  }
  for (const key of ["poolsPanelCollapsed", "showHotPools", "showScanTab"] as const) {
    if (typeof value[key] !== "boolean") throw new UserPreferencesValidationError();
  }
  return {
    colorTheme: value.colorTheme,
    customColor,
    navConfig: validateNavigation(value.navConfig),
    poolsPanelCollapsed: value.poolsPanelCollapsed,
    showHotPools: value.showHotPools,
    showScanTab: value.showScanTab,
    taskViewMode: value.taskViewMode,
    theme: value.theme,
  };
}

export function defaultVersionedUserPreferences(): VersionedUserPreferences {
  return {
    preferences: structuredClone(defaultUserPreferences),
    revision: 0,
    schemaVersion: userPreferenceSchemaVersion,
    updatedAt: null,
  };
}

export function parseUserPreferencesPatch(
  value: unknown,
  current: UserPreferences,
): { expectedRevision: number; preferences: UserPreferences } {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "changes") ||
    !Object.hasOwn(value, "expectedRevision") ||
    !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 0 ||
    !isRecord(value.changes) ||
    Object.keys(value.changes).length === 0 ||
    !ownKeysAre(value.changes, preferenceKeySet)
  ) {
    throw new UserPreferencesValidationError();
  }
  const request = value as unknown as UpdateUserPreferencesRequest;
  return {
    expectedRevision: request.expectedRevision,
    preferences: validateCompletePreferences({ ...current, ...request.changes }),
  };
}

export function normalizeStoredUserPreferences(value: unknown): UserPreferences {
  const raw = isRecord(value) ? value : {};
  const colorTheme = isColorTheme(raw.colorTheme)
    ? raw.colorTheme
    : defaultUserPreferences.colorTheme;
  let customColor: string | null = null;
  try {
    customColor = normalizeCustomColor(raw.customColor ?? null);
  } catch {
    customColor = null;
  }
  const normalizedColorTheme =
    colorTheme === "custom" && customColor === null ? "neutral" : colorTheme;

  const ordered = new Map<NavigationKey, boolean>();
  if (Array.isArray(raw.navConfig)) {
    for (const item of raw.navConfig) {
      if (isNavigationKey(item)) ordered.set(item, true);
      else if (
        isRecord(item) &&
        isNavigationKey(item.key) &&
        typeof item.visible === "boolean" &&
        !ordered.has(item.key)
      ) {
        ordered.set(item.key, item.visible);
      }
    }
  }
  for (const key of navigationKeys) {
    if (!ordered.has(key)) ordered.set(key, true);
  }
  ordered.set("tasks", true);

  return {
    colorTheme: normalizedColorTheme,
    customColor,
    navConfig: [...ordered].map(([key, visible]) => ({ key, visible })),
    poolsPanelCollapsed:
      typeof raw.poolsPanelCollapsed === "boolean"
        ? raw.poolsPanelCollapsed
        : defaultUserPreferences.poolsPanelCollapsed,
    showHotPools:
      typeof raw.showHotPools === "boolean"
        ? raw.showHotPools
        : defaultUserPreferences.showHotPools,
    showScanTab:
      typeof raw.showScanTab === "boolean" ? raw.showScanTab : defaultUserPreferences.showScanTab,
    taskViewMode: raw.taskViewMode === "list" ? "list" : "grid",
    theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system",
  };
}
