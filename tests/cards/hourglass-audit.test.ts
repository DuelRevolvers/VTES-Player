import { describe, expect, it } from "vitest";
import { handSizeOf, VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const m = state.seats[0]!.minions[0]!;
  m.disciplines = { pot: "basic", tem: "superior" };
  state.seats[0]!.hand = [{ id: "hg", name: "Hourglass of the Mind" }];
  state.seats[0]!.library = Array.from({ length: 20 }, (_, i) => ({ id: `lib${i}`, name: "Direct Intervention" }));
  return { state, m, engine: new VtesEngine(state, testRegistry) };
}
function ids(engine: VtesEngine) { return engine.decision()!.options.map(o => o.id); }

describe("Hourglass of the Mind partial corrections", () => {
  it("exposes distinct basic Potence and Temporis modes", () => {
    const { engine } = setup();
    expect(ids(engine)).toContain("play:Hourglass of the Mind:basic:V1:pot:hg");
    expect(ids(engine)).toContain("play:Hourglass of the Mind:basic:V1:tem:hg");
  });
  it("superior starts with no hand-size bonus before any counters", () => {
    const { state, m, engine } = setup();
    const option = ids(engine).find(id => id.startsWith("play:Hourglass of the Mind:superior"))!;
    expect(option).toBeDefined(); engine.choose(option);
    for (let i = 0; i < 30 && !m.attached.some(p => p.card.id === "hg"); i++) engine.choose("pass");
    const entry = m.attached.find(p => p.card.id === "hg");
    expect(entry).toBeDefined(); expect(entry!.counters ?? 0).toBe(0);
    expect(handSizeOf(state, "Alice")).toBe(7);
  });
  it.each([["pot", 3], ["tem", 4]] as const)("selecting %s uses its own draw count", (mode, count) => {
    const { state, engine } = setup();
    engine.choose(`play:Hourglass of the Mind:basic:V1:${mode}:hg`);
    const initialDraws = state.eventLog.filter(e => e.type === "CardDrawn").length;
    for (let i = 0; i < 30 && !state.eventLog.some(e => e.type === "ActionResolved"); i++) {
      const dp = engine.decision()!;
      const option = dp.options.find(o => o.id === "pass") ?? dp.options[0]!;
      engine.choose(option.id);
    }
    expect(state.eventLog.filter(e => e.type === "CardDrawn").length - initialDraws).toBe(count);
  });
});

