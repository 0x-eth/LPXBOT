import type {
  LiquidityFlowBackfill,
  LiquidityFlowRecord,
} from "@lpbot/api-contract";

export interface LiquidityFlowServerFilters {
  nftId: string;
  pool: string;
  token: string;
  user: string;
}

export interface LiquidityFlowCallbacks {
  getSince(): number;
  onBackfill(backfill: LiquidityFlowBackfill): void;
  onError(code: string): void;
  onEvent(record: LiquidityFlowRecord): void;
  onHeartbeat(): void;
  onOpen(): void;
  onReconnecting(): void;
}

export interface LiquidityFlowSubscription {
  close(): void;
}

const fatalStatuses = new Set([400, 401, 403, 404]);
const retryMilliseconds = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

export function buildLiquidityFlowStreamUrl(
  since: number,
  filters: LiquidityFlowServerFilters,
): string {
  const parameters = new URLSearchParams({ since: String(since) });
  if (filters.pool) parameters.set("pool", filters.pool.toLowerCase());
  if (filters.token) parameters.set("token", filters.token.toLowerCase());
  if (filters.user) parameters.set("user", filters.user.toLowerCase());
  if (filters.nftId) parameters.set("nft_id", filters.nftId);
  return `/api/liquidity-adds/stream?${parameters.toString()}`;
}

function parseSseBlock(
  block: string,
): { data: string; event: string; id: string | null } | "heartbeat" | null {
  if (block.startsWith(":")) return "heartbeat";
  let event = "message";
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("id:")) id = line.slice(3).trim() || null;
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { data: data.join("\n"), event, id } : null;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", done);
      window.clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class LiquidityFlowClient {
  subscribe(
    filters: LiquidityFlowServerFilters,
    callbacks: LiquidityFlowCallbacks,
  ): LiquidityFlowSubscription {
    const lifetime = new AbortController();
    let request: AbortController | null = null;
    let lastEventId: string | null = null;

    const run = async () => {
      let attempt = 0;
      while (!lifetime.signal.aborted) {
        request = new AbortController();
        const abortRequest = () => request?.abort();
        lifetime.signal.addEventListener("abort", abortRequest, { once: true });
        try {
          const headers: Record<string, string> = { Accept: "text/event-stream" };
          if (lastEventId) headers["Last-Event-ID"] = lastEventId;
          const response = await fetch(buildLiquidityFlowStreamUrl(callbacks.getSince(), filters), {
            credentials: "include",
            headers,
            signal: request.signal,
          });
          if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
            const status = response.status;
            callbacks.onError(`LIQUIDITY_FLOW_HTTP_${status}`);
            if (fatalStatuses.has(status)) return;
            throw new Error(`LIQUIDITY_FLOW_HTTP_${status}`);
          }
          if (!response.body) throw new Error("LIQUIDITY_FLOW_BODY_MISSING");
          callbacks.onOpen();
          attempt = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffered = "";
          while (!lifetime.signal.aborted) {
            const { done, value } = await reader.read();
            buffered += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
            let boundary = buffered.indexOf("\n\n");
            while (boundary >= 0) {
              const block = buffered.slice(0, boundary);
              buffered = buffered.slice(boundary + 2);
              const message = parseSseBlock(block);
              if (message === "heartbeat") callbacks.onHeartbeat();
              else if (message?.event === "backfill") {
                callbacks.onBackfill(JSON.parse(message.data) as LiquidityFlowBackfill);
                if (message.id) lastEventId = message.id;
              } else if (message?.event === "liquidity-add") {
                callbacks.onEvent(JSON.parse(message.data) as LiquidityFlowRecord);
                if (message.id) lastEventId = message.id;
              }
              boundary = buffered.indexOf("\n\n");
            }
            if (done) break;
          }
          if (lifetime.signal.aborted) return;
          throw new Error("LIQUIDITY_FLOW_STREAM_CLOSED");
        } catch (error) {
          if (lifetime.signal.aborted) return;
          callbacks.onError(error instanceof Error ? error.message : "LIQUIDITY_FLOW_STREAM_ERROR");
        } finally {
          lifetime.signal.removeEventListener("abort", abortRequest);
          request = null;
        }

        callbacks.onReconnecting();
        const delay = retryMilliseconds[Math.min(attempt, retryMilliseconds.length - 1)]!;
        attempt += 1;
        await wait(Math.floor(Math.random() * (delay + 1)), lifetime.signal);
      }
    };

    void run();
    return {
      close() {
        lifetime.abort();
        request?.abort();
      },
    };
  }
}
