import {
  colorThemeKeys,
  defaultUserPreferences,
  userPreferenceSchemaVersion,
  type ColorTheme,
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
import { PreferencesRequestError, UserPreferencesClient } from "./preferences-client.js";
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
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    void client.get().then(
      (next) => {
        if (!active) return;
        serverView.current = next;
        optimisticPreferences.current = next.preferences;
        setView(next);
        writeThemeBootstrap(next.preferences);
        setStatus("ready");
      },
      () => {
        if (active) setStatus("error");
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyThemeToDocument(view.preferences, media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [view.preferences]);

  const update = useCallback(
    async function updatePreferences(changes: Partial<UserPreferences>): Promise<boolean> {
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
                await updatePreferences(changes);
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