describe("Hourglass basic Temporis resolution", () => {
  const top = (id: string) => `choice:Hourglass of the Mind:hg:top:${id}`;
  function untilTop(engine: VtesEngine) {
    for (let i = 0; i < 50; i++) {
      const d = engine.decision()!;
      if (d.options.some(o => o.id.startsWith("choice:Hourglass of the Mind:hg:top:"))) return;
      const p = d.options.find(o => o.id === "pass");
      if (!p) throw new Error(`unexpected decision ${d.options.map(o => o.id).join(", ")}`);
      engine.choose(p.id);
    }
    throw new Error("top choice was not offered");
  }
  it("draws before selecting four cards in order, unlocks, then resolves the action", () => {
    const { state, m, engine } = setup();
    state.seats[0]!.hand.push({ id: "old", name: "Old card" });
    engine.choose("play:Hourglass of the Mind:basic:V1:tem:hg");
    untilTop(engine);
    expect(m.locked).toBe(true);
    expect(state.eventLog.some(e => e.type === "ActionResolved")).toBe(false);
    expect(state.seats[0]!.hand.map(c => c.id)).toEqual(["old", "lib0", "lib1", "lib2", "lib3", "lib4"]);
    for (const id of ["lib3", "old", "lib1", "lib4"]) engine.choose(top(id));
    expect(state.seats[0]!.library.slice(0, 5).map(c => c.id)).toEqual(["lib4", "lib1", "old", "lib3", "lib5"]);
    expect(state.seats[0]!.hand.map(c => c.id)).toEqual(["lib0", "lib2"]);
    expect(m.locked).toBe(false);
    expect(state.eventLog.some(e => e.type === "ActionResolved")).toBe(true);
  });
  it("moves available cards even if fewer than four can be drawn", () => {
    const { state, engine, m } = setup();
    state.seats[0]!.hand.push({ id: "old1", name: "A" }, { id: "old2", name: "B" });
    state.seats[0]!.library = [];
    engine.choose("play:Hourglass of the Mind:basic:V1:tem:hg");
    untilTop(engine);
    engine.choose(top("old1")); engine.choose(top("old2"));
    expect(state.seats[0]!.library.map(c => c.id)).toEqual(["old2", "old1"]);
    expect(m.locked).toBe(false);
    expect(state.eventLog.some(e => e.type === "ActionResolved")).toBe(true);
  });
  it("unlocks even with an empty hand and library", () => {
    const { state, engine, m } = setup();
    state.seats[0]!.library = [];
    engine.choose("play:Hourglass of the Mind:basic:V1:tem:hg");
    untilTop(engine);
    engine.choose(top("done"));
    expect(m.locked).toBe(false);
    expect(state.eventLog.some(e => e.type === "ActionResolved")).toBe(true);
  });
  it("continues remaining draw attempts after choosing an empty library over a store", () => {
    const { state, engine, m } = setup();
    engine.choose("play:Hourglass of the Mind:basic:V1:tem:hg");
    state.seats[0]!.library = [];
    m.clan = "Ravnos";
    m.attached.push({ card: { id: "tarot", name: "Shilmulo Tarot" }, locked: false,
      usedThisPhase: false, statics: {}, tags: [], storedFaceUp: false,
      stored: [{ id: "stored", name: "Stored card" }] });
    for (let i = 0; i < 40 && !ids(engine).some(id => id.includes(":drawFrom:")); i++) engine.choose("pass");
    engine.choose("choice:Shilmulo Tarot:tarot:drawFrom:library");
    expect(ids(engine)).toContain("choice:Shilmulo Tarot:tarot:drawFrom:stored");
    engine.choose("choice:Shilmulo Tarot:tarot:drawFrom:stored");
    untilTop(engine);
    engine.choose(top("lib0")); engine.choose(top("stored"));
    expect(state.seats[0]!.library.map(c => c.id)).toEqual(["stored", "lib0"]);
    expect(m.locked).toBe(false);
  });
  it("respects a bar on unlocking during the action", () => {
    const { state, engine, m } = setup();
    engine.choose("play:Hourglass of the Mind:basic:V1:tem:hg");
    untilTop(engine);
    const action = state.frames.find(f => f.kind === "action");
    if (!action || action.kind !== "action") throw new Error("missing action");
    action.noUnlock = true;
    for (const id of ["lib0", "lib1", "lib2", "lib3"]) engine.choose(top(id));
    expect(m.locked).toBe(true);
    expect(state.eventLog.some(e => e.type === "ActionResolved")).toBe(true);
  });
  it("persists redirected draws and the return sequence across save/load", () => {
    const { state, engine, m } = setup();
    // Add a redirect after the action-card replacement draw, before success.
    engine.choose("play:Hourglass of the Mind:basic:V1:tem:hg");
    m.clan = "Ravnos";
    m.attached.push({ card: { id: "tarot", name: "Shilmulo Tarot" }, locked: false,
      usedThisPhase: false, statics: {}, tags: [], storedFaceUp: false,
      stored: [{ id: "stored", name: "Stored card" }] });
    for (let i = 0; i < 40 && !ids(engine).some(id => id.includes(":drawFrom:")); i++) engine.choose("pass");
    expect(ids(engine)).toContain("choice:Shilmulo Tarot:tarot:drawFrom:stored");
    const saved = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(saved, testRegistry);
    resumed.choose("choice:Shilmulo Tarot:tarot:drawFrom:stored");
    untilTop(resumed);
    expect(saved.eventLog.some((e: { type: string }) => e.type === "ActionResolved")).toBe(false);
    resumed.choose(top("stored"));
    const savedAgain = JSON.parse(JSON.stringify(saved));
    const resumedAgain = new VtesEngine(savedAgain, testRegistry);
    for (const id of ["lib1", "lib2", "lib3"]) resumedAgain.choose(top(id));
    expect(savedAgain.seats[0].library.slice(0, 4).map((c: { id: string }) => c.id)).toEqual(["lib3", "lib2", "lib1", "stored"]);
    expect(savedAgain.seats[0].minions[0].locked).toBe(false);
  });
});

describe("Hourglass choice privacy and restrictions", () => {
  it("masks top-selection events and commands in projected logs", async () => {
    const { redactFor } = await import("../../src/engine/agent.ts");
    const { state } = setup();
    state.eventLog.push({ type: "CardPlacedOnLibraryTop", seat: "Alice", cardId: "secret" });
    state.commandLog.push({ seq: 0, seat: "Alice", option: "choice:Hourglass of the Mind:hg:top:secret" });
    expect(redactFor(state, "Bob").eventLog.at(-1)).toEqual({ type: "CardPlacedOnLibraryTop", seat: "Alice", cardId: "" });
    expect(redactFor(state, "Bob").commandLog.at(-1)!.option).toBe("[hidden card selection]");
    expect(redactFor(state, "Alice").eventLog.at(-1)).toEqual({ type: "CardPlacedOnLibraryTop", seat: "Alice", cardId: "secret" });
  });
});
