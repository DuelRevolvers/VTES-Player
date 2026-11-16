import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { ollamaBridge } from "../../scripts/ollama-bridge.ts";
import type { AddressInfo } from "node:net";

let server: ViteDevServer;
let base: string;
const realFetch = globalThis.fetch.bind(globalThis);
let chatResponse: object = { message: { content: '{"id":"legal-1"}' } };
const upstreamCalls: Array<{ url: string; init?: RequestInit }> = [];

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1:11434/")) {
      upstreamCalls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), { status: 200 });
      return new Response(JSON.stringify(chatResponse), { status: 200 });
    }
    return realFetch(input, init);
  });
  server = await createServer({ configFile: false, logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [ollamaBridge()] });
  await server.listen();
  base = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
afterAll(async () => { await server?.close(); vi.restoreAllMocks(); });

describe("local Ollama bridge", () => {
  it("checks installed models and translates a JSON decision", async () => {
    const post = (path: string, data: object) => realFetch(`${base}${path}`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(data) });
    const status = await post("/__vtes_ollama/status", { model: "qwen3:8b" });
    expect(await status.json()).toMatchObject({ available: true });
    const response = await post("/__vtes_ollama/decide", { model: "qwen3:8b", prompt: "legal choices" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "legal-1" });
    const request = upstreamCalls.find((c) => c.url.endsWith("/api/chat"));
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({ model: "qwen3:8b", format: "json", stream: false, think: false });
  });

  it("constrains valid ids and classifies truncated or invalid model output as retryable", async () => {
    const post = (attempt: number) => realFetch(`${base}/__vtes_ollama/decide`, {
      method: "POST", headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen3:8b", prompt: "game data", optionIds: ["legal-1", "pass"], attempt }),
    });
    try {
      chatResponse = { message: { content: '{"id":' }, done_reason: "length" };
      let response = await post(0);
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ retryable: true, error: expect.stringMatching(/token limit/) });
      chatResponse = { message: { content: '{"id":"invented"}' } };
      response = await post(1);
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ retryable: true });
      const request = JSON.parse(String(upstreamCalls.at(-1)?.init?.body));
      expect(request.format.properties.id.enum).toEqual(["legal-1", "pass"]);
      expect(request.options.num_predict).toBe(256);
      expect(request.options.num_ctx).toBe(9500);
      expect(request.messages[0].role).toBe("system");
    } finally { chatResponse = { message: { content: '{"id":"legal-1"}' } }; }
  });

  it("forwards optional model-reported prompt token counts", async () => {
    try {
      chatResponse = { message: { content: '{"id":"legal-1"}' }, prompt_eval_count: 1234 };
      const response = await realFetch(`${base}/__vtes_ollama/decide`, {
        method: "POST", headers: { origin: base, "content-type": "application/json" },
        body: JSON.stringify({ model: "qwen3:8b", prompt: "game data", optionIds: ["legal-1", "pass"] }),
      });
      expect(await response.json()).toEqual({ id: "legal-1", promptTokens: 1234 });
    } finally { chatResponse = { message: { content: '{"id":"legal-1"}' } }; }
  });

  it("rejects cross-origin calls and invalid model names without invoking Ollama", async () => {
    const previous = upstreamCalls.length;
    const cross = await realFetch(`${base}/__vtes_ollama/status`, { method: "POST", headers: { origin: "https://evil.invalid", "content-type": "application/json" }, body: '{"model":"qwen3:8b"}' });
    expect(cross.status).toBe(403);
    const invalid = await realFetch(`${base}/__vtes_ollama/status`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: '{"model":"bad model"}' });
    expect(invalid.status).toBe(400);
    expect(upstreamCalls).toHaveLength(previous);
  });
});
