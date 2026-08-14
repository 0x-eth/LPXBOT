import {
  isSessionView,
  type AuthState,
  type ErrorEnvelope,
  type SessionView,
} from "@lpbot/api-contract";

import type { TelegramMiniAppAdapter } from "./telegram-mini-app";

export type AuthFetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export interface AuthBroadcastChannel {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
  postMessage(message: unknown): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface AuthClientOptions {
  broadcastChannel?: AuthBroadcastChannel | null;
  maxPollAttempts?: number;
  now?: () => number;
  pollInitialDelayMs?: number;
}

export type BotLoginView =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "pending"; expiresAt: string; loginUrl: string }
  | { status: "consumed" }
  | { status: "cancelled" }
  | { status: "expired" }
  | { status: "error"; message: string; retryable: boolean };

export type AuthPageState =
  | { kind: "ready" }
  | { kind: "forbidden"; code: "FORBIDDEN"; message: string }
  | { kind: "error"; code: string; message: string; retryable: boolean };

interface AuthMeSuccess {
  success: true;
  data: {
    isAdmin: boolean;
    maintenance: { enabled: boolean; message: string | null; until: string | null } | null;
    user: SessionView;
  };
  requestId: string | null;
}

interface BotLoginCreateSuccess {
  success: true;
  data: { expiresAt: string; loginUrl: string; token: string };
  requestId: string | null;
}

interface BotLoginStatusSuccess {
  success: true;
  data: {
    confirmed: boolean;
    session: SessionView | null;
    status: "pending" | "consumed";
  };
  requestId: string | null;
}

interface BotLoginFlow {
  attempts: number;
  controller: AbortController;
  expiresAt: number;
  expiresAtText: string;
  loginUrl: string;
  timer: ReturnType<typeof setTimeout> | null;
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ErrorEnvelope>;
  const error = candidate.error;
  return (
    candidate.success === false &&
    typeof error === "object" &&
    error !== null &&
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean"
  );
}

function isAuthMeSuccess(value: unknown): value is AuthMeSuccess {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AuthMeSuccess>;
  return (
    candidate.success === true &&
    typeof candidate.data === "object" &&
    candidate.data !== null &&
    isSessionView(candidate.data.user)
  );
}

function isBotLoginCreateSuccess(value: unknown, now: number): value is BotLoginCreateSuccess {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false;
  const { expiresAt, loginUrl, token } = value.data;
  if (
    typeof expiresAt !== "string" ||
    typeof loginUrl !== "string" ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(token)
  ) {
    return false;
  }
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) return false;
  try {
    const url = new URL(loginUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "t.me" &&
      url.searchParams.get("start") === token
    );
  } catch {
    return false;
  }
}

function isBotLoginStatusSuccess(value: unknown): value is BotLoginStatusSuccess {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false;
  if (value.data.status === "pending") {
    return value.data.confirmed === false && value.data.session === null;
  }
  return (
    value.data.status === "consumed" &&
    value.data.confirmed === true &&
    isSessionView(value.data.session)
  );
}

function defaultBroadcastChannel(): AuthBroadcastChannel | null {
  if (typeof window === "undefined" || typeof window.BroadcastChannel !== "function") return null;
  return new window.BroadcastChannel("lpbot-auth");
}

function blockedReason(code: string): "pending" | "rejected" | "banned" | null {
  switch (code) {
    case "ACCOUNT_PENDING":
      return "pending";
    case "ACCOUNT_REJECTED":
      return "rejected";
    case "ACCOUNT_BANNED":
      return "banned";
    default:
      return null;
  }
}

export class AuthClient {
  #bearerToken: string | null = null;
  #botLogin: BotLoginView = { status: "idle" };
  #botLoginFlow: BotLoginFlow | null = null;
  readonly #broadcastChannel: AuthBroadcastChannel | null;
  readonly #broadcastListener: (event: { data: unknown }) => void;
  readonly #fetcher: AuthFetch;
  readonly #maxPollAttempts: number;
  readonly #now: () => number;
  #page: AuthPageState = { kind: "ready" };
  readonly #pollInitialDelayMs: number;
  #restorePromise: Promise<AuthState> | null = null;
  #state: AuthState = { status: "booting" };

