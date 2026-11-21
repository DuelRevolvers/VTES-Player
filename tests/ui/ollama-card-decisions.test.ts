import { describe, expect, it, vi } from "vitest";
import { OllamaAgent, OllamaContextTooLargeError, OLLAMA_PROMPT_BYTE_BUDGET, ollamaPrompt, visibleCardNames } from "../../src/ai/ollama-agent.ts";
import { VtesEngine, viewFor } from "../../src/engine/index.ts";
import type { LegalOption } from "../../src/engine/options.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function scenario() {
  const state = threeSeatGame();
  state.seats[0]!.hand = [{ id: "soak", name: "Soak" }, { id: "cond", name: "Conditioning" }];
  state.seats[1]!.hand = [{ id: "secret", name: "SECRET OPPONENT CARD" }];
  const engine = new VtesEngine(state, testRegistry);
  const dp = { ...engine.decision()!, window: "combat.beforeResolution" as const };
  const view = viewFor(state, "Alice");
  const pass: LegalOption = { id: "pass", kind: "pass", label: "Pass" };
  const soak: LegalOption = { id: "play-soak", kind: "playCard", label: "Play Soak", name: "Soak", card: "soak", minion: "V1", mode: null, params: {}, cost: { blood: 1, pool: 0 }, effects: [{ tag: "prevent", amount: 1 }] };
  return { state, dp, view, pass, soak };
}

describe("Ollama card decisions and context selection", () => {
  it("asks the model to weigh passing, future value, cycling and uncertainty in combat", () => {
    const { dp, view, pass, soak } = scenario();
    const data = JSON.parse(ollamaPrompt(dp, [pass, soak], view, { Soak: "Prevent damage" }));
    expect(data.options).toEqual([pass, soak]);
    expect(data.cardDecision.guidance).toMatch(/Compare playing each card now with passing/);
    expect(data.cardDecision.guidance).toMatch(/A card is a resource/);
    expect(data.cardDecision.guidance).toMatch(/Do not pass automatically/);
    expect(data.cardDecision.situation).toMatch(/Do not assume damage/);
    expect(data.relevantCardTexts.Soak).toBe("Prevent damage");
    expect(data.relationships.prey).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain("SECRET OPPONENT CARD");
  });

  it("compares guidance against the same context without the extra card advice", async () => {
    const { dp, view, pass, soak } = scenario();
    const texts = { Soak: "prevent damage" };
    const guided = JSON.parse(ollamaPrompt(dp, [pass, soak], view, texts));
    const unguided = JSON.parse(ollamaPrompt(dp, [pass, soak], view, texts, false));
    expect(guided.cardDecision).toBeDefined();
    delete guided.cardDecision;
    expect(unguided).toEqual(guided);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "pass" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await new OllamaAgent("qwen3:8b", 1, false).decideAsync(dp, [pass, soak], view, new AbortController().signal);
      expect(JSON.parse(JSON.parse(fetchMock.mock.calls[0]![1].body).prompt).cardDecision).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });

  it("records only valid model-reported prompt token counts", async () => {
    const { dp, view, pass, soak } = scenario();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pass", promptTokens: 1234 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pass", promptTokens: 900 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pass", promptTokens: -5 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const agent = new OllamaAgent();
      expect(agent.maxPromptTokens).toBeNull();
      for (let i = 0; i < 3; i++) await agent.decideAsync(dp, [pass, soak], view, new AbortController().signal);
      expect(agent.maxPromptTokens).toBe(1234);
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not suggest a fictional pass when there is no pass option", () => {
    const { dp, view, soak } = scenario();
    const data = JSON.parse(ollamaPrompt(dp, [soak], view));
    expect(data.cardDecision.guidance).toMatch(/No pass option is offered/);
    expect(data.options).toEqual([soak]);
  });

  it("keeps the live action and play choices when a bleed could oust the target", () => {
    const { dp, view, pass, soak } = scenario();
    const target = view.seats[1]!;
    target.pool = 3;
    const action = { actionId: "a", kind: "bleed" as const, acting: "V1", actingSeat: "Alice", target: target.id, directed: true, stealth: 1, bleed: 3, cardName: null, political: false, intercept: {}, blockedBy: null };
    const data = JSON.parse(ollamaPrompt({ ...dp, window: "action.effects" }, [pass, soak], { ...view, action }));
    expect(data.action).toEqual(action);
    expect(data.seats[1].pool).toBe(3);
    expect(data.cardDecision.situation).toMatch(/possible oust/);
    expect(data.options).toEqual([pass, soak]);
  });

  it("prioritizes public pending cards and playable cards over other visible cards", () => {
    const { dp, view, pass, soak } = scenario();
    const withPending = { ...view, pendingCard: { name: "Direct Intervention", seat: "Bob", minion: null, isMaster: false, isEvent: false } };
    const names = visibleCardNames([pass, soak], withPending);
    expect(names.indexOf("Direct Intervention")).toBeLessThan(names.indexOf("Soak"));
    expect(names.indexOf("Soak")).toBeLessThan(names.indexOf("Conditioning"));
    expect(names).not.toContain("SECRET OPPONENT CARD");
    // The later hand text does not fit the text budget; playable Soak does.
    const texts = { "Direct Intervention": "D".repeat(3000), Soak: "S".repeat(3000), Conditioning: "C".repeat(3000), "SECRET OPPONENT CARD": "LEAK" };
    const data = JSON.parse(ollamaPrompt(dp, [pass, soak], withPending, texts));
    expect(Object.keys(data.relevantCardTexts)).toEqual(["Direct Intervention", "Soak"]);
    expect(JSON.stringify(data)).not.toContain("LEAK");
  });

  it("omits large ash heaps before legal options and reports omission", () => {
    const { dp, view, pass, soak } = scenario();
    view.seats[0]!.ashHeap = Array.from({ length: 300 }, (_, i) => ({ id: `ash${i}`, name: "public long card name ".repeat(8) }));
    const prompt = ollamaPrompt(dp, [pass, soak], view, { Soak: "prevent damage" });
    const data = JSON.parse(prompt);
    expect(new TextEncoder().encode(prompt).length).toBeLessThanOrEqual(OLLAMA_PROMPT_BYTE_BUDGET);
    expect(data.seats[0].ashHeap).toBeNull();
    expect(data.seats[0].ashHeapCount).toBe(300);
    expect(data.contextNote).toMatch(/unknown here, not empty/);
    expect(data.options).toEqual([pass, soak]);
  });

  it("falls back for an oversized decision without sending an incomplete option list, and retries the model on the next normal decision", async () => {
    const { dp, view, pass, soak } = scenario();
    const huge: LegalOption[] = [pass, ...Array.from({ length: 90 }, (_, i) => ({ ...soak, id: `play-${i}`, label: "long ".repeat(90) }))];
    expect(() => ollamaPrompt(dp, huge, view)).toThrow(OllamaContextTooLargeError);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "pass" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const agent = new OllamaAgent();
      const id = await agent.decideAsync(dp, huge, view, new AbortController().signal);
      expect(huge.some((o) => o.id === id)).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(agent.fallbacks).toBe(1);
      expect(agent.lastError).toMatch(/too large/);
      expect(await agent.decideAsync(dp, [pass, soak], view, new AbortController().signal)).toBe("pass");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).optionIds).toEqual(["pass", "play-soak"]);
    } finally { vi.unstubAllGlobals(); }
  });
});
