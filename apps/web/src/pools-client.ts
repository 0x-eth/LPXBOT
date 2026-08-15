import type {
  MarketPoolSnapshot,
  MarketStreamEnvelope,
  MarketWindowMinutes,
  SuccessEnvelope,
} from "@lpbot/api-contract";

export interface PoolStreamSubscription {
  close(): void;
}

export interface PoolStreamCallbacks {
  onError(): void;
  onEvent(event: MarketStreamEnvelope): void;
  onOpen(): void;
}

export class PoolsClient {
  async getSnapshot(
    minutes: MarketWindowMinutes,
    signal: AbortSignal,
  ): Promise<MarketPoolSnapshot> {
    const response = await fetch(`/api/pools/top-fees/${minutes}?chainId=56`, {
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
  ): PoolStreamSubscription {
    const source = new EventSource(`/api/pools/top-fees/${minutes}/stream?chainId=56`, {
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

