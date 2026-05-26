import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProxyDispatcher, resolveProxyUrlForRequest } from "../proxyEnv.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function clearProxyEnv() {
  vi.stubEnv("HTTP_PROXY", undefined);
  vi.stubEnv("HTTPS_PROXY", undefined);
  vi.stubEnv("ALL_PROXY", undefined);
  vi.stubEnv("NO_PROXY", undefined);
  vi.stubEnv("http_proxy", undefined);
  vi.stubEnv("https_proxy", undefined);
  vi.stubEnv("all_proxy", undefined);
  vi.stubEnv("no_proxy", undefined);
}

describe("proxy env helpers", () => {
  beforeEach(() => {
    clearProxyEnv();
  });

  it("uses protocol-specific proxy before ALL_PROXY", () => {
    const env = {
      HTTPS_PROXY: "http://https-proxy.example:8080",
      HTTP_PROXY: "http://http-proxy.example:8080",
      ALL_PROXY: "socks5://all-proxy.example:1080",
    };

    expect(resolveProxyUrlForRequest("https://api.openai.com/v1/models", env)).toBe(
      "http://https-proxy.example:8080",
    );
    expect(resolveProxyUrlForRequest("http://api.example.test/models", env)).toBe(
      "http://http-proxy.example:8080",
    );
  });

  it("falls back to ALL_PROXY and supports socks5 dispatchers", () => {
    vi.stubEnv("ALL_PROXY", "socks5://proxy.example:1080");

    expect(resolveProxyUrlForRequest("https://openrouter.ai/api/v1/models")).toBe(
      "socks5://proxy.example:1080",
    );
    expect(resolveProxyDispatcher("https://openrouter.ai/api/v1/models")).toBeDefined();
  });

  it("uses distinct cached dispatchers for long-running proxy timeouts", () => {
    vi.stubEnv("ALL_PROXY", "http://proxy.example:8080");

    const normalDispatcher = resolveProxyDispatcher("http://127.0.0.1:4096/session");
    const longRunningDispatcher = resolveProxyDispatcher(
      "http://127.0.0.1:4096/session/session-1/message",
      process.env,
      { bodyTimeout: 0, headersTimeout: 0 },
    );
    const cachedLongRunningDispatcher = resolveProxyDispatcher(
      "http://127.0.0.1:4096/session/session-2/message",
      process.env,
      { bodyTimeout: 0, headersTimeout: 0 },
    );

    expect(normalDispatcher).toBeDefined();
    expect(longRunningDispatcher).toBeDefined();
    expect(longRunningDispatcher).toBe(cachedLongRunningDispatcher);
    expect(longRunningDispatcher).not.toBe(normalDispatcher);
  });

  it("honours NO_PROXY hosts, suffixes, ports, and wildcard", () => {
    expect(
      resolveProxyUrlForRequest("https://api.openai.com/v1/models", {
        HTTPS_PROXY: "http://proxy.example:8080",
        NO_PROXY: "localhost,.openai.com",
      }),
    ).toBeNull();
    expect(
      resolveProxyUrlForRequest("http://127.0.0.1:3009/health", {
        HTTP_PROXY: "http://proxy.example:8080",
        NO_PROXY: "127.0.0.1:3009",
      }),
    ).toBeNull();
    expect(
      resolveProxyUrlForRequest("https://api.openai.com/v1/models", {
        HTTPS_PROXY: "http://proxy.example:8080",
        NO_PROXY: "*",
      }),
    ).toBeNull();
  });
});
