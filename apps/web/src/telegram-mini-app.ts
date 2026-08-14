export interface TelegramMiniAppAdapter {
  getInitData(): string | null;
}

interface TelegramWebApp {
  initData: string;
  ready?(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const browserTelegramMiniAppAdapter: TelegramMiniAppAdapter = {
  getInitData(): string | null {
    const webApp = globalThis.window?.Telegram?.WebApp;
    const initData = webApp?.initData.trim() ?? "";
    if (initData === "") return null;
    webApp?.ready?.();
    return initData;
  },
};
