import { apiContractPackage } from "@lpbot/api-contract";
import { observabilityPackage } from "@lpbot/observability";

export const telegramBotApp = {
  contract: apiContractPackage.name,
  name: "@lpbot/telegram-bot",
  observability: observabilityPackage.name,
} as const;
