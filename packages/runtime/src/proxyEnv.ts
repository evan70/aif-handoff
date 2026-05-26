import { ProxyAgent, type Dispatcher } from "undici";

export const PROXY_ENV_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
] as const;

export interface RequestInitWithDispatcher extends RequestInit {
  dispatcher?: Dispatcher;
}

const dispatcherCache = new Map<string, Dispatcher>();

export interface ProxyDispatcherOptions {
  bodyTimeout?: number;
  headersTimeout?: number;
}

export function isProxyEnvironmentKey(key: string): boolean {
  return PROXY_ENV_VARS.includes(key as (typeof PROXY_ENV_VARS)[number]);
}

export function resolveProxyUrlForRequest(
  url: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;
  if (shouldBypassProxy(parsedUrl, env.NO_PROXY ?? env.no_proxy)) {
    return null;
  }

  const allProxy = readEnv(env.ALL_PROXY) ?? readEnv(env.all_proxy);
  if (parsedUrl.protocol === "https:") {
    return readEnv(env.HTTPS_PROXY) ?? readEnv(env.https_proxy) ?? allProxy;
  }
  if (parsedUrl.protocol === "http:") {
    return readEnv(env.HTTP_PROXY) ?? readEnv(env.http_proxy) ?? allProxy;
  }
  return allProxy;
}

export function resolveProxyDispatcher(
  url: string | URL,
  env: NodeJS.ProcessEnv = process.env,
  options: ProxyDispatcherOptions = {},
): Dispatcher | undefined {
  const proxyUrl = resolveProxyUrlForRequest(url, env);
  if (!proxyUrl) {
    return undefined;
  }

  const normalizedProxyUrl = normalizeProxyUrl(proxyUrl);
  const cacheKey = dispatcherCacheKey(normalizedProxyUrl, options);
  let dispatcher = dispatcherCache.get(cacheKey);
  if (!dispatcher) {
    dispatcher = createProxyDispatcher(normalizedProxyUrl, options);
    dispatcherCache.set(cacheKey, dispatcher);
  }
  return dispatcher;
}

export function withProxyDispatcher(
  url: string | URL,
  init: RequestInit = {},
  env: NodeJS.ProcessEnv = process.env,
): RequestInitWithDispatcher {
  const dispatcher = resolveProxyDispatcher(url, env);
  return dispatcher ? { ...init, dispatcher } : init;
}

function createProxyDispatcher(proxyUrl: string, options: ProxyDispatcherOptions): Dispatcher {
  return new ProxyAgent({ uri: proxyUrl, ...options });
}

function normalizeProxyUrl(proxyUrl: string): string {
  const parsed = new URL(proxyUrl);
  if (parsed.protocol === "socks:") {
    parsed.protocol = "socks5:";
  }
  return parsed.toString();
}

function dispatcherCacheKey(proxyUrl: string, options: ProxyDispatcherOptions): string {
  return `${proxyUrl}|body=${options.bodyTimeout ?? ""}|headers=${options.headersTimeout ?? ""}`;
}

function readEnv(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function shouldBypassProxy(url: URL, noProxyValue: string | undefined): boolean {
  const noProxy = readEnv(noProxyValue);
  if (!noProxy) {
    return false;
  }

  const hostname = normalizeHostname(url.hostname);
  const port = url.port || defaultPort(url.protocol);

  return noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .some((entry) => matchesNoProxyEntry(entry, hostname, port));
}

function matchesNoProxyEntry(entry: string, hostname: string, port: string): boolean {
  if (entry === "*") {
    return true;
  }

  const { host: rawHost, port: entryPort } = splitNoProxyEntry(entry);
  if (entryPort && entryPort !== port) {
    return false;
  }

  const host = normalizeHostname(rawHost);
  if (!host) {
    return false;
  }
  if (host.startsWith(".")) {
    const suffix = host.slice(1);
    return hostname === suffix || hostname.endsWith(host);
  }
  return hostname === host || hostname.endsWith(`.${host}`);
}

function splitNoProxyEntry(entry: string): { host: string; port: string | null } {
  if (entry.startsWith("[") && entry.includes("]")) {
    const closing = entry.indexOf("]");
    const host = entry.slice(0, closing + 1);
    const rest = entry.slice(closing + 1);
    return rest.startsWith(":") ? { host, port: rest.slice(1) } : { host, port: null };
  }

  const colonIndex = entry.lastIndexOf(":");
  if (colonIndex > -1 && entry.indexOf(":") === colonIndex) {
    return { host: entry.slice(0, colonIndex), port: entry.slice(colonIndex + 1) };
  }

  return { host: entry, port: null };
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function defaultPort(protocol: string): string {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return "";
}
