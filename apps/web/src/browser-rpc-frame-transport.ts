export type BrowserRpcFrameFailure = "invalid-response" | "network-error" | "timeout";

export class BrowserRpcFrameTransportError extends Error {
  readonly failure: BrowserRpcFrameFailure;

  constructor(failure: BrowserRpcFrameFailure) {
    super("Browser RPC frame transport failed");
    this.name = "BrowserRpcFrameTransportError";
    this.failure = failure;
  }
}

interface BrowserRpcFrameLimits {
  responseBodyBytes: number;
  timeoutMs: number;
}

const channel = "lpbot-browser-readonly-rpc-v1";
let requestSequence = 0;

function frameDocument(limits: BrowserRpcFrameLimits): string {
  return `<!doctype html><meta charset="utf-8"><script>
"use strict";
const CHANNEL = ${JSON.stringify(channel)};
const MAX_BYTES = ${String(limits.responseBodyBytes)};
const TIMEOUT_MS = ${String(limits.timeoutMs)};
const integerPattern = /^(?:0|[1-9][0-9]*)$/;

function send(target, id, failure, body, status, declaredLength) {
  target.postMessage({ channel: CHANNEL, id, failure, body, status, declaredLength }, "*");
}

addEventListener("message", async (event) => {
  const message = event.data;
  if (
    event.source !== parent ||
    !message ||
    message.channel !== CHANNEL ||
    typeof message.id !== "number" ||
    typeof message.url !== "string" ||
    typeof message.body !== "string"
  ) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(message.url, {
        body: message.body,
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
        mode: "cors",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch {
      send(event.source, message.id, controller.signal.aborted ? "timeout" : "network-error");
      return;
    }
    if (!response.ok || response.redirected) {
      send(event.source, message.id, "network-error");
      return;
    }

    const declaredLength = response.headers.get("Content-Length");
    if (
      declaredLength !== null &&
      (!integerPattern.test(declaredLength) || BigInt(declaredLength) > BigInt(MAX_BYTES))
    ) {
      send(event.source, message.id, "invalid-response");
      return;
    }

    const reader = response.body && response.body.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          send(event.source, message.id, "invalid-response");
          return;
        }
        chunks.push(next.value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let body;
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      send(event.source, message.id, "invalid-response");
      return;
    }
    send(event.source, message.id, null, body, response.status, declaredLength);
  } catch {
    send(event.source, message.id, controller.signal.aborted ? "timeout" : "invalid-response");
  } finally {
    clearTimeout(timeout);
  }
}, { once: true });
</script>`;
}

export function createSandboxedBrowserRpcFetcher(limits: BrowserRpcFrameLimits): typeof fetch {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new BrowserRpcFrameTransportError("network-error");
  }
  const source = frameDocument(limits);

  return async (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : null;
    const body = typeof init?.body === "string" ? init.body : null;
    if (!url || !body || init?.method !== "POST") {
      throw new BrowserRpcFrameTransportError("network-error");
    }

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    iframe.srcdoc = source;
    const id = ++requestSequence;

    return await new Promise<Response>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", receive);
        init.signal?.removeEventListener("abort", abort);
        iframe.remove();
      };
      const abort = () => {
        cleanup();
        reject(new BrowserRpcFrameTransportError("timeout"));
      };
      const receive = (event: MessageEvent) => {
        const message = event.data as Record<string, unknown> | null;
        if (
          event.source !== iframe.contentWindow ||
          !message ||
          message.channel !== channel ||
          message.id !== id
        ) {
          return;
        }
        cleanup();
        if (
          message.failure === "invalid-response" ||
          message.failure === "network-error" ||
          message.failure === "timeout"
        ) {
          reject(new BrowserRpcFrameTransportError(message.failure));
          return;
        }
        if (
          message.failure !== null ||
          typeof message.body !== "string" ||
          typeof message.status !== "number"
        ) {
          reject(new BrowserRpcFrameTransportError("invalid-response"));
          return;
        }
        const headers = new Headers({ "Content-Type": "application/json" });
        if (typeof message.declaredLength === "string") {
          headers.set("Content-Length", message.declaredLength);
        }
        resolve(new Response(message.body, { headers, status: message.status }));
      };

      window.addEventListener("message", receive);
      init.signal?.addEventListener("abort", abort, { once: true });
      iframe.addEventListener(
        "load",
        () => {
          if (settled) return;
          iframe.contentWindow?.postMessage({ body, channel, id, url }, "*");
        },
        { once: true },
      );
      document.body.append(iframe);
      if (init.signal?.aborted) abort();
    });
  };
}
