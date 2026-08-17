import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPoolEligibilityPolicy } from "@lpbot/domain";
import { Link } from "react-router-dom";

import { usePoolBlocklist } from "./pool-blocklist.js";
import {
  ApiShellStatsProvider,
  createShellStatsState,
  recommendedPoolDisplay,
  recommendedPoolSearchPath,
  shellStatsDisplay,
  type ShellStatsState,
} from "./shell-stats.js";

interface StatsSubscriptionProvider {
  subscribe(listener: (state: ShellStatsState) => void): () => void;
}

const ShellStatsContext = createContext<ShellStatsState | null>(null);

export function ShellStatsContextProvider({
  children,
  provider: suppliedProvider,
}: {
  children: ReactNode;
  provider?: StatsSubscriptionProvider;
}) {
  const provider = useMemo(
    () => suppliedProvider ?? new ApiShellStatsProvider(),
    [suppliedProvider],
  );
  const [state, setState] = useState(createShellStatsState);
  useEffect(() => provider.subscribe(setState), [provider]);
  return <ShellStatsContext.Provider value={state}>{children}</ShellStatsContext.Provider>;
}

// The provider and hook intentionally share a single context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useShellStats(): ShellStatsState {
  const state = useContext(ShellStatsContext);
  if (!state) throw new Error("ShellStatsContextProvider is missing");
  return state;
}

export function ShellStatusBar() {
  const state = useShellStats();
  const blocklist = usePoolBlocklist();
  const eligibility = useMemo(
    () =>
      createPoolEligibilityPolicy({
        blocklistHash: blocklist.snapshot?.blocklistHash ?? `sha256:${"0".repeat(64)}`,
        entries: blocklist.entries,
      }),
    [blocklist.entries, blocklist.snapshot?.blocklistHash],
  );
  const display = shellStatsDisplay(state, eligibility);
  const stateLabels = {
    empty: "暂无推荐池",
    loading: "推荐池加载中",
    ready: "推荐池已更新",
    reconnecting: "推荐池重连中",
    stale: "推荐池数据陈旧",
    unavailable: "推荐池不可用",
  } as const;
  return (
    <footer
      aria-label="实时状态"
      className="shell-status-bar"
      data-connected={state.connected}
      data-recommendation-state={display.recommendationStatus}
    >
      <span aria-live="polite" className="sr-only" role="status">
        {stateLabels[display.recommendationStatus]}
      </span>
      <div className="status-primary">
        <span
          className="online-state"
          data-online={state.connected && state.stats?.online === true}
          data-visual-mask="stats"
        >
          <span aria-hidden="true" className="online-dot" />
          {display.online}
        </span>
        <span>
          运行 <strong data-visual-mask="stats">{display.running}</strong>
        </span>
        <span>
          暂停 <strong data-visual-mask="stats">{display.paused}</strong>
        </span>
        <span>
          停止 <strong data-visual-mask="stats">{display.stopped}</strong>
        </span>
      </div>
      <div aria-label="推荐池" className="status-pools" data-state={display.recommendationStatus}>
        {display.recommendationStatus === "reconnecting" ||
        display.recommendationStatus === "stale" ? (
          <span className="status-pools-state">{stateLabels[display.recommendationStatus]}</span>
        ) : null}
        {display.recommendedPools.map((pool) => {
          const formatted = recommendedPoolDisplay(pool);
          return (
            <Link
              aria-label={`查看推荐池 ${formatted.pair}，5 分钟 Fees ${formatted.fees}`}
              className="status-pool-link"
              data-visual-mask="stats"
              key={pool.poolKey}
              title={`${formatted.pair} · 5m Fees ${formatted.fees}`}
              to={recommendedPoolSearchPath(pool)}
            >
              <strong>{formatted.pair}</strong>
              <span>5m Fees {formatted.fees}</span>
            </Link>
          );
        })}
        {display.recommendedPools.length === 0 ? (
          <span className="status-pools-state">{stateLabels[display.recommendationStatus]}</span>
        ) : null}
      </div>
      <div className="status-metrics">
        <span data-visual-mask="stats">Base {display.baseGas}</span>
        <span data-visual-mask="stats">ETH {display.ethereumGas}</span>
        <span data-visual-mask="stats">FPS {display.fps}</span>
        <span data-visual-mask="stats">PING {display.ping}</span>
      </div>
    </footer>
  );
}
