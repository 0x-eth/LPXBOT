import type { TelegramBotLoginConfirmationPort } from "../packages/api-contract/src/index.js";
import { handleTelegramStart, loadTelegramBotConfig } from "../apps/telegram-bot/src/index.js";
import { describe, expect, it, vi } from "vitest";

const token = "A".repeat(43);

describe("Telegram Bot /start adapter", () => {
  it("confirms a one-time token through the shared application contract", async () => {
    const confirmLogin = vi.fn<TelegramBotLoginConfirmationPort["confirmLogin"]>(async () => ({
      status: "confirmed",
    }));

    const response = await handleTelegramStart(
      { telegramSubject: "42", text: `/start ${token}`, updateId: 9001 },
      { confirmLogin },
    );

    expect(confirmLogin).toHaveBeenCalledWith({
      requestId: "telegram-update-9001",
      telegramSubject: "42",
      token,
    });
    expect(response).toEqual({
      message: "Login confirmed. Return to LPBot to continue.",
      status: "confirmed",
    });
  });

  it("does not call the application contract for missing or malformed start parameters", async () => {
    const confirmLogin = vi.fn<TelegramBotLoginConfirmationPort["confirmLogin"]>();

    await expect(
      handleTelegramStart(
        { telegramSubject: "42", text: "/start", updateId: 9002 },
        { confirmLogin },
      ),
    ).resolves.toEqual({
      message: "This login link is invalid. Generate a new link in LPBot.",
      status: "invalid",
    });
    expect(confirmLogin).not.toHaveBeenCalled();
  });

  it("fails closed when Bot token or username configuration is absent", () => {
    expect(() => loadTelegramBotConfig({})).toThrow("TELEGRAM_BOT_TOKEN");
    expect(() =>
      loadTelegramBotConfig({
        TELEGRAM_BOT_TOKEN: "local-token",
        TELEGRAM_BOT_USERNAME: "",
      }),
    ).toThrow("TELEGRAM_BOT_USERNAME");
    expect(
      loadTelegramBotConfig({
        TELEGRAM_BOT_TOKEN: "local-token",
        TELEGRAM_BOT_USERNAME: "local_fixture_bot",
      }),
    ).toEqual({ token: "local-token", username: "local_fixture_bot" });
  });
});
