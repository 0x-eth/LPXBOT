import { createTelegramMiniAppAdapter } from "../apps/web/src/telegram-mini-app.js";
import { describe, expect, it, vi } from "vitest";

describe("Telegram Web App browser adapter", () => {
  it("owns ready, expand, viewport/theme events and BackButton lifecycle", () => {
    const callbacks = new Map<string, () => void>();
    const properties = new Map<string, string>();
    const backClick = vi.fn();
    const webApp = {
      BackButton: {
        hide: vi.fn(),
        offClick: vi.fn(),
        onClick: vi.fn((callback: () => void) => callbacks.set("back", callback)),
        show: vi.fn(),
      },
      expand: vi.fn(),
      initData: "fixture-init-data",
      offEvent: vi.fn(),
      onEvent: vi.fn((name: string, callback: () => void) => callbacks.set(name, callback)),
      ready: vi.fn(),
      themeParams: { bg_color: "#ffffff", text_color: "#171717" },
      viewportHeight: 640,
      viewportStableHeight: 612,
    };
    const adapter = createTelegramMiniAppAdapter({
      getWebApp: () => webApp,
      style: {
        removeProperty: (name) => properties.delete(name),
        setProperty: (name, value) => properties.set(name, value),
      },
    });

    const cleanup = adapter.mount({ onBack: backClick });

    expect(webApp.ready).toHaveBeenCalledOnce();
    expect(webApp.expand).toHaveBeenCalledOnce();
    expect(properties).toMatchObject(
      new Map([
        ["--telegram-viewport-height", "640px"],
        ["--telegram-viewport-stable-height", "612px"],
        ["--tg-theme-bg-color", "#ffffff"],
        ["--tg-theme-text-color", "#171717"],
      ]),
    );

    adapter.setBackButtonVisible(true);
    expect(webApp.BackButton.show).toHaveBeenCalledOnce();
    callbacks.get("back")?.();
    expect(backClick).toHaveBeenCalledOnce();

    webApp.viewportHeight = 700;
    callbacks.get("viewportChanged")?.();
    expect(properties.get("--telegram-viewport-height")).toBe("700px");

    cleanup();
    expect(webApp.offEvent).toHaveBeenCalledTimes(2);
    expect(webApp.BackButton.offClick).toHaveBeenCalledWith(expect.any(Function));
    expect(webApp.BackButton.hide).toHaveBeenCalled();
  });
});
