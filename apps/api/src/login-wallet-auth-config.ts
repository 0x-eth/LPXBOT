import {
  LoginWalletAuthenticationService,
  type LoginWalletAuthStore,
} from "@lpbot/security";

export interface LoginWalletAuthEnvironment {
  AUTH_SESSION_TTL_SECONDS?: string;
  WALLET_AUTH_CHALLENGE_KEY_BASE64?: string;
  WALLET_AUTH_CHALLENGE_TTL_SECONDS?: string;
  WALLET_AUTH_DOMAIN?: string;
  WALLET_AUTH_URI?: string;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}

export function createLoginWalletAuthenticationFromEnvironment(
  store: LoginWalletAuthStore,
  environment: LoginWalletAuthEnvironment,
  options: { now?: () => Date } = {},
): LoginWalletAuthenticationService | null {
  const encodedKey = environment.WALLET_AUTH_CHALLENGE_KEY_BASE64?.trim() ?? "";
  if (encodedKey === "") return null;
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(encodedKey)) {
    throw new TypeError("WALLET_AUTH_CHALLENGE_KEY_BASE64 must encode exactly 32 bytes");
  }
  const challengeKey = Buffer.from(encodedKey, "base64");
  if (challengeKey.byteLength !== 32 || challengeKey.toString("base64") !== encodedKey) {
    throw new TypeError("WALLET_AUTH_CHALLENGE_KEY_BASE64 must encode exactly 32 bytes");
  }
  if (!environment.WALLET_AUTH_DOMAIN || !environment.WALLET_AUTH_URI) {
    throw new TypeError("Wallet authentication domain and URI are required when enabled");
  }

  return new LoginWalletAuthenticationService(store, {
    challengeKey,
    challengeTtlSeconds: positiveInteger(
      environment.WALLET_AUTH_CHALLENGE_TTL_SECONDS,
      300,
      "WALLET_AUTH_CHALLENGE_TTL_SECONDS",
    ),
    domain: environment.WALLET_AUTH_DOMAIN,
    ...(options.now ? { now: options.now } : {}),
    sessionTtlSeconds: positiveInteger(
      environment.AUTH_SESSION_TTL_SECONDS,
      3_600,
      "AUTH_SESSION_TTL_SECONDS",
    ),
    uri: environment.WALLET_AUTH_URI,
  });
}
