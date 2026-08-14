export interface TelegramMiniAppAdapter {
  getInitData(): string | null;
  isAvailable?(): boolean;
}

interface TelegramWebApp {
  initData: string;
  ready?(): void;
}

interface TelegramBrowserGlobal {
  window?: {
    Telegram?: { WebApp?: TelegramWebApp };
  };
}

function telegramWebApp(): TelegramWebApp | undefined {
  return (globalThis as TelegramBrowserGlobal).window?.Telegram?.WebApp;
}

export const browserTelegramMiniAppAdapter: TelegramMiniAppAdapter = {
  getInitData(): string | null {
    const webApp = telegramWebApp();
    const initData = webApp?.initData.trim() ?? "";
    if (initData === "") return null;
    webApp?.ready?.();
    return initData;
  },
  isAvailable(): boolean {
    return (telegramWebApp()?.initData.trim() ?? "") !== "";
  },
};
