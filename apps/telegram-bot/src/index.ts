import {
  apiContractPackage,
  type TelegramBotLoginConfirmationPort,
  type TelegramBotLoginConfirmationStatus,
} from "@lpbot/api-contract";
import { observabilityPackage } from "@lpbot/observability";
import { Bot } from "grammy";

export interface TelegramBotConfig {
  token: string;
  username: string;
}

export interface TelegramStartInput {
  telegramSubject: string;
  text: string | undefined;
  updateId: number;
}

export interface TelegramStartResponse {
  message: string;
  status: TelegramBotLoginConfirmationStatus;
}

const botUsernamePattern = /^[A-Za-z][A-Za-z0-9_]{4,31}$/u;
const telegramSubjectPattern = /^[1-9][0-9]{0,15}$/u;
const startPattern = /^\/start(?:@[A-Za-z][A-Za-z0-9_]{4,31})?\s+([A-Za-z0-9_-]{43})\s*$/u;

const statusMessages: Readonly<Record<TelegramBotLoginConfirmationStatus, string>> = {
  cancelled: "This login was cancelled. Generate a new link in LPBot.",
  confirmed: "Login confirmed. Return to LPBot to continue.",
  consumed: "This login link was already used. Generate a new link in LPBot.",
  expired: "This login link expired. Generate a new link in LPBot.",
  invalid: "This login link is invalid. Generate a new link in LPBot.",
  pending: "Login confirmation is pending.",
};

export function loadTelegramBotConfig(
  environment: Readonly<Record<string, string | undefined>>,
): TelegramBotConfig {
  const token = environment.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (token === "") throw new Error("TELEGRAM_BOT_TOKEN is required");

  const username = environment.TELEGRAM_BOT_USERNAME?.trim() ?? "";
  if (!botUsernamePattern.test(username)) {
    throw new Error("TELEGRAM_BOT_USERNAME is required and must be a valid Bot username");
  }
  return { token, username };
}

export async function handleTelegramStart(
  input: TelegramStartInput,
  confirmation: TelegramBotLoginConfirmationPort,
): Promise<TelegramStartResponse> {
  const token = input.text ? startPattern.exec(input.text)?.[1] : undefined;
  if (!token || !telegramSubjectPattern.test(input.telegramSubject)) {
    return { message: statusMessages.invalid, status: "invalid" };
  }

  const result = await confirmation.confirmLogin({
    requestId: `telegram-update-${String(input.updateId)}`,
    telegramSubject: input.telegramSubject,
    token,
  });
  return { message: statusMessages[result.status], status: result.status };
}

export function createTelegramBotAdapter(
  config: TelegramBotConfig,
  confirmation: TelegramBotLoginConfirmationPort,
): Bot {
  loadTelegramBotConfig({
    TELEGRAM_BOT_TOKEN: config.token,
    TELEGRAM_BOT_USERNAME: config.username,
  });
  const bot = new Bot(config.token);
  bot.command("start", async (context) => {
    const response = await handleTelegramStart(
      {
        telegramSubject: context.from ? String(context.from.id) : "",
        text: context.message?.text,
        updateId: context.update.update_id,
      },
      confirmation,
    );
    await context.reply(response.message);
  });
  return bot;
}

export const telegramBotApp = {
  contract: apiContractPackage.name,
  name: "@lpbot/telegram-bot",
  observability: observabilityPackage.name,
} as const;
