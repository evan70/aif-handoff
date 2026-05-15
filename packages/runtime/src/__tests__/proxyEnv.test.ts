import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProxyDispatcher, resolveProxyUrlForRequest } from "../proxyEnv.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy env helpers", () => {
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
