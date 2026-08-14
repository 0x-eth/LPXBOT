export const apiContractPackage = {
  name: "@lpbot/api-contract",
} as const;

export const telegramBotCancelContract = {
  method: "POST",
  path: "/api/auth/login-token/{token}/cancel",
  replicaInternal: true,
} as const;

export type TelegramBotLoginConfirmationStatus =
  | "pending"
  | "confirmed"
  | "consumed"
  | "cancelled"
  | "expired"
  | "invalid";

export interface TelegramBotLoginConfirmationInput {
  requestId: string;
  telegramSubject: string;
  token: string;
}

export interface TelegramBotLoginConfirmationPort {
  confirmLogin(
    input: TelegramBotLoginConfirmationInput,
  ): Promise<{ status: TelegramBotLoginConfirmationStatus }>;
}

export type Role = "user" | "pro" | "admin";
export type Tier = "normal" | "pro";
export type AccountBlockReason = "pending" | "rejected" | "banned";

export interface SessionView {
  allowedChainIds: number[];
  avatarUrl: string | null;
  displayName: string | null;
  maintenanceBypass: boolean;
  role: Role;
  tier: Tier;
  userId: string;
}

export type AuthState =
  | { status: "booting" }
  | { status: "anonymous" }
  | { status: "active"; session: SessionView }
  | { status: "blocked"; reason: AccountBlockReason; message: string | null }
  | { status: "maintenance"; message: string | null; until: string | null }
  | { status: "region-blocked"; region: string | null; message: string | null };

export interface ApiError {
  code: string;
  message: string;
  requestId: string | null;
  retryable: boolean;
}

export interface ErrorEnvelope {
  success: false;
  error: ApiError;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  requestId: string | null;
}

export function createErrorEnvelope(error: ApiError): ErrorEnvelope {
  return { success: false, error };
}

export function createSuccessEnvelope<T>(data: T, requestId: string | null): SuccessEnvelope<T> {
  return { success: true, data, requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSessionView(value: unknown): value is SessionView {
  if (!isRecord(value)) return false;

  return (
    typeof value.userId === "string" &&
    (value.role === "user" || value.role === "pro" || value.role === "admin") &&
    (value.tier === "normal" || value.tier === "pro") &&
    Array.isArray(value.allowedChainIds) &&
    value.allowedChainIds.every((chainId) => Number.isInteger(chainId)) &&
    (typeof value.displayName === "string" || value.displayName === null) &&
    (typeof value.avatarUrl === "string" || value.avatarUrl === null) &&
    typeof value.maintenanceBypass === "boolean"
  );
}

export function authStateDestination(state: AuthState): string | null {
  switch (state.status) {
    case "booting":
    case "active":
      return null;
    case "anonymous":
      return "/login";
    case "blocked":
    case "region-blocked":
      return "/blocked";
    case "maintenance":
      return "/maintenance";
  }
}
