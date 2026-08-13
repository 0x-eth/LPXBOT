import {
  isSessionView,
  type AuthState,
  type ErrorEnvelope,
  type SessionView,
} from "@lpbot/api-contract";

export type AuthFetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

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
  readonly #fetcher: AuthFetch;
  #page: AuthPageState = { kind: "ready" };
  #state: AuthState = { status: "booting" };

  constructor(fetcher: AuthFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
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

  async restore(): Promise<AuthState> {
    const response = await this.request("/api/auth/me", { method: "POST" });
    if (response.ok) {
      const body: unknown = await response.json();
      if (!isAuthMeSuccess(body)) {
        this.#state = { status: "anonymous" };
        this.#page = {
          kind: "error",
          code: "INVALID_RESPONSE",
          message: "The session response was invalid",
          retryable: true,
        };
      } else {
        this.#state = { status: "active", session: body.data.user };
        this.#page = { kind: "ready" };
      }
    }
    return this.#state;
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
