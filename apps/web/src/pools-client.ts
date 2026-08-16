import type {
  LiquidityFlowProtocol,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
  MarketWindowMinutes,
  SuccessEnvelope,
} from "@lpbot/api-contract";
import { canonicalizeLiquidityProtocols, liquidityFlowProtocols } from "@lpbot/api-contract";

export interface PoolStreamSubscription {
  close(): void;
}

export interface PoolStreamCallbacks {
  onError(): void;
  onEvent(event: MarketStreamEnvelope): void;
  onOpen(): void;
}

export function buildMarketPoolsUrl(
  minutes: MarketWindowMinutes,
  protocols: readonly string[],
  stream: boolean,
): string {
  const selected = canonicalizeLiquidityProtocols(protocols);
  const path = `/api/pools/top-fees/${minutes}${stream ? "/stream" : ""}`;
  const parameters = new URLSearchParams({ chainId: "56" });
  if (selected.length !== liquidityFlowProtocols.length) parameters.set("dex", selected.join(","));
  return `${path}?${parameters.toString()}`;
}

export class PoolsClient {
  async getSnapshot(
    minutes: MarketWindowMinutes,
    signal: AbortSignal,
    protocols: readonly LiquidityFlowProtocol[] = liquidityFlowProtocols,
  ): Promise<MarketPoolSnapshot> {
    const response = await fetch(buildMarketPoolsUrl(minutes, protocols, false), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`MARKET_HTTP_${response.status}`);
    const envelope = (await response.json()) as SuccessEnvelope<MarketPoolSnapshot>;
    if (!envelope.success || envelope.data.chainId !== 56 || envelope.data.minutes !== minutes) {
      throw new Error("MARKET_RESPONSE_INVALID");
    }
    return envelope.data;
  }

  subscribe(
    minutes: MarketWindowMinutes,
    callbacks: PoolStreamCallbacks,
    protocols: readonly LiquidityFlowProtocol[] = liquidityFlowProtocols,
  ): PoolStreamSubscription {
    const source = new EventSource(buildMarketPoolsUrl(minutes, protocols, true), {
      withCredentials: true,
    });
    const receive = (message: MessageEvent<string>) => {
      try {
        callbacks.onEvent(JSON.parse(message.data) as MarketStreamEnvelope);
      } catch {
        callbacks.onError();
      }
    };
    source.addEventListener("pools.snapshot", receive as EventListener);
    source.addEventListener("pools.diff", receive as EventListener);
    source.addEventListener("heartbeat", receive as EventListener);
    source.onopen = callbacks.onOpen;
    source.onerror = callbacks.onError;
    return { close: () => source.close() };
  }
}
