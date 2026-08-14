import type { AuthState } from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  Bell,
  Bot,
  Boxes,
  CircleUserRound,
  Code2,
  ExternalLink,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  RotateCw,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Wallet,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  AuthClient,
  authStatePath,
  canEnterRoute,
  type AuthPageState,
  type BotLoginView,
  type LoginWalletLinkView,
} from "./auth-client";
import { Eip1193WalletAdapter, browserEip1193Provider } from "./eip1193-wallet";
import { ConfirmDialog, FeedbackProvider, useFeedback } from "./feedback";
import { PwaUpdateBridge } from "./pwa-updates";
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
        {state.method === "wallet"
          ? "Waiting for wallet signature"
          : state.method === "telegram-mini-app"
            ? "Signing in with Telegram"
            : "Waiting for Telegram"}
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
          <button
            className="auth-method"
            disabled={busy}
            onClick={() =>
              void client.loginWithWallet(new Eip1193WalletAdapter(browserEip1193Provider()))
            }
            type="button"
          >
            <Wallet aria-hidden="true" size={20} />
            <span>Wallet</span>
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
            {page.retryable && botLogin.status === "error" ? (
              <button
                className="retry-button"
                onClick={() => void client.retryTelegramBotLogin()}
                type="button"
              >
                <RotateCw aria-hidden="true" size={17} />
                Retry Telegram login
              </button>
            ) : null}
            {page.retryable && botLogin.status !== "error" && miniAppAvailable ? (
              <button
                className="retry-button"
                onClick={() => void client.loginWithTelegramMiniApp(browserTelegramMiniAppAdapter)}
                type="button"
              >
                <RotateCw aria-hidden="true" size={17} />
                Retry Mini App login
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function LoginWalletSettings({ client }: { client: AuthClient }) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [links, setLinks] = useState<LoginWalletLinkView[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<LoginWalletLinkView | null>(null);
  const removeTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let current = true;
    void client.getLoginWalletLinks().then((nextLinks) => {
      if (!current) return;
      setLinks(nextLinks);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [client]);

  const bind = async () => {
    setBusy(true);
    const linked = await client.linkLoginWallet(
      new Eip1193WalletAdapter(browserEip1193Provider()),
      label.trim() === "" ? null : label,
    );
    if (linked) {
      setLinks((current) => [...current, linked]);
      setLabel("");
      feedback.show({
        dedupeKey: "login-wallet-linked",
        kind: "success",
        title: "登录钱包已绑定",
      });
    } else {
      feedback.show({
        dedupeKey: "login-wallet-link-failed",
        kind: "error",
        title: "登录钱包绑定失败，请重试",
      });
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    const linkId = pendingDelete.linkId;
    const deleted = await client.unlinkLoginWallet(linkId);
    if (deleted) {
      setLinks((current) => current.filter((link) => link.linkId !== linkId));
      feedback.show({
        dedupeKey: `login-wallet-removed:${linkId}`,
        kind: "success",
        title: "登录钱包已移除",
      });
    } else {
      feedback.show({
        dedupeKey: `login-wallet-remove-failed:${linkId}`,
        kind: "error",
        title: "登录钱包移除失败，请重试",
      });
    }
    setPendingDelete(null);
    setBusy(false);
  };

  return (
    <main className="workspace settings-workspace">
      <p className="eyebrow">Account</p>
      <h1>
        <span aria-hidden="true">设置</span>
        <span className="sr-only">Settings</span>
      </h1>
      <section className="settings-section" aria-labelledby="login-wallets-title">
        <div className="section-heading">
          <div>
            <SettingsIcon aria-hidden="true" size={18} />
            <h2 id="login-wallets-title">Login wallets</h2>
          </div>
          <span className="item-count" aria-label={`${links.length} linked wallets`}>
            {links.length}
          </span>
        </div>

        <form
          className="wallet-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            void bind();
          }}
        >
          <label>
            <span>Label</span>
            <input
              aria-label="Wallet label"
              disabled={busy}
              maxLength={64}
              onChange={(event) => setLabel(event.target.value)}
              type="text"
              value={label}
            />
          </label>
          <button className="command-button" disabled={busy} type="submit">
            <Wallet aria-hidden="true" size={17} />
            Link wallet
          </button>
        </form>

        <div className="login-wallet-list" aria-busy={loading}>
          {loading ? <p role="status">Loading login wallets</p> : null}
          {!loading && links.length === 0 ? <p className="empty-line">No login wallets</p> : null}
          {links.map((link) => (
            <article className="login-wallet-row" key={link.linkId}>
              <div className="wallet-mark" aria-hidden="true">
                <Wallet size={18} />
              </div>
              <div className="wallet-identity">
                <strong>{link.label ?? "Unlabeled"}</strong>
                <code>{link.addressMasked}</code>
              </div>
              <time dateTime={link.createdAt}>{new Date(link.createdAt).toLocaleDateString()}</time>
              <button
                aria-label={`Remove ${link.label ?? link.addressMasked}`}
                className="icon-button danger-button"
                disabled={busy}
                onClick={(event) => {
                  removeTrigger.current = event.currentTarget;
                  setPendingDelete(link);
                }}
                title="Remove login wallet"
                type="button"
              >
                <Trash2 aria-hidden="true" size={17} />
              </button>
            </article>
          ))}
        </div>
      </section>

      <ConfirmDialog
        cancelLabel="Cancel"
        confirmIcon={<Trash2 aria-hidden="true" size={17} />}
        confirmLabel="Confirm remove"
        description={pendingDelete?.label ?? pendingDelete?.addressMasked ?? ""}
        disabled={busy}
        onConfirm={() => void remove()}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onReturnFocus={() => removeTrigger.current?.focus()}
        open={pendingDelete !== null}
        title="Remove login wallet"
      />
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

function ConnectionUnavailablePage({ onRetry }: { onRetry(): void }) {
  return (
    <main className="state-page">
      <section className="state-content" aria-labelledby="connection-title">
        <div className="state-icon state-icon-warning" aria-hidden="true">
          <RotateCw size={26} strokeWidth={1.8} />
        </div>
        <p className="brand">LP Bot</p>
        <h1 id="connection-title">Connection unavailable</h1>
        <p className="state-message" role="alert">
          The application could not reach the service.
        </p>
        <button className="retry-button" onClick={onRetry} type="button">
          <RotateCw aria-hidden="true" size={17} />
          Retry connection
        </button>
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

const primaryNavigation = [
  { icon: LayoutDashboard, label: "任务", path: "/tasks/running", section: "/tasks" },
  { icon: Boxes, label: "池子", path: "/pools", section: "/pools" },
  { icon: Bot, label: "策略", path: "/strategies", section: "/strategies" },
  { icon: Activity, label: "日志", path: "/activity", section: "/activity" },
  { icon: WalletCards, label: "钱包", path: "/wallets", section: "/wallets" },
] as const;

function routeIsCurrent(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

function PrimaryNavigation({ onOpenChat }: { onOpenChat(trigger: HTMLButtonElement): void }) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="主导航" className="primary-navigation">
      {primaryNavigation.map(({ icon: Icon, label, path, section }) => (
        <Link
          aria-current={routeIsCurrent(pathname, section) ? "page" : undefined}
          className="primary-navigation-item"
          key={path}
          to={path}
        >
          <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>{label}</span>
          <span aria-hidden="true" className="nav-badge-slot" />
        </Link>
      ))}
      <button
        aria-haspopup="dialog"
        className="primary-navigation-item"
        onClick={(event) => onOpenChat(event.currentTarget)}
        type="button"
      >
        <MessageSquareText aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>聊天室</span>
        <span aria-hidden="true" className="nav-badge-slot" />
      </button>
    </nav>
  );
}

const routeFixtures = [
  {
    eyebrow: "Protected workspace",
    localizedTitle: "任务",
    path: "/tasks/*",
    title: "Tasks",
  },
  {
    eyebrow: "Local empty fixture",
    localizedTitle: "池子发现",
    path: "/pools",
    title: "Pools",
  },
  {
    eyebrow: "Local empty fixture",
    localizedTitle: "自动策略",
    path: "/strategies",
    title: "Strategies",
  },
  {
    eyebrow: "Local empty fixture",
    localizedTitle: "操作日志",
    path: "/activity",
    title: "Activity",
  },
  {
    eyebrow: "Local empty fixture",
    localizedTitle: "钱包管理",
    path: "/wallets",
    title: "Wallets",
  },
  {
    eyebrow: "Local empty fixture",
    localizedTitle: "开发者",
    path: "/developer",
    title: "Developer",
  },
] as const;

function EmptyFixturePage({
  eyebrow,
  localizedTitle,
  title,
}: {
  eyebrow: string;
  localizedTitle: string;
  title: string;
}) {
  const location = useLocation();
  if (
    import.meta.env.DEV &&
    title === "Developer" &&
    new URLSearchParams(location.search).get("fixture") === "route-error"
  ) {
    throw new Error("INTERNAL_FIXTURE_TOKEN requestBody={fixture}");
  }

  return (
    <main className="workspace route-workspace" data-fixture-state="empty">
      <p className="eyebrow">{eyebrow}</p>
      <h1>
        <span aria-hidden="true">{localizedTitle}</span>
        <span className="sr-only">{title}</span>
      </h1>
      <div className="empty-fixture" role="status">
        <Inbox aria-hidden="true" size={22} strokeWidth={1.7} />
        <p>暂无内容</p>
      </div>
    </main>
  );
}

class RouteErrorBoundary extends Component<
  { children: ReactNode; onRetry(): void; resetKey: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(previous: Readonly<{ resetKey: string }>): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="workspace">
        <p className="eyebrow">Route error</p>
        <h1>Page unavailable</h1>
        <p role="alert">This page could not be displayed safely.</p>
        <button className="retry-button route-retry" onClick={this.props.onRetry} type="button">
          <RotateCw aria-hidden="true" size={17} />
          Retry page
        </button>
      </main>
    );
  }
}

function LegacyAllRedirect() {
  const { status } = useParams();
  const allowed = status === "paused" || status === "stopped" ? status : "running";
  return <Navigate replace to={`/tasks/${allowed}`} />;
}

function mobileRouteTitle(pathname: string): string {
  if (pathname.startsWith("/tasks")) return "任务";
  if (pathname.startsWith("/pools")) return "池子";
  if (pathname.startsWith("/strategies")) return "策略";
  if (pathname.startsWith("/activity")) return "日志";
  if (pathname.startsWith("/wallets")) return "钱包";
  if (pathname.startsWith("/developer")) return "开发者";
  if (pathname.startsWith("/settings")) return "设置";
  if (pathname.startsWith("/users")) return "管理";
  return "LP Bot";
}

function Shell({ client, onClientChange, page, state }: ShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [chatOpen, setChatOpen] = useState(false);
  const chatTrigger = useRef<HTMLButtonElement | null>(null);

  const openChat = (trigger: HTMLButtonElement) => {
    chatTrigger.current = trigger;
    setChatOpen(true);
  };

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
        <Link className="wordmark" to="/tasks/running" aria-label="LP Bot" tabIndex={-1}>
          <img alt="" height="28" src="/pwa-192x192.png" width="28" />
          <span>LP Bot</span>
        </Link>
        <p className="mobile-route-title">{mobileRouteTitle(location.pathname)}</p>
        <PrimaryNavigation onOpenChat={openChat} />
        <div className="header-actions">
          <button
            aria-label="刷新"
            className="icon-button tooltip-control"
            data-tooltip="刷新"
            title="刷新"
            type="button"
            onClick={refresh}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
          <button
            aria-label="通知"
            className="icon-button tooltip-control"
            data-tooltip="通知"
            title="通知"
            type="button"
          >
            <Bell size={18} aria-hidden="true" />
          </button>
          <NavLink
            aria-label="设置"
            className="icon-button tooltip-control"
            data-tooltip="设置"
            title="设置"
            to="/settings"
          >
            <SettingsIcon size={18} aria-hidden="true" />
          </NavLink>
          <button
            aria-label="账户"
            className="icon-button tooltip-control account-action"
            data-tooltip="账户"
            data-visual-mask="account"
            title="账户"
            type="button"
          >
            <CircleUserRound size={18} aria-hidden="true" />
          </button>
          <button
            aria-label="退出"
            className="icon-button tooltip-control"
            data-tooltip="退出"
            title="退出"
            type="button"
            onClick={logout}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
          {state.session.role === "admin" ? (
            <NavLink
              aria-label="管理"
              className="icon-button tooltip-control admin-action"
              data-tooltip="管理"
              title="管理"
              to="/users"
            >
              <ShieldCheck aria-hidden="true" size={18} />
            </NavLink>
          ) : (
            <span aria-hidden="true" className="admin-action admin-action-placeholder" />
          )}
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
          {page.retryable ? (
            <button
              className="retry-button route-retry"
              onClick={() => void refresh()}
              type="button"
            >
              <RotateCw aria-hidden="true" size={17} />
              Retry request
            </button>
          ) : null}
        </main>
      ) : (
        <RouteErrorBoundary
          onRetry={() => {
            const url = new URL(window.location.href);
            if (import.meta.env.DEV) url.searchParams.delete("fixture");
            window.location.replace(`${url.pathname}${url.search}${url.hash}`);
          }}
          resetKey={`${location.pathname}${location.search}`}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/tasks/running" replace />} />
            <Route path="/all" element={<Navigate to="/tasks/running" replace />} />
            <Route path="/all/:status" element={<LegacyAllRedirect />} />
            <Route path="/monitors" element={<Navigate to="/pools" replace />} />
            <Route path="/settings" element={<LoginWalletSettings client={client} />} />
            {routeFixtures.map((fixture) => (
              <Route
                element={
                  <EmptyFixturePage
                    eyebrow={fixture.eyebrow}
                    localizedTitle={fixture.localizedTitle}
                    title={fixture.title}
                  />
                }
                key={fixture.path}
                path={fixture.path}
              />
            ))}
            <Route
              element={
                state.session.role === "admin" ? (
                  <main className="workspace">
                    <p className="eyebrow">Admin only</p>
                    <h1>
                      <span aria-hidden="true">用户管理</span>
                      <span className="sr-only">Users</span>
                    </h1>
                    <div className="empty-fixture" role="status">
                      <Code2 aria-hidden="true" size={22} />
                      <p>暂无内容</p>
                    </div>
                  </main>
                ) : (
                  <Navigate to="/tasks/running" replace />
                )
              }
              path="/users"
            />
            <Route path="*" element={<Navigate to="/tasks/running" replace />} />
          </Routes>
        </RouteErrorBoundary>
      )}
      <div aria-hidden="true" className="status-bar-reserved" />
      <div className="mobile-navigation-shell">
        <PrimaryNavigation onOpenChat={openChat} />
      </div>
      <Dialog.Root onOpenChange={setChatOpen} open={chatOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="drawer-overlay" />
          <Dialog.Content
            className="chat-drawer"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              chatTrigger.current?.focus();
            }}
          >
            <div className="drawer-heading">
              <Dialog.Title>最近聊天</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  aria-label="关闭最近聊天"
                  className="icon-button tooltip-control"
                  data-tooltip="关闭"
                  title="关闭"
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="drawer-empty">
              <MessageSquareText aria-hidden="true" size={22} strokeWidth={1.7} />
              <span>暂无最近聊天</span>
            </Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function AuthRouter() {
  const client = useMemo(() => new AuthClient(), []);
  const [page, setPage] = useState<AuthPageState>({ kind: "ready" });
  const [state, setState] = useState<AuthState>({ status: "booting" });
  const [botLogin, setBotLogin] = useState<BotLoginView>({ status: "idle" });
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => browserTelegramMiniAppAdapter.mount({ onBack: () => navigate(-1) }), [navigate]);
  useEffect(() => {
    const atRoot = location.pathname === "/tasks/running" || location.pathname === "/login";
    browserTelegramMiniAppAdapter.setBackButtonVisible(!atRoot);
  }, [location.pathname]);
  useEffect(() => {
    let current = true;
    const unsubscribe = client.subscribe((nextState, nextPage, nextBotLogin) => {
      if (!current) return;
      setState(nextState);
      setPage(nextPage);
      setBotLogin(nextBotLogin);
    });
    void client
      .restore()
      .then((next) => {
        if (!current) return;
        setState(next);
        setPage(client.page);
        setConnectionUnavailable(false);
      })
      .catch(() => {
        if (current) setConnectionUnavailable(true);
      });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [client]);

  const retryConnection = async () => {
    setConnectionUnavailable(false);
    setState({ status: "booting" });
    try {
      const next = await client.restore();
      setState(next);
      setPage(client.page);
    } catch {
      setConnectionUnavailable(true);
    }
  };

  if (connectionUnavailable) {
    return <ConnectionUnavailablePage onRetry={() => void retryConnection()} />;
  }
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
    <FeedbackProvider>
      <PwaUpdateBridge />
      <BrowserRouter>
        <AuthRouter />
      </BrowserRouter>
    </FeedbackProvider>
  );
}