  constructor(
    fetcher: AuthFetch = globalThis.fetch.bind(globalThis),
    options: AuthClientOptions = {},
  ) {
    this.#fetcher = fetcher;
    this.#now = options.now ?? (() => Date.now());
    this.#maxPollAttempts = options.maxPollAttempts ?? 12;
    this.#pollInitialDelayMs = options.pollInitialDelayMs ?? 750;
    if (!Number.isSafeInteger(this.#maxPollAttempts) || this.#maxPollAttempts <= 0) {
      throw new RangeError("Maximum Bot poll attempts must be a positive integer");
    }
    if (!Number.isSafeInteger(this.#pollInitialDelayMs) || this.#pollInitialDelayMs <= 0) {
      throw new RangeError("Initial Bot poll delay must be a positive integer");
    }
    this.#broadcastChannel = options.broadcastChannel ?? defaultBroadcastChannel();
    this.#broadcastListener = (event) => {
      if (
        isRecord(event.data) &&
        event.data.type === "auth-complete" &&
        Object.keys(event.data).length === 1
      ) {
        void this.restore();
      }
    };
    this.#broadcastChannel?.addEventListener("message", this.#broadcastListener);
  }

  get botLogin(): BotLoginView {
    return this.#botLogin;
  }

  get page(): AuthPageState {
    return this.#page;
  }

  get session(): SessionView | null {
    return this.#state.status === "active" ? this.#state.session : null;
  }

  get state(): AuthState {
    return this.#state;
  }

  dispose(): void {
    this.#stopBotFlow();
    this.#broadcastChannel?.removeEventListener("message", this.#broadcastListener);
    this.#broadcastChannel?.close();
  }

  setBearerToken(token: string | null): void {
    this.#bearerToken = token;
  }

  async logout(): Promise<AuthState> {
    try {
      await this.request("/api/auth/logout", { method: "POST" });
    } finally {
      this.#bearerToken = null;
      this.#state = { status: "anonymous" };
      this.#page = { kind: "ready" };
    }
    return this.#state;
  }

  async loginWithTelegramMiniApp(adapter: TelegramMiniAppAdapter): Promise<AuthState> {
    const initData = adapter.getInitData();
    if (!initData) {
      this.#state = { status: "anonymous" };
      this.#page = {
        kind: "error",
        code: "TELEGRAM_MINI_APP_UNAVAILABLE",
        message: "Telegram Mini App authentication is unavailable",
        retryable: false,
      };
      return this.#state;
    }

    this.#state = { status: "authenticating", method: "telegram-mini-app" };
    this.#page = { kind: "ready" };
    const response = await this.request("/api/auth/me", {
      body: JSON.stringify({ initData }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (response.ok) await this.#acceptAuthMeResponse(response);
    return this.#state;
  }

  async startTelegramBotLogin(): Promise<BotLoginView> {
    this.#stopBotFlow();
    const controller = new AbortController();
    this.#state = { status: "authenticating", method: "telegram-bot-link" };
    this.#page = { kind: "ready" };
    this.#botLogin = { status: "creating" };

    let response: Response;
    try {
      response = await this.request("/api/auth/login-token", {
        method: "POST",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return this.#botLogin;
      this.#botFailure("NETWORK_ERROR", "The Telegram login link could not be created", true);
      return this.#botLogin;
    }
    if (!response.ok) {
      this.#state = { status: "anonymous" };
      this.#botLogin = {
        status: "error",
        message: this.#page.kind === "error" ? this.#page.message : "Telegram login is unavailable",
        retryable: this.#page.kind === "error" ? this.#page.retryable : false,
      };
      return this.#botLogin;
    }

    const body: unknown = await response.json();
    if (!isBotLoginCreateSuccess(body, this.#now())) {
      this.#botFailure("INVALID_RESPONSE", "The Telegram login response was invalid", true);
      return this.#botLogin;
    }

    const flow: BotLoginFlow = {
      attempts: 0,
      controller,
      expiresAt: Date.parse(body.data.expiresAt),
      expiresAtText: body.data.expiresAt,
      loginUrl: body.data.loginUrl,
      timer: null,
      token: body.data.token,
    };
    this.#botLoginFlow = flow;
    this.#botLogin = {
      expiresAt: flow.expiresAtText,
      loginUrl: flow.loginUrl,
      status: "pending",
    };
    await this.#pollTelegramBotLogin(flow);
    return this.#botLogin;
  }

  async restore(): Promise<AuthState> {
    if (this.#restorePromise) return this.#restorePromise;
    this.#restorePromise = this.#performRestore();
    try {
      return await this.#restorePromise;
    } finally {
      this.#restorePromise = null;
    }
  }

  async #performRestore(): Promise<AuthState> {
    const response = await this.request("/api/auth/me", { method: "POST" });
    if (response.ok) await this.#acceptAuthMeResponse(response);
    return this.#state;
  }

  async #acceptAuthMeResponse(response: Response): Promise<void> {
    const body: unknown = await response.json();
    if (!isAuthMeSuccess(body)) {
      this.#state = { status: "anonymous" };
      this.#page = {
        kind: "error",
        code: "INVALID_RESPONSE",
        message: "The session response was invalid",
        retryable: true,
      };
      return;
    }
    this.#state = { status: "active", session: body.data.user };
    this.#page = { kind: "ready" };
  }

  async request(input: Request | string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.#bearerToken) headers.set("Authorization", `Bearer ${this.#bearerToken}`);
    const response = await this.#fetcher(input, {
      ...init,
      credentials: "include",
      headers: Object.fromEntries(headers.entries()),
    });

    if (response.ok) return response;
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    if (!isErrorEnvelope(body)) {
      this.#page = {
        kind: "error",
        code: "INVALID_RESPONSE",
        message: "The server returned an invalid error response",
        retryable: true,
      };
      return response;
    }

