import {
  colorThemeKeys,
  navigationKeys,
  poolColumnKeys,
  userPreferenceSchemaVersion,
  type ColorTheme,
  type NavigationKey,
  type PoolColumnKey,
  type UpdateUserPreferencesRequest,
  type UserPreferences,
  type VersionedUserPreferences,
} from "@lpbot/api-contract";

interface PreferencesSuccessEnvelope {
  data: unknown;
  success: true;
}

export class PreferencesRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super("The preference request could not be completed");
    this.code = code;
    this.name = "PreferencesRequestError";
    this.retryable = retryable;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNavigation(value: unknown): UserPreferences["navConfig"] | null {
  if (!Array.isArray(value) || value.length !== navigationKeys.length) return null;
  const seen = new Set<NavigationKey>();
  const result: UserPreferences["navConfig"] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.key !== "string" ||
      !navigationKeys.includes(item.key as NavigationKey) ||
      typeof item.visible !== "boolean" ||
      seen.has(item.key as NavigationKey)
    ) {
      return null;
    }
    const key = item.key as NavigationKey;
    seen.add(key);
    result.push({ key, visible: item.visible });
  }
  if (!result.find(({ key }) => key === "tasks")?.visible) return null;
  return result;
}

function parsePoolColumns(value: unknown): UserPreferences["poolColumns"] | null {
  if (!Array.isArray(value) || value.length !== poolColumnKeys.length) return null;
  const seen = new Set<PoolColumnKey>();
  const result: UserPreferences["poolColumns"] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.key !== "string" ||
      !poolColumnKeys.includes(item.key as PoolColumnKey) ||
      typeof item.visible !== "boolean" ||
      seen.has(item.key as PoolColumnKey)
    ) {
      return null;
    }
    const key = item.key as PoolColumnKey;
    seen.add(key);
    result.push({ key, visible: item.visible });
  }
  if (
    result[0]?.key !== "pool" ||
    !result[0].visible ||
    result.at(-1)?.key !== "actions" ||
    !result.at(-1)!.visible
  ) {
    return null;
  }
  return result;
}

function parsePreferences(value: unknown): UserPreferences | null {
  if (!isRecord(value)) return null;
  const navConfig = parseNavigation(value.navConfig);
  const poolColumns = parsePoolColumns(value.poolColumns);
  const colorTheme =
    typeof value.colorTheme === "string" && colorThemeKeys.includes(value.colorTheme as ColorTheme)
      ? (value.colorTheme as ColorTheme)
      : null;
  const customColor =
    value.customColor === null ||
    (typeof value.customColor === "string" && /^#[0-9A-F]{6}$/u.test(value.customColor))
      ? value.customColor
      : undefined;
  if (
    !navConfig ||
    !poolColumns ||
    !colorTheme ||
    customColor === undefined ||
    (colorTheme === "custom" && customColor === null) ||
    (value.theme !== "light" && value.theme !== "dark" && value.theme !== "system") ||
    (value.taskViewMode !== "grid" && value.taskViewMode !== "list") ||
    typeof value.poolsPanelCollapsed !== "boolean" ||
    typeof value.showHotPools !== "boolean" ||
    typeof value.showScanTab !== "boolean"
  ) {
    return null;
  }
  return {
    colorTheme,
    customColor,
    navConfig,
    poolColumns,
    poolsPanelCollapsed: value.poolsPanelCollapsed,
    showHotPools: value.showHotPools,
    showScanTab: value.showScanTab,
    taskViewMode: value.taskViewMode,
    theme: value.theme,
  };
}

function parseVersionedPreferences(value: unknown): VersionedUserPreferences | null {
  if (!isRecord(value)) return null;
  const preferences = parsePreferences(value.preferences);
  if (
    !preferences ||
    value.schemaVersion !== userPreferenceSchemaVersion ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !(
      value.updatedAt === null ||
      (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)))
    )
  ) {
    return null;
  }
  return {
    preferences,
    revision: value.revision as number,
    schemaVersion: userPreferenceSchemaVersion,
    updatedAt: value.updatedAt as string | null,
  };
}

export class UserPreferencesClient {
  readonly #fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  get(): Promise<VersionedUserPreferences> {
    return this.#request("/api/user/preferences", { cache: "no-store", method: "GET" });
  }

  patch(request: UpdateUserPreferencesRequest): Promise<VersionedUserPreferences> {
    return this.#request("/api/user/preferences", {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
  }

  async #request(path: string, init: RequestInit): Promise<VersionedUserPreferences> {
    let response: Response;
    try {
      response = await this.#fetcher(path, { ...init, credentials: "include" });
    } catch {
      throw new PreferencesRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PreferencesRequestError("INVALID_RESPONSE", true, response.status);
    }
    if (!response.ok) {
      const error =
        isRecord(body) && isRecord(body.error) && typeof body.error.code === "string"
          ? body.error
          : null;
      throw new PreferencesRequestError(
        error ? (error.code as string) : "REQUEST_FAILED",
        error?.retryable === true,
        response.status,
      );
    }
    const data =
      isRecord(body) && body.success === true
        ? parseVersionedPreferences((body as unknown as PreferencesSuccessEnvelope).data)
        : null;
    if (!data) throw new PreferencesRequestError("INVALID_RESPONSE", true, response.status);
    return data;
  }
}
