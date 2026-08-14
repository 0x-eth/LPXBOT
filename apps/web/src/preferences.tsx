import {
  colorThemeKeys,
  defaultUserPreferences,
  navigationKeys,
  userPreferenceSchemaVersion,
  type ColorTheme,
  type NavigationKey,
  type UpdateUserPreferencesRequest,
  type UserPreferences,
  type VersionedUserPreferences,
} from "@lpbot/api-contract";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useFeedback } from "./feedback.js";
import { applyThemeToDocument } from "./theme.js";

export const themeBootstrapStorageKey = "lpbot-theme-bootstrap";

export type PreferencesStatus = "error" | "loading" | "ready" | "saving";

export interface UserPreferencesContextValue {
  preferences: UserPreferences;
  resetNavigation(): Promise<boolean>;
  retryLoad(): Promise<void>;
  status: PreferencesStatus;
  update(changes: Partial<UserPreferences>): Promise<boolean>;
  view: VersionedUserPreferences;
}

interface ThemeBootstrap {
  colorTheme: ColorTheme;
  customColor: string | null;
  theme: UserPreferences["theme"];
}

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

function parseThemeBootstrap(value: unknown): ThemeBootstrap | null {
  if (!isRecord(value)) return null;
  const colorTheme =
    typeof value.colorTheme === "string" && colorThemeKeys.includes(value.colorTheme as ColorTheme)
      ? (value.colorTheme as ColorTheme)
      : null;
  const customColor =
    value.customColor === null ||
    (typeof value.customColor === "string" && /^#[0-9A-F]{6}$/u.test(value.customColor))
      ? value.customColor
      : undefined;
  const theme =
    value.theme === "light" || value.theme === "dark" || value.theme === "system"
      ? value.theme
      : null;
  if (!colorTheme || customColor === undefined || !theme) return null;
  if (colorTheme === "custom" && customColor === null) return null;
  return { colorTheme, customColor, theme };
}

function readThemeBootstrap(): ThemeBootstrap | null {
  try {
    const value = globalThis.localStorage?.getItem(themeBootstrapStorageKey);
    return value ? parseThemeBootstrap(JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function writeThemeBootstrap(preferences: UserPreferences): void {
  try {
    globalThis.localStorage?.setItem(
      themeBootstrapStorageKey,
      JSON.stringify({
        colorTheme: preferences.colorTheme,
        customColor: preferences.customColor,
        theme: preferences.theme,
      } satisfies ThemeBootstrap),
    );
  } catch {
    // Storage can be disabled; the server remains authoritative.
  }
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

function parsePreferences(value: unknown): UserPreferences | null {
  if (!isRecord(value)) return null;
  const navConfig = parseNavigation(value.navConfig);
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

function initialView(): VersionedUserPreferences {
  const bootstrap = readThemeBootstrap();
  return {
    preferences: {
      ...structuredClone(defaultUserPreferences),
      ...(bootstrap ?? {}),
    },
    revision: 0,
    schemaVersion: userPreferenceSchemaVersion,
    updatedAt: null,
  };
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

export function UserPreferencesProvider({
  children,
  client: suppliedClient,
}: {
  children: ReactNode;
  client?: UserPreferencesClient;
}) {
  const client = useMemo(() => suppliedClient ?? new UserPreferencesClient(), [suppliedClient]);
  const feedback = useFeedback();
  const [view, setView] = useState<VersionedUserPreferences>(initialView);
  const [status, setStatus] = useState<PreferencesStatus>("loading");
  const serverView = useRef(view);
  const optimisticPreferences = useRef(view.preferences);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await client.get();
      serverView.current = next;
      optimisticPreferences.current = next.preferences;
      setView(next);
      writeThemeBootstrap(next.preferences);
      setStatus("ready");
    } catch {
      setStatus("error");
      feedback.show({
        action: { label: "重试", run: () => load() },
        dedupeKey: "preferences-load-failed",
        kind: "error",
        title: "界面设置加载失败",
      });
    }
  }, [client, feedback]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyThemeToDocument(view.preferences, media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [view.preferences]);

  const update = useCallback(
    async (changes: Partial<UserPreferences>): Promise<boolean> => {
      const optimistic = { ...optimisticPreferences.current, ...structuredClone(changes) };
      optimisticPreferences.current = optimistic;
      setView((current) => ({ ...current, preferences: optimistic }));
      writeThemeBootstrap(optimistic);
      pending.current += 1;
      setStatus("saving");

      const task = queue.current.then(async () => {
        const base = serverView.current;
        try {
          const saved = await client.patch({
            changes,
            expectedRevision: base.revision,
          });
          serverView.current = saved;
          feedback.show({
            dedupeKey: "preferences-saved",
            kind: "success",
            title: "界面设置已保存",
          });
          return true;
        } catch (error) {
          if (error instanceof PreferencesRequestError && error.code === "PREFERENCES_CONFLICT") {
            try {
              serverView.current = await client.get();
            } catch {
              // The last confirmed revision remains the rollback target.
            }
          }
          feedback.show({
            action: {
              label: "重试",
              run: async () => {
                await update(changes);
              },
            },
            dedupeKey: "preferences-save-failed",
            kind: "error",
            title: "界面设置保存失败，请重试",
          });
          return false;
        } finally {
          pending.current -= 1;
          if (pending.current === 0) {
            optimisticPreferences.current = serverView.current.preferences;
            setView(serverView.current);
            writeThemeBootstrap(serverView.current.preferences);
            setStatus("ready");
          }
        }
      });
      queue.current = task.then(() => undefined);
      return task;
    },
    [client, feedback],
  );

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      preferences: view.preferences,
      resetNavigation: () =>
        update({ navConfig: structuredClone(defaultUserPreferences.navConfig) }),
      retryLoad: load,
      status,
      update,
      view,
    }),
    [load, status, update, view],
  );
  return (
    <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
  );
}

// The provider and hook intentionally share a single context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useUserPreferences(): UserPreferencesContextValue {
  const context = useContext(UserPreferencesContext);
  if (!context) throw new Error("UserPreferencesProvider is missing");
  return context;
}