    if (response.status === 401) {
      this.#bearerToken = null;
      this.#state = { status: "anonymous" };
      this.#page = { kind: "ready" };
      return response;
    }

    const reason = response.status === 403 ? blockedReason(body.error.code) : null;
    if (reason) {
      this.#state = { status: "blocked", reason, message: body.error.message };
      this.#page = { kind: "ready" };
    } else if (response.status === 403 && body.error.code === "REGION_BLOCKED") {
      this.#state = {
        status: "region-blocked",
        region: null,
        message: body.error.message,
      };
      this.#page = { kind: "ready" };
    } else if (response.status === 503 && body.error.code === "MAINTENANCE") {
      this.#state = {
        status: "maintenance",
        message: body.error.message,
        until: null,
      };
      this.#page = { kind: "ready" };
    } else if (response.status === 403 && body.error.code === "FORBIDDEN") {
      this.#page = {
        kind: "forbidden",
        code: "FORBIDDEN",
        message: body.error.message,
      };
    } else {
      this.#page = {
        kind: "error",
        code: body.error.code,
        message: body.error.message,
        retryable: body.error.retryable,
      };
    }

    return response;
  }

  #botFailure(code: string, message: string, retryable: boolean): void {
    this.#state = { status: "anonymous" };
    this.#page = { kind: "error", code, message, retryable };
    this.#botLogin = { status: "error", message, retryable };
  }

  async #pollTelegramBotLogin(flow: BotLoginFlow): Promise<void> {
    if (this.#botLoginFlow !== flow || flow.controller.signal.aborted) return;
    if (flow.attempts >= this.#maxPollAttempts || this.#now() >= flow.expiresAt) {
      this.#state = { status: "anonymous" };
      this.#page = {
        kind: "error",
        code: "LOGIN_TOKEN_EXPIRED",
        message: "The Telegram login link expired",
        retryable: true,
      };
      this.#botLogin = { status: "expired" };
      this.#stopBotFlow();
      return;
    }

    flow.attempts += 1;
    let response: Response;
    try {
      response = await this.request(`/api/auth/login-status/${flow.token}`, {
        method: "GET",
        signal: flow.controller.signal,
      });
    } catch {
      if (flow.controller.signal.aborted) return;
      this.#botFailure("NETWORK_ERROR", "Telegram login status could not be checked", true);
      return;
    }

    if (!response.ok) {
      this.#state = { status: "anonymous" };
      this.#botLogin = {
        status: "error",
        message: this.#page.kind === "error" ? this.#page.message : "Telegram login failed",
        retryable: this.#page.kind === "error" ? this.#page.retryable : false,
      };
      this.#stopBotFlow();
      return;
    }
    const body: unknown = await response.json();
    if (!isBotLoginStatusSuccess(body)) {
      this.#botFailure("INVALID_RESPONSE", "The Telegram login status was invalid", true);
      this.#stopBotFlow();
      return;
    }
    if (body.data.status === "consumed" && body.data.session) {
      this.#state = { status: "active", session: body.data.session };
      this.#page = { kind: "ready" };
      this.#botLogin = { status: "consumed" };
      this.#stopBotFlow();
      this.#broadcastChannel?.postMessage({ type: "auth-complete" });
      return;
    }

    const delay = Math.min(
      Math.round(this.#pollInitialDelayMs * 1.6 ** (flow.attempts - 1)),
      5_000,
    );
    flow.timer = setTimeout(() => {
      flow.timer = null;
      void this.#pollTelegramBotLogin(flow);
    }, delay);
  }

  #stopBotFlow(): void {
    const flow = this.#botLoginFlow;
    this.#botLoginFlow = null;
    if (!flow) return;
    if (flow.timer) clearTimeout(flow.timer);
    flow.token = "";
    flow.controller.abort();
  }
}

export function canEnterRoute(path: string, state: AuthState): boolean {
  if (path === "/login") return state.status === "anonymous";
  if (path === "/blocked") {
    return state.status === "blocked" || state.status === "region-blocked";
  }
  if (path === "/maintenance") return state.status === "maintenance";
  if (state.status !== "active") return false;
  return path !== "/users" || state.session.role === "admin";
}

export function authStatePath(state: AuthState): string | null {
  switch (state.status) {
    case "booting":
    case "active":
      return null;
    case "anonymous":
    case "authenticating":
      return "/login";
    case "blocked":
    case "region-blocked":
      return "/blocked";
    case "maintenance":
      return "/maintenance";
  }
}
