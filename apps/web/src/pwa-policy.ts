export interface ServiceWorkerRequest {
  headers: Headers;
  method: string;
  mode: string;
  url: string;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isPwaNetworkOnlyRequest(
  request: ServiceWorkerRequest,
  scopeOrigin: string,
): boolean {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return true;
  const url = new URL(request.url);
  if (url.origin !== scopeOrigin) return true;
  if (isApiPath(url.pathname)) return true;
  if (request.headers.has("Authorization")) return true;
  return request.headers.get("Accept")?.toLowerCase().includes("text/event-stream") ?? false;
}

export function isOfflineShellNavigation(
  request: ServiceWorkerRequest,
  scopeOrigin: string,
): boolean {
  const url = new URL(request.url);
  return (
    request.method.toUpperCase() === "GET" &&
    request.mode === "navigate" &&
    url.origin === scopeOrigin &&
    !isPwaNetworkOnlyRequest(request, scopeOrigin)
  );
}
