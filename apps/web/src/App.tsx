import type { AuthState } from "@lpbot/api-contract";
import {
  ExternalLink,
  LogOut,
  MessageCircle,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  AuthClient,
  authStatePath,
  canEnterRoute,
  type AuthPageState,
  type BotLoginView,
} from "./auth-client";
import { browserTelegramMiniAppAdapter } from "./telegram-mini-app";

function BootingPage() {
  return (
    <main className="state-page" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p role="status">Restoring session</p>
    </main>
  );
}

function AuthenticatingPage({
  state,
}: {
  state: Extract<AuthState, { status: "authenticating" }>;
}) {
  return (
    <main className="state-page" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p role="status">
        {state.method === "telegram-mini-app" ? "Signing in with Telegram" : "Waiting for Telegram"}
      </p>
    </main>
  );
}

interface LoginPageProps {
  botLogin: BotLoginView;
  client: AuthClient;
  page: AuthPageState;
  state: Extract<AuthState, { status: "anonymous" | "authenticating" }>;
}

function LoginPage({ botLogin, client, page, state }: LoginPageProps) {
  const miniAppAvailable = browserTelegramMiniAppAdapter.isAvailable?.() ?? false;
  const busy = state.status === "authenticating";

  return (
    <main className="state-page">
      <section className="state-content" aria-labelledby="login-title">
        <div className="state-icon" aria-hidden="true">
          <ShieldAlert size={26} strokeWidth={1.8} />
        </div>
        <p className="brand">LPBot</p>
        <h1 id="login-title">Sign in</h1>
        <p className="state-message">Choose a sign-in method</p>
        <div className="auth-methods" aria-label="Sign-in methods">
          <button
            className="auth-method"
            disabled={!miniAppAvailable || busy}
            onClick={() => void client.loginWithTelegramMiniApp(browserTelegramMiniAppAdapter)}
            type="button"
          >
            <MessageCircle aria-hidden="true" size={20} />
            <span>Telegram Mini App</span>
          </button>
          <button
            className="auth-method"
            disabled={busy}
            onClick={() => void client.startTelegramBotLogin()}
            type="button"
          >
            <MessageCircle aria-hidden="true" size={20} />
            <span>Telegram Bot</span>
          </button>
        </div>

        {botLogin.status === "creating" ? (
          <div className="bot-login-status" aria-busy="true" role="status">
            <span className="spinner spinner-small" aria-hidden="true" />
            Preparing login link
          </div>
        ) : null}
        {botLogin.status === "pending" ? (
          <div className="bot-login-status" role="status">
            <span>Waiting for confirmation</span>
            <div className="bot-login-actions">
              <a href={botLogin.loginUrl} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={17} />
                Open Telegram
              </a>
              <button
                aria-label="Cancel Telegram login"
                className="icon-button"
                onClick={() => void client.cancelTelegramBotLogin()}
                title="Cancel Telegram login"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
          </div>
        ) : null}
        {page.kind === "error" ? (
          <div className="login-error">
            <p role="alert">{page.message}</p>
            {page.retryable ? (
              <button
                className="retry-button"
                onClick={() => void client.retryTelegramBotLogin()}
                type="button"
              >
                <RotateCw aria-hidden="true" size={17} />
                Retry Telegram login
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function BlockedPage({
  state,
}: {
  state: Extract<AuthState, { status: "blocked" | "region-blocked" }>;
}) {
  const regionBlocked = state.status === "region-blocked";
  return (
    <main className="state-page">
      <section className="state-content" aria-labelledby="blocked-title">
        <div className="state-icon state-icon-danger" aria-hidden="true">
          <ShieldAlert size={26} strokeWidth={1.8} />
        </div>
        <p className="brand">LPBot access</p>
        <h1 id="blocked-title">{regionBlocked ? "Region unavailable" : "Account access"}</h1>
        <p className="reason" data-testid="blocked-reason">
          {regionBlocked ? "region-blocked" : state.reason}
        </p>
        <p className="state-message" role="status">
          {state.message ?? "Access is currently unavailable."}
        </p>
      </section>
    </main>
  );
}

function MaintenancePage({ state }: { state: Extract<AuthState, { status: "maintenance" }> }) {
  return (
    <main className="state-page">
      <section className="state-content" aria-labelledby="maintenance-title">
        <div className="state-icon state-icon-warning" aria-hidden="true">
          <Wrench size={26} strokeWidth={1.8} />
        </div>
        <p className="brand">LPBot service</p>
        <h1 id="maintenance-title">Maintenance</h1>
        <div className="state-message" role="status">
          <p>The service is temporarily unavailable.</p>
          {state.message ? <p>{state.message}</p> : null}
        </div>
        {state.until ? (
          <time dateTime={state.until}>Expected completion: {state.until}</time>
        ) : null}
      </section>
    </main>
  );
}

interface ShellProps {
  client: AuthClient;
  onClientChange(state: AuthState, page: AuthPageState): void;
  page: AuthPageState;
  state: Extract<AuthState, { status: "active" }>;
}

function Shell({ client, onClientChange, page, state }: ShellProps) {
  const navigate = useNavigate();

  const refresh = async () => {
    const next = await client.restore();
    onClientChange(next, client.page);
    const destination = authStatePath(next);
    if (destination) navigate(destination, { replace: true });
  };

  const logout = async () => {
    const next = await client.logout();
    onClientChange(next, client.page);
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-frame">
      <header className="app-header">
        <Link className="wordmark" to="/tasks/running" aria-label="LPBot tasks" tabIndex={-1}>
          LPBot
        </Link>
        <nav aria-label="Primary">
          <Link to="/tasks/running">Tasks</Link>
          {state.session.role === "admin" ? <Link to="/users">Users</Link> : null}
        </nav>
        <div className="header-actions">
          <span className="role-label">{state.session.role}</span>
          <button
            className="icon-button"
            type="button"
            onClick={refresh}
            aria-label="Refresh session"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
          <button className="icon-button" type="button" onClick={logout} aria-label="Sign out">
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>
      {page.kind === "forbidden" ? (
        <main className="workspace">
          <p className="eyebrow">Permission required</p>
          <h1>Access denied</h1>
          <p role="alert">{page.message}</p>
        </main>
      ) : page.kind === "error" ? (
        <main className="workspace">
          <p className="eyebrow">Request error</p>
          <h1>Request failed</h1>
          <p role="alert">{page.message}</p>
        </main>
      ) : (
        <Routes>
          <Route
            path="/tasks/:status"
            element={
              <main className="workspace">
                <p className="eyebrow">Protected workspace</p>
                <h1>Tasks</h1>
                <p>Session-backed task access is active.</p>
              </main>
            }
          />
          <Route
            path="/users"
            element={
              state.session.role === "admin" ? (
                <main className="workspace">
                  <p className="eyebrow">Admin only</p>
                  <h1>Users</h1>
                  <p>User administration</p>
                </main>
              ) : (
                <Navigate to="/tasks/running" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/tasks/running" replace />} />
        </Routes>
      )}
    </div>
  );
}

function AuthRouter() {
  const client = useMemo(() => new AuthClient(), []);
  const [page, setPage] = useState<AuthPageState>({ kind: "ready" });
  const [state, setState] = useState<AuthState>({ status: "booting" });
  const [botLogin, setBotLogin] = useState<BotLoginView>({ status: "idle" });
  const location = useLocation();
  useEffect(() => {
    let current = true;
    const unsubscribe = client.subscribe((nextState, nextPage, nextBotLogin) => {
      if (!current) return;
      setState(nextState);
      setPage(nextPage);
      setBotLogin(nextBotLogin);
    });
    void client.restore().then((next) => {
      if (!current) return;
      setState(next);
      setPage(client.page);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [client]);

  if (state.status === "booting") return <BootingPage />;
  const destination = authStatePath(state);
  if (destination && location.pathname !== destination) {
    return <Navigate to={destination} replace />;
  }
  if (
    state.status === "anonymous" ||
    (state.status === "authenticating" && state.method === "telegram-bot-link")
  ) {
    return <LoginPage botLogin={botLogin} client={client} page={page} state={state} />;
  }
  if (state.status === "authenticating") return <AuthenticatingPage state={state} />;
  if (state.status === "blocked" || state.status === "region-blocked") {
    return <BlockedPage state={state} />;
  }
  if (state.status === "maintenance") return <MaintenancePage state={state} />;

  const path = location.pathname;
  if (!canEnterRoute(path, state)) return <Navigate to="/tasks/running" replace />;
  return (
    <Shell
      client={client}
      onClientChange={(nextState, nextPage) => {
        setState(nextState);
        setPage(nextPage);
      }}
      page={page}
      state={state}
    />
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthRouter />
    </BrowserRouter>
  );
}
