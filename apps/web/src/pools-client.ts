import type {
  LiquidityFlowProtocol,
  MarketPoolByTokenRow,
  MarketPoolByTokenSort,
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

export function buildPoolsByTokenUrl(
  address: string,
  protocols: readonly string[],
  limit: number,
  sort: MarketPoolByTokenSort,
): string {
  const selected = canonicalizeLiquidityProtocols(protocols);
  const parameters = new URLSearchParams({
    chain: "bsc",
    dex: selected.join(","),
    limit: String(limit),
    sort,
  });
  return `/api/pools/by-token/${address.toLowerCase()}?${parameters.toString()}`;
}

export class PoolsClient {
  async getByToken(
    address: string,
    signal: AbortSignal,
    protocols: readonly LiquidityFlowProtocol[] = liquidityFlowProtocols,
    limit = 100,
    sort: MarketPoolByTokenSort = "fees",
  ): Promise<MarketPoolByTokenRow[]> {
    const response = await fetch(buildPoolsByTokenUrl(address, protocols, limit, sort), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`MARKET_TOKEN_HTTP_${response.status}`);
    const envelope = (await response.json()) as SuccessEnvelope<unknown>;
    if (!envelope.success || !Array.isArray(envelope.data)) {
      throw new Error("MARKET_TOKEN_RESPONSE_INVALID");
    }
    return envelope.data as MarketPoolByTokenRow[];
  }

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
