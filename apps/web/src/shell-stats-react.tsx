import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ApiShellStatsProvider,
  createShellStatsState,
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
  if (state.sequence < 0) {
    return <div aria-hidden="true" className="status-bar-reserved" />;
  }
  const display = shellStatsDisplay(state);
  return (
    <div
      aria-label="实时状态"
      className="shell-status-bar"
      data-connected={state.connected}
      data-visual-mask="stats"
      role="status"
    >
      <div className="status-primary">
        <span className="online-state" data-online={state.connected && state.stats?.online === true}>
          <span aria-hidden="true" className="online-dot" />
          {display.online}
        </span>
        <span>
          运行 <strong>{display.running}</strong>
        </span>
        <span>
          暂停 <strong>{display.paused}</strong>
        </span>
        <span>
          停止 <strong>{display.stopped}</strong>
        </span>
      </div>
      <div aria-label="推荐池" className="status-pools">
        {display.recommendedPools.length > 0 ? (
          display.recommendedPools.map((pool) => <span key={pool}>{pool}</span>)
        ) : (
          <span>推荐池 --</span>
        )}
      </div>
      <div className="status-metrics">
        <span>Base {display.baseGas}</span>
        <span>ETH {display.ethereumGas}</span>
        <span>FPS {display.fps}</span>
        <span>PING {display.ping}</span>
      </div>
    </div>
  );
}
