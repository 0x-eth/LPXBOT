export type TelegramWebAppEvent = "themeChanged" | "viewportChanged";

interface TelegramBackButton {
  hide?(): void;
  offClick?(callback: () => void): void;
  onClick?(callback: () => void): void;
  show?(): void;
}

export interface TelegramWebApp {
  BackButton?: TelegramBackButton;
  expand?(): void;
  initData: string;
  offEvent?(event: TelegramWebAppEvent, callback: () => void): void;
  onEvent?(event: TelegramWebAppEvent, callback: () => void): void;
  ready?(): void;
  themeParams?: Record<string, string | undefined>;
  viewportHeight?: number;
  viewportStableHeight?: number;
}

interface TelegramStyleTarget {
  removeProperty(name: string): unknown;
  setProperty(name: string, value: string): unknown;
}

interface TelegramMiniAppFactoryOptions {
  getWebApp(): TelegramWebApp | undefined;
  style: TelegramStyleTarget | null;
}

export interface TelegramMiniAppAdapter {
  getInitData(): string | null;
  isAvailable?(): boolean;
  mount(options?: { onBack?(): void }): () => void;
  setBackButtonVisible(visible: boolean): void;
}

const themeKeys = [
  "accent_text_color",
  "bg_color",
  "button_color",
  "button_text_color",
  "destructive_text_color",
  "header_bg_color",
  "hint_color",
  "link_color",
  "secondary_bg_color",
  "section_bg_color",
  "section_header_text_color",
  "subtitle_text_color",
  "text_color",
] as const;

function cssThemeVariable(key: string): string {
  return `--tg-theme-${key.replaceAll("_", "-")}`;
}

function validThemeColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/iu.test(value);
}

export function createTelegramMiniAppAdapter(
  options: TelegramMiniAppFactoryOptions,
): TelegramMiniAppAdapter {
  const initializedWebApps = new WeakSet<object>();
  let mountedWebApp: TelegramWebApp | undefined;

  const syncViewport = (webApp: TelegramWebApp) => {
    for (const [property, value] of [
      ["--telegram-viewport-height", webApp.viewportHeight],
      ["--telegram-viewport-stable-height", webApp.viewportStableHeight],
    ] as const) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        options.style?.setProperty(property, `${value}px`);
      } else {
        options.style?.removeProperty(property);
      }
    }
  };

  const syncTheme = (webApp: TelegramWebApp) => {
    for (const key of themeKeys) {
      const property = cssThemeVariable(key);
      const value = webApp.themeParams?.[key];
      if (validThemeColor(value)) options.style?.setProperty(property, value);
      else options.style?.removeProperty(property);
    }
  };

  return {
    getInitData(): string | null {
      const initData = options.getWebApp()?.initData.trim() ?? "";
      return initData === "" ? null : initData;
    },
    isAvailable(): boolean {
      return (options.getWebApp()?.initData.trim() ?? "") !== "";
    },
    mount({ onBack } = {}): () => void {
      const webApp = options.getWebApp();
      if (!webApp) return () => undefined;
      mountedWebApp = webApp;
      const viewportChanged = () => syncViewport(webApp);
      const themeChanged = () => syncTheme(webApp);
      const backClicked = () => onBack?.();

      if (!initializedWebApps.has(webApp)) {
        webApp.ready?.();
        webApp.expand?.();
        initializedWebApps.add(webApp);
      }
      viewportChanged();
      themeChanged();
      webApp.onEvent?.("viewportChanged", viewportChanged);
      webApp.onEvent?.("themeChanged", themeChanged);
      webApp.BackButton?.onClick?.(backClicked);
      webApp.BackButton?.hide?.();

      return () => {
        webApp.offEvent?.("viewportChanged", viewportChanged);
        webApp.offEvent?.("themeChanged", themeChanged);
        webApp.BackButton?.offClick?.(backClicked);
        webApp.BackButton?.hide?.();
        if (mountedWebApp === webApp) mountedWebApp = undefined;
      };
    },
    setBackButtonVisible(visible: boolean): void {
      const backButton = (mountedWebApp ?? options.getWebApp())?.BackButton;
      if (visible) backButton?.show?.();
      else backButton?.hide?.();
    },
  };
}

interface TelegramBrowserGlobal {
  window?: {
    Telegram?: { WebApp?: TelegramWebApp };
  };
}

function telegramWebApp(): TelegramWebApp | undefined {
  return (globalThis as TelegramBrowserGlobal).window?.Telegram?.WebApp;
}

function browserStyle(): TelegramStyleTarget | null {
  return typeof document === "undefined" ? null : document.documentElement.style;
}

export const browserTelegramMiniAppAdapter = createTelegramMiniAppAdapter({
  getWebApp: telegramWebApp,
  style: browserStyle(),
});
